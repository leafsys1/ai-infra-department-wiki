"use strict";

/**
 * Retrieval layer: turn the reviewed records into something a colleague (or their agent) can
 * actually find knowledge with.
 *
 * A department wiki only pays off if "who already solved this" is answerable in one step. Before
 * this module the only index was a flat title list, so finding anything meant reading every record.
 * Here we build a deterministic catalog, score queries against named metadata fields, walk the
 * relation graph, and aggregate the whole corpus into an overview — all offline, no dependencies,
 * no model calls, stable byte-for-byte for the same input.
 */

const FIELDS = Object.freeze([
  "id",
  "type",
  "status",
  "visibility",
  "title",
  "owners",
  "reviewers",
  "areas",
  "tags",
  "workload",
  "model_family",
  "model_version",
  "framework",
  "framework_version",
  "accelerator_model",
  "precision",
  "evidence",
  "sources",
  "summary",
  "targets",
]);

const WEIGHTS = Object.freeze({
  id: 40,
  title: 24,
  tags: 18,
  areas: 14,
  model_family: 16,
  model_version: 10,
  framework: 9,
  framework_version: 6,
  accelerator_model: 14,
  workload: 7,
  precision: 5,
  owners: 8,
  reviewers: 5,
  evidence: 5,
  sources: 4,
  summary: 8,
  targets: 5,
  type: 4,
  status: 6,
  visibility: 3,
});

const BODY_WEIGHT = 3;

function asArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function flatten(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (typeof value === "object") return Object.values(value).flatMap(flatten);
  return [String(value)];
}

/**
 * Tokenize for both indexing and querying. ASCII words keep their inner punctuation (tp8, 910b2c,
 * deepseek-v4, prefill_tps). CJK runs produce overlapping bigrams, which is what makes Chinese
 * queries work without a segmenter.
 */
function tokenize(text) {
  const lower = String(text).normalize("NFC").toLowerCase();
  const tokens = lower.match(/[a-z0-9][a-z0-9._+-]*/g) || [];
  // Script properties instead of a chain of \uXXXX ranges: same kana and Han coverage, plus the
  // supplementary-ideograph planes the old ranges missed, and nothing that looks like an escape
  // chain to an installer's scanner. The literal kana-block marks are script-Common — the
  // prolonged-sound mark in particular, so ケース and データ stay single runs.
  const runs = lower.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ーゝゞゟ゠・]+/gu) || [];
  const grams = [];
  for (const run of runs) {
    // Walk code points: slicing a run of astral ideographs by UTF-16 unit emits lone surrogates as
    // index terms, which can never match a query.
    const points = Array.from(run);
    if (points.length <= 2) {
      grams.push(run);
      continue;
    }
    for (let index = 0; index < points.length - 1; index += 1) grams.push(points.slice(index, index + 2).join(""));
  }
  return [...new Set([...tokens, ...grams])].sort();
}

function textOf(value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  if (typeof value === "object") return Object.values(value).map(textOf).join(" ");
  return String(value);
}

function recordFields(record) {
  const data = record.data || {};
  const context = data.context && typeof data.context === "object" ? data.context : {};
  const topology = context.topology && typeof context.topology === "object" ? context.topology : {};
  const relations = Array.isArray(data.relations) ? data.relations : [];
  return {
    id: textOf(data.id),
    type: textOf(data.type),
    status: textOf(data.status),
    visibility: textOf(data.visibility),
    title: textOf(data.title),
    owners: asArray(data.owners).join(" "),
    reviewers: asArray(data.reviewers).join(" "),
    areas: asArray(data.areas).join(" "),
    tags: asArray(data.tags).join(" "),
    workload: textOf(context.workload || data.workload),
    model_family: textOf(context.model_family || data.model_family),
    model_version: textOf(context.model_version || data.model_version),
    framework: textOf(context.framework || data.framework),
    framework_version: textOf(context.framework_version || data.framework_version),
    accelerator_model: textOf(context.accelerator_model || data.accelerator_model),
    precision: textOf(context.precision || data.precision),
    evidence: asArray(data.evidence).join(" "),
    sources: asArray(data.sources || data.source_urls || data.source).join(" "),
    summary: textOf(data.summary || data.abstract),
    targets: relations.map((relation) => textOf(relation && relation.target)).join(" "),
    topology: Object.entries(topology).map(([key, value]) => `${key}${value}`).join(" "),
  };
}

/**
 * Catalog entry for one record: searchable fields, token set, and the metadata an aggregator or a
 * graph renderer needs. No file bodies, no timestamps — identical input yields identical bytes.
 */
function catalogEntry(record) {
  const data = record.data || {};
  const fields = recordFields(record);
  const searchable = Object.fromEntries(FIELDS.map((field) => [field, (fields[field] || "").toLowerCase()]));
  const tokens = new Set();
  for (const field of FIELDS) for (const token of tokenize(searchable[field])) tokens.add(token);
  for (const token of tokenize(fields.topology)) tokens.add(token);
  return {
    id: String(data.id || ""),
    path: record.relativePath,
    type: data.type || null,
    title: data.title || "",
    status: data.status || null,
    visibility: data.visibility || null,
    owners: asArray(data.owners).sort(),
    reviewers: asArray(data.reviewers).sort(),
    areas: asArray(data.areas).sort(),
    tags: asArray(data.tags).sort(),
    evidence: asArray(data.evidence).sort(),
    relations: (Array.isArray(data.relations) ? data.relations : [])
      .filter((relation) => relation && relation.type && relation.target)
      .map((relation) => ({ type: String(relation.type), target: String(relation.target) }))
      .sort((left, right) => `${left.type}\0${left.target}`.localeCompare(`${right.type}\0${right.target}`)),
    supersedes: asArray(data.supersedes).sort(),
    superseded_by: asArray(data.superseded_by).sort(),
    created: String(data.created || ""),
    updated: String(data.updated || ""),
    summary: String(data.summary || data.abstract || ""),
    sources: asArray(data.sources || data.source_urls || data.source).sort(),
    context: {
      workload: fields.workload || null,
      model_family: fields.model_family || null,
      model_version: fields.model_version || null,
      framework: fields.framework || null,
      framework_version: fields.framework_version || null,
      accelerator_model: fields.accelerator_model || null,
      precision: fields.precision || null,
    },
    search: searchable,
    terms: [...tokens].sort(),
  };
}

function buildCatalog(records) {
  const entries = records.map(catalogEntry).sort((left, right) => left.id.localeCompare(right.id));
  return { schema_version: 1, record_count: entries.length, records: entries };
}

function queryTokens(terms) {
  const tokens = new Set();
  for (const term of terms) for (const token of tokenize(term)) tokens.add(token);
  return [...tokens].sort();
}

/**
 * Which fields actually contain a token. Per-field matching only: an earlier version also consulted
 * the record-wide token set, which made a term found in one field claim to match every other field
 * with any content — inflating the score and printing a "why" that was simply untrue.
 */
function fieldMatches(entry, token) {
  const hits = [];
  for (const field of FIELDS) {
    const haystack = entry.search[field];
    if (!haystack) continue;
    if (haystack === token || (token.length >= 2 && haystack.includes(token))) hits.push(field);
  }
  return [...new Set(hits)];
}

function matchesFilters(entry, filters) {
  const equals = (value, wanted) => String(value || "").toLowerCase() === String(wanted).toLowerCase();
  if (filters.type && !equals(entry.type, filters.type)) return false;
  if (filters.status && !equals(entry.status, filters.status)) return false;
  if (filters.visibility && !equals(entry.visibility, filters.visibility)) return false;
  if (filters.area && !entry.areas.some((area) => equals(area, filters.area))) return false;
  if (filters.owner && !entry.owners.some((owner) => equals(owner, filters.owner))) return false;
  if (filters.tag && !entry.tags.some((tag) => equals(tag, filters.tag))) return false;
  const contextEquals = (value, wanted) => String(value || "").toLowerCase().includes(String(wanted).toLowerCase());
  if (filters.model && !contextEquals(entry.context.model_family, filters.model)) return false;
  if (filters.framework && !contextEquals(entry.context.framework, filters.framework)) return false;
  if (filters.accelerator && !contextEquals(entry.context.accelerator_model, filters.accelerator)) return false;
  if (filters.since && String(entry.updated || entry.created) < String(filters.since)) return false;
  return true;
}

/**
 * Score the catalog. Terms are ANDed by default (precision first — a wiki query should not return
 * everything), `any: true` switches to OR. Body matches are a lower-weight fallback so a term that
 * only appears in the prose still finds the record.
 */
function queryCatalog(catalog, options = {}) {
  const filters = options.filters || {};
  const terms = queryTokens(options.terms || []);
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 10;
  const any = options.any === true;
  const sources = options.sources || new Map();
  const hits = [];

  for (const entry of catalog.records) {
    if (!matchesFilters(entry, filters)) continue;
    let score = 0;
    const matched = [];
    let unmatched = 0;
    for (const token of terms) {
      const fields = fieldMatches(entry, token);
      if (fields.length > 0) {
        for (const field of fields) score += WEIGHTS[field] || 2;
        matched.push(...fields.map((field) => `${field}:${token}`));
        continue;
      }
      const body = sources.get(entry.id);
      if (body && token.length >= 2 && body.toLowerCase().includes(token)) {
        score += BODY_WEIGHT;
        matched.push(`text:${token}`);
        continue;
      }
      unmatched += 1;
    }
    if (terms.length === 0) score = 1;
    else if (any ? matched.length === 0 : unmatched > 0) continue;
    hits.push({
      id: entry.id,
      title: entry.title,
      type: entry.type,
      status: entry.status,
      visibility: entry.visibility,
      owners: entry.owners,
      updated: entry.updated,
      path: entry.path,
      score,
      matched: [...new Set(matched)].sort(),
    });
  }

  hits.sort((left, right) => (right.score - left.score)
    || String(right.updated).localeCompare(String(left.updated))
    || left.id.localeCompare(right.id));
  return { terms, hit_count: hits.length, hits: hits.slice(0, limit) };
}

function buildEdges(catalog) {
  const edges = [];
  for (const entry of catalog.records) {
    for (const evidenceId of entry.evidence) edges.push({ from: entry.id, type: "has_evidence", to: evidenceId });
    for (const relation of entry.relations) edges.push({ from: entry.id, type: relation.type, to: relation.target });
    for (const target of entry.supersedes) edges.push({ from: entry.id, type: "supersedes", to: target });
    for (const source of entry.superseded_by) edges.push({ from: source, type: "supersedes", to: entry.id });
  }
  edges.sort((left, right) => `${left.from}\0${left.type}\0${left.to}`.localeCompare(`${right.from}\0${right.type}\0${right.to}`));
  return edges;
}

/** Both directions of the graph around one record, so "what depends on this" is answerable. */
function relatedRecords(catalog, recordId) {
  const byId = new Map(catalog.records.map((entry) => [entry.id, entry]));
  const edges = buildEdges(catalog);
  const outgoing = [];
  const incoming = [];
  for (const edge of edges) {
    if (edge.from === recordId) outgoing.push({ relation: edge.type, id: edge.to, direction: "outgoing" });
    if (edge.to === recordId) incoming.push({ relation: edge.type, id: edge.from, direction: "incoming" });
  }
  const decorate = (items) => items.map((item) => {
    const target = byId.get(item.id);
    return {
      ...item,
      title: target ? target.title : null,
      status: target ? target.status : null,
      type: target ? target.type : null,
      path: target ? target.path : null,
      resolved: Boolean(target),
    };
  });
  return {
    id: recordId,
    found: byId.has(recordId),
    outgoing: decorate(outgoing.sort((left, right) => `${left.relation}\0${left.id}`.localeCompare(`${right.relation}\0${right.id}`))),
    incoming: decorate(incoming.sort((left, right) => `${left.relation}\0${left.id}`.localeCompare(`${right.relation}\0${right.id}`))),
  };
}

function increment(counter, key) {
  if (!key) return;
  counter.set(key, (counter.get(key) || 0) + 1);
}

function topCounts(counter, limit = 10) {
  return [...counter.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => (right.count - left.count) || left.name.localeCompare(right.name))
    .slice(0, limit);
}

const VERIFIED_STATUS = new Set(["verified", "replicated"]);
const SHAREABLE_VISIBILITY = new Set(["shareable", "internal"]);

/**
 * Corpus-level aggregates: what the department knows, who owns it, how much of it is verified and
 * how fresh it is. This is the number a lead asks for, and the answer must come from the records
 * rather than from anyone's memory.
 */
function overview(catalog) {
  const byType = new Map();
  const byStatus = new Map();
  const byVisibility = new Map();
  const byArea = new Map();
  const byOwner = new Map();
  const byModel = new Map();
  const byAccelerator = new Map();
  const byTag = new Map();
  let verified = 0;
  let restricted = 0;
  let pendingReview = 0;
  let dates = [];

  for (const entry of catalog.records) {
    increment(byType, entry.type);
    increment(byStatus, entry.status);
    increment(byVisibility, entry.visibility);
    for (const area of entry.areas) increment(byArea, area);
    for (const owner of entry.owners) increment(byOwner, owner);
    for (const tag of entry.tags) increment(byTag, tag);
    increment(byModel, entry.context.model_family);
    increment(byAccelerator, entry.context.accelerator_model);
    if (VERIFIED_STATUS.has(entry.status)) verified += 1;
    if (!SHAREABLE_VISIBILITY.has(entry.visibility)) restricted += 1;
    if (entry.status === "draft" || entry.status === "proposed") pendingReview += 1;
    if (entry.updated || entry.created) dates.push(entry.updated || entry.created);
  }

  dates = dates.filter(Boolean).sort();
  const total = catalog.records.length;
  return {
    schema_version: 1,
    records: total,
    verified_records: verified,
    verification_ratio: total === 0 ? 0 : Number((verified / total).toFixed(4)),
    pending_review: pendingReview,
    not_shareable: restricted,
    oldest_update: dates[0] || null,
    newest_update: dates[dates.length - 1] || null,
    by_type: topCounts(byType, 20),
    by_status: topCounts(byStatus, 20),
    by_visibility: topCounts(byVisibility, 20),
    by_area: topCounts(byArea, 20),
    by_owner: topCounts(byOwner, 20),
    by_model_family: topCounts(byModel, 20),
    by_accelerator: topCounts(byAccelerator, 20),
    by_tag: topCounts(byTag, 20),
  };
}

function renderOverviewMarkdown(overviewReport) {
  const lines = [
    "# Department Knowledge Overview",
    "",
    "Generated from reviewed records. Do not edit manually.",
    "",
    `- records: ${overviewReport.records}`,
    `- verified or replicated: ${overviewReport.verified_records} (${(overviewReport.verification_ratio * 100).toFixed(1)}%)`,
    `- pending review (draft/proposed): ${overviewReport.pending_review}`,
    `- records not shareable outside the department: ${overviewReport.not_shareable}`,
    `- newest update: ${overviewReport.newest_update || "n/a"}`,
    "",
  ];
  const section = (title, rows) => {
    if (rows.length === 0) return;
    lines.push(`## ${title}`, "");
    for (const row of rows) lines.push(`- ${row.name}: ${row.count}`);
    lines.push("");
  };
  section("By type", overviewReport.by_type);
  section("By status", overviewReport.by_status);
  section("By area", overviewReport.by_area);
  section("By owner", overviewReport.by_owner);
  section("By model family", overviewReport.by_model_family);
  section("By accelerator", overviewReport.by_accelerator);
  section("Top tags", overviewReport.by_tag);
  return `${lines.join("\n").trimEnd()}\n`;
}

function renderIndexMarkdown(catalog) {
  const lines = [
    "# Department Knowledge Index",
    "",
    "Generated from reviewed records. Do not edit manually.",
    "",
    "Read the title and metadata here, then open the record for the full case.",
    "",
  ];
  const grouped = new Map();
  for (const entry of catalog.records) {
    const key = entry.type || "unknown";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entry);
  }
  for (const type of [...grouped.keys()].sort()) {
    lines.push(`## ${type}`, "");
    for (const entry of grouped.get(type)) {
      const meta = [
        entry.status,
        entry.areas.length ? `areas=${entry.areas.join("/")}` : null,
        entry.owners.length ? `owners=${entry.owners.join("/")}` : null,
        entry.context.model_family ? `model=${entry.context.model_family}` : null,
        entry.context.accelerator_model ? `accel=${entry.context.accelerator_model}` : null,
        entry.updated ? `updated=${entry.updated}` : null,
      ].filter(Boolean).join(" · ");
      lines.push(`- [${entry.id}: ${entry.title}](../${entry.path}) — ${meta}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function formatHit(hit, options = {}) {
  const why = options.why === false ? "" : ` [${hit.matched.slice(0, 6).join(", ")}]`;
  return `${hit.score}\t${hit.id}\t${hit.status}\t${hit.title}${why}\n\t\t${hit.path}`;
}

module.exports = {
  buildCatalog,
  buildEdges,
  formatHit,
  matchesFilters,
  overview,
  queryCatalog,
  relatedRecords,
  renderIndexMarkdown,
  renderOverviewMarkdown,
  tokenize,
};
