"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  buildCatalog,
  overview: buildOverview,
  renderIndexMarkdown,
  renderOverviewMarkdown,
} = require("./query");
const { POLICY_FILE, loadPolicy, scanSource } = require("./policy");
const { SchemaSet } = require("./schema");
const { initKnowledgeRepo: scaffoldKnowledgeRepo, skillVersion } = require("./scaffold");

const RECORD_SCHEMA = "record.schema.json";
// The schemas live under scripts/ on purpose: Hermes installers fetch a Skill's support files only
// from references/, templates/, scripts/, assets/ and examples/, so a schema directory at the Skill
// root would be silently left out of a single-URL install while the validator depends on it.
const SCHEMA_DIRECTORY = path.resolve(__dirname, "..", "schemas");
// Shipped with the Skill and pinned into the knowledge repository's .department-tools/, so `build`
// can always drop a copy of the dashboard beside the catalog it renders.
const DASHBOARD_ASSET = "assets/dashboard/index.html";

const CONFIG_FILE = ".department-wiki.json";

const RECORD_DIRECTORIES = Object.freeze({
  case: "records/cases",
  evidence: "records/evidence",
  decision: "records/decisions",
  pattern: "records/patterns",
  runbook: "records/runbooks",
  environment: "records/environments",
});

const ID_PATTERNS = Object.freeze({
  case: /^CASE-\d{4}-\d{4}$/,
  evidence: /^EVD-\d{4}-\d{4}$/,
  decision: /^DEC-\d{4}-\d{4}$/,
  pattern: /^PAT-\d{4}-\d{4}$/,
  runbook: /^RUN-\d{4}-\d{4}$/,
  environment: /^ENV-[A-Z0-9][A-Z0-9-]*$/,
});

const VALID_STATUS = new Set(["draft", "proposed", "observed", "verified", "replicated", "rejected", "deprecated"]);
const VALID_VISIBILITY = new Set(["shareable", "internal", "restricted", "local-only"]);
const VALID_RELATIONS = new Set([
  "validated_by",
  "supports",
  "refutes",
  "applies_to",
  "observed_in",
  "caused_by",
  "mitigated_by",
  "implemented_by",
  "supersedes",
  "contradicts",
]);

/**
 * Fields the hand-written checks below already report with a stable code and message. The schema
 * validator suppresses exactly these so a single mistake is reported once, while everything the
 * hand-written checks do not cover (item patterns, item counts, additionalProperties, and any
 * required field later added to the schema) still comes from the schema.
 */
const HAND_VALIDATED_FIELDS = new Set([
  "schema_version", "id", "type", "title", "status", "visibility", "owners", "created", "updated",
]);

function suppressedSchemaError(fileName, error) {
  if (fileName !== RECORD_SCHEMA) return false;
  return HAND_VALIDATED_FIELDS.has(error.path.split("/")[1]);
}

function scalar(value) {
  const trimmed = value.trim();
  if (trimmed === "") return {};
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const content = trimmed.slice(1, -1).trim();
    return content ? content.split(",").map((item) => scalar(item.trim())) : [];
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error("missing YAML frontmatter");
  const root = {};
  const stack = [{ indent: -1, value: root }];
  const lines = match[1].split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1).value;
    const line = raw.trim();

    if (line.startsWith("- ")) {
      if (!Array.isArray(parent)) throw new Error(`line ${index + 1}: list item without list key`);
      const item = line.slice(2);
      const pair = item.match(/^([^:]+):\s*(.*)$/);
      if (pair) {
        const object = { [pair[1].trim()]: scalar(pair[2]) };
        parent.push(object);
        stack.push({ indent, value: object });
      } else {
        parent.push(scalar(item));
      }
      continue;
    }

    const pair = line.match(/^([^:]+):\s*(.*)$/);
    if (!pair) throw new Error(`line ${index + 1}: unsupported YAML syntax`);
    const key = pair[1].trim();
    const rest = pair[2];
    if (rest !== "") {
      parent[key] = scalar(rest);
      continue;
    }

    const next = lines.slice(index + 1).find((candidate) => candidate.trim());
    const child = next && next.trim().startsWith("-") ? [] : {};
    parent[key] = child;
    stack.push({ indent, value: child });
  }

  return root;
}

function listMarkdownFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...listMarkdownFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith(".md")) results.push(absolute);
  }
  return results;
}

function recordFiles(repoPath) {
  return listMarkdownFiles(path.join(repoPath, "records"));
}

function loadRecords(repoPath) {
  const root = path.resolve(repoPath);
  return recordFiles(root).map((file) => {
    const source = fs.readFileSync(file, "utf8");
    return {
      file,
      relativePath: path.relative(root, file).split(path.sep).join("/"),
      source,
      data: parseFrontmatter(source),
    };
  });
}

function addError(errors, record, code, message) {
  errors.push({ code, file: record ? record.relativePath : null, message });
}

function addWarning(warnings, record, code, message) {
  warnings.push({ code, file: record ? record.relativePath : null, message });
}

function validateRequired(record, errors) {
  for (const field of ["schema_version", "id", "type", "title", "status", "visibility", "owners", "created", "updated"]) {
    if (record.data[field] === undefined || record.data[field] === "" || (Array.isArray(record.data[field]) && record.data[field].length === 0)) {
      addError(errors, record, "missing_field", `missing required field: ${field}`);
    }
  }
  if (record.data.schema_version !== 1) addError(errors, record, "schema_version", "schema_version must be 1");
  if (!RECORD_DIRECTORIES[record.data.type]) addError(errors, record, "record_type", `unsupported record type: ${record.data.type}`);
  if (record.data.type && ID_PATTERNS[record.data.type] && !ID_PATTERNS[record.data.type].test(String(record.data.id || ""))) {
    addError(errors, record, "record_id", `invalid ${record.data.type} id: ${record.data.id}`);
  }
  if (record.data.status && !VALID_STATUS.has(record.data.status)) addError(errors, record, "status", `invalid status: ${record.data.status}`);
  if (record.data.visibility && !VALID_VISIBILITY.has(record.data.visibility)) addError(errors, record, "visibility", `invalid visibility: ${record.data.visibility}`);
  for (const field of ["owners", "reviewers", "evidence", "relations", "supersedes", "superseded_by"]) {
    if (record.data[field] !== undefined && !Array.isArray(record.data[field])) {
      addError(errors, record, "field_type", `${field} must be an array`);
    }
  }
  for (const relation of Array.isArray(record.data.relations) ? record.data.relations : []) {
    if (!relation || typeof relation !== "object" || Array.isArray(relation) || !relation.type || !relation.target) {
      addError(errors, record, "field_type", "each relation must be an object with type and target");
    }
  }
  if (record.data.id && path.basename(record.file, ".md") !== record.data.id) {
    addError(errors, record, "filename", "record filename must equal its id");
  }
  const expectedDirectory = RECORD_DIRECTORIES[record.data.type];
  if (expectedDirectory && !record.relativePath.startsWith(`${expectedDirectory}/`)) {
    addError(errors, record, "record_directory", `${record.data.type} records must live under ${expectedDirectory}/`);
  }
}

function validateCase(record, errors) {
  const data = record.data;
  const context = data.context || {};
  const validation = data.validation || {};
  for (const field of ["workload", "model_family", "model_version", "framework", "framework_version", "accelerator_model"]) {
    if (!context[field]) addError(errors, record, "missing_context", `case context missing: ${field}`);
  }
  if (["verified", "replicated"].includes(data.status)) {
    for (const field of ["workload", "model_family", "model_version", "framework", "framework_version", "accelerator_model"]) {
      if (String(context[field]).trim().toLowerCase() === "unknown") {
        addError(errors, record, "unknown_context", `verified case context cannot be unknown: ${field}`);
      }
    }
    if (!Array.isArray(data.evidence) || data.evidence.length === 0) addError(errors, record, "missing_evidence", "verified case requires evidence");
    if (!Number.isInteger(validation.repetitions) || validation.repetitions < 2) {
      addError(errors, record, "validation", "verified case requires at least 2 repetitions");
    }
    if (!validation.conclusion_level) addError(errors, record, "validation", "verified case requires conclusion_level");
    if (String(data.visibility) === "local-only") {
      addError(errors, record, "visibility", "a local-only record cannot claim a verified department conclusion");
    }
  }
}

function validateEvidence(record, errors) {
  const data = record.data;
  if (!/^[a-f0-9]{64}$/.test(String(data.source_sha256 || ""))) addError(errors, record, "evidence_hash", "evidence requires a sha256 source hash");
  if (!data.locator) addError(errors, record, "evidence_locator", "evidence requires a source locator");
  if (["verified", "replicated"].includes(data.status)) {
    if (!Array.isArray(data.verified_by) || data.verified_by.length === 0) addError(errors, record, "verification", "verified evidence requires verified_by");
    if (!data.verified_at) addError(errors, record, "verification", "verified evidence requires verified_at");
  }
}

function validateSensitive(record, policy, errors, warnings) {
  for (const finding of scanSource(record.source, policy)) {
    const message = `${finding.severity === "block" ? "blocked" : "flagged"} sensitive content: ${finding.rule} (${finding.source})`;
    if (finding.severity === "block") addError(errors, record, "sensitive_content", message);
    else addWarning(warnings, record, "sensitive_content", message);
  }
}

function collectReferences(record) {
  const references = [];
  for (const value of Array.isArray(record.data.evidence) ? record.data.evidence : []) references.push({ field: "evidence", target: value });
  for (const relation of Array.isArray(record.data.relations) ? record.data.relations : []) {
    if (!relation || typeof relation !== "object") continue;
    if (!VALID_RELATIONS.has(relation.type)) references.push({ field: "relation_type", target: relation.type, invalid: true });
    if (relation.target) references.push({ field: "relation", target: relation.target });
  }
  for (const field of ["supersedes", "superseded_by"]) {
    for (const value of Array.isArray(record.data[field]) ? record.data[field] : []) references.push({ field, target: value });
  }
  return references;
}

function createSchemaSet() {
  try {
    if (!fs.existsSync(path.join(SCHEMA_DIRECTORY, RECORD_SCHEMA))) {
      return { error: `schema files are missing at ${SCHEMA_DIRECTORY}; reinstall the Skill (the scripts/schemas directory must ship with scripts/lib)` };
    }
    return { schemas: new SchemaSet(SCHEMA_DIRECTORY) };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Validate a knowledge repository.
 *
 * errors block a pull request; warnings are recorded and only block when `strict` is set (publish
 * and CI use strict so an intentional exception has to become an explicit policy `allow` entry).
 */
/** Drafts stay local and gitignored, so nothing else reports them: without this a colleague can
 *  finish a record, forget to move it into records/, and see every command stay green. */
function countDrafts(root) {
  const directory = path.join(root, "drafts");
  if (!fs.existsSync(directory)) return 0;
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .length;
}

function validateKnowledgeRepo(repoPath, options = {}) {
  const root = path.resolve(repoPath);
  const strict = options.strict === true;
  const config = path.join(root, CONFIG_FILE);
  const errors = [];
  const warnings = [];
  if (!fs.existsSync(config)) addError(errors, null, "configuration", `missing ${CONFIG_FILE}; run team-wiki init first`);

  let policy;
  try {
    policy = loadPolicy(root);
  } catch (error) {
    addError(errors, null, "policy", error.message);
    policy = { file: POLICY_FILE, present: false, block: [], warn: [], allow: [], rules: [] };
  }

  const { schemas, error: schemaError } = createSchemaSet();
  if (schemaError) addError(errors, null, "schema", schemaError);

  let records = [];
  try {
    records = loadRecords(root);
  } catch (error) {
    addError(errors, null, "frontmatter", error.message);
    return { ok: false, strict, records: 0, drafts: countDrafts(root), errors, warnings, policy_file: policy.file, schema_errors: 0 };
  }

  const byId = new Map();
  for (const record of records) {
    validateRequired(record, errors);
    validateSensitive(record, policy, errors, warnings);
    if (schemas) {
      const result = schemas.validate(record.data, RECORD_SCHEMA);
      for (const item of result.errors) {
        if (suppressedSchemaError(RECORD_SCHEMA, item)) continue;
        addError(errors, record, "schema", `${RECORD_SCHEMA}: ${item.keyword} ${item.message}`);
      }
    }
    if (record.data.type === "case") validateCase(record, errors);
    if (record.data.type === "evidence") validateEvidence(record, errors);
    if (record.data.id) {
      if (byId.has(record.data.id)) addError(errors, record, "duplicate_id", `duplicate record id: ${record.data.id}`);
      byId.set(record.data.id, record);
    }
  }

  for (const record of records) {
    for (const reference of collectReferences(record)) {
      if (reference.invalid) addError(errors, record, "relation_type", `unsupported relation type: ${reference.target}`);
      else if (!byId.has(reference.target)) addError(errors, record, "missing_reference", `${reference.field} target does not exist: ${reference.target}`);
    }
  }

  const blocking = errors.length;
  return {
    ok: blocking === 0 && (!strict || warnings.length === 0),
    strict,
    records: records.length,
    drafts: countDrafts(root),
    errors,
    warnings,
    policy_file: policy.file,
    policy_rules: policy.rules.length,
    schema_errors: errors.filter((error) => error.code === "schema").length,
  };
}

function initKnowledgeRepo(repoPath, options = {}) {
  const report = scaffoldKnowledgeRepo(repoPath, options);
  return { created: !report.already_initialized, ...report };
}

function buildKnowledgeArtifacts(repoPath, options = {}) {
  const root = path.resolve(repoPath);
  const report = validateKnowledgeRepo(root, { strict: options.strict === true });
  if (!report.ok) throw new Error(`knowledge validation failed with ${report.errors.length} error(s)`);
  const records = loadRecords(root).sort((left, right) => String(left.data.id).localeCompare(String(right.data.id)));
  const generated = path.join(root, "generated");
  fs.mkdirSync(generated, { recursive: true });

  const catalog = buildCatalog(records);
  fs.writeFileSync(path.join(generated, "index.md"), renderIndexMarkdown(catalog), "utf8");
  fs.writeFileSync(path.join(generated, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

  const overviewReport = buildOverview(catalog);
  fs.writeFileSync(path.join(generated, "overview.md"), renderOverviewMarkdown(overviewReport), "utf8");

  const nodes = catalog.records.map((entry) => ({
    id: entry.id,
    label: entry.title,
    path: entry.path,
    status: entry.status,
    type: entry.type,
    visibility: entry.visibility,
    areas: entry.areas,
    owners: entry.owners,
  }));
  const edges = [];
  for (const entry of catalog.records) {
    for (const evidenceId of entry.evidence) edges.push({ from: entry.id, relation_type: "has_evidence", to: evidenceId });
    for (const relation of entry.relations) edges.push({ from: entry.id, relation_type: relation.type, to: relation.target });
    for (const target of entry.supersedes) edges.push({ from: entry.id, relation_type: "supersedes", to: target });
    for (const source of entry.superseded_by) edges.push({ from: source, relation_type: "supersedes", to: entry.id });
  }
  edges.sort((left, right) => `${left.from}\0${left.relation_type}\0${left.to}`.localeCompare(`${right.from}\0${right.relation_type}\0${right.to}`));
  const graph = { schema_version: 1, nodes, edges };
  fs.writeFileSync(path.join(generated, "graph-data.json"), `${JSON.stringify(graph, null, 2)}\n`, "utf8");

  const health = {
    schema_version: 1,
    generated_at: null,
    records: records.length,
    errors: report.errors.length,
    warnings: report.warnings.length,
    tool_version: skillVersion(),
    policy_file: report.policy_file,
    policy_rules: report.policy_rules ?? null,
    sha256: crypto.createHash("sha256").update(JSON.stringify(graph)).digest("hex"),
  };
  fs.writeFileSync(path.join(generated, "health-report.json"), `${JSON.stringify(health, null, 2)}\n`, "utf8");

  // The dashboard is a single self-contained file, so it is copied next to the catalog it reads.
  // Opening generated/dashboard.html over HTTP(S) auto-loads ./catalog.json; from file:// the
  // browser forbids that fetch, so the page falls back to its manual import button.
  const dashboardSource = path.resolve(__dirname, "..", "..", DASHBOARD_ASSET);
  const dashboard = fs.existsSync(dashboardSource);
  if (dashboard) fs.copyFileSync(dashboardSource, path.join(generated, "dashboard.html"));

  return {
    nodes: nodes.length,
    edges: edges.length,
    records: records.length,
    warnings: report.warnings.length,
    dashboard,
    catalog,
    overview: overviewReport,
  };
}

function git(repoPath, args) {
  return execFileSync("git", ["-C", repoPath, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function hasCommits(repoPath) {
  try {
    git(repoPath, ["rev-parse", "--verify", "--quiet", "HEAD"]);
    return true;
  } catch (error) {
    return false;
  }
}

function pullKnowledgeRepo(repoPath) {
  const root = path.resolve(repoPath);
  if (!fs.existsSync(path.join(root, ".git"))) throw new Error("knowledge path is not a git repository");
  // Check what the user can act on before shelling out: a raw git failure("ambiguous argument HEAD")
  // tells a new colleague nothing about what to do next.
  if (!fs.existsSync(path.join(root, CONFIG_FILE))) {
    throw new Error(`${root} is not an initialized knowledge repository; run team-wiki init first`);
  }
  if (!hasCommits(root)) throw new Error("knowledge repository has no commits yet; commit the initialized repository before pulling");
  if (git(root, ["status", "--porcelain"])) throw new Error("knowledge repository has uncommitted changes; commit or discard them before pull");
  const before = git(root, ["rev-parse", "HEAD"]);
  git(root, ["fetch", "--prune", "origin"]);
  git(root, ["merge", "--ff-only", "@{u}"]);
  const after = git(root, ["rev-parse", "HEAD"]);
  const artifacts = buildKnowledgeArtifacts(root);
  return { updated: before !== after, previous_head: before, head: after, ...artifacts };
}

module.exports = {
  CONFIG_FILE,
  ID_PATTERNS,
  POLICY_FILE,
  RECORD_DIRECTORIES,
  RECORD_SCHEMA,
  SCHEMA_DIRECTORY,
  buildKnowledgeArtifacts,
  initKnowledgeRepo,
  loadRecords,
  parseFrontmatter,
  pullKnowledgeRepo,
  validateKnowledgeRepo,
};
