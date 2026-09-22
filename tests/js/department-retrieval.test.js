"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  buildCatalog,
  buildEdges,
  matchesFilters,
  overview,
  queryCatalog,
  relatedRecords,
  renderIndexMarkdown,
  renderOverviewMarkdown,
  tokenize,
} = require("../../skills/ai-infra-department-wiki/scripts/lib/query");

function record(id, data, relativePath, source = "") {
  return { file: `/repo/${relativePath}`, relativePath, source, data: { id, ...data } };
}

function corpus() {
  return [
    record("CASE-2026-0001", {
      type: "case",
      title: "Prefill throughput gain from batch schedule tuning",
      status: "verified",
      visibility: "internal",
      owners: ["alice"],
      areas: ["inference"],
      tags: ["prefill", "throughput"],
      evidence: ["EVD-2026-0001"],
      relations: [{ type: "supports", target: "PAT-2026-0001" }],
      created: "2026-09-01",
      updated: "2026-09-10",
      context: { workload: "inference", model_family: "deepseek", model_version: "v4", framework: "vllm-ascend", framework_version: "0.26.0", accelerator_model: "910b2c", precision: "bf16" },
    }, "records/cases/inference/CASE-2026-0001.md", "# body\nnothing searchable here\n"),
    record("EVD-2026-0001", {
      type: "evidence",
      title: "Raw benchmark json",
      status: "verified",
      visibility: "internal",
      owners: ["alice"],
      created: "2026-09-01",
      updated: "2026-09-01",
      source_sha256: "a".repeat(64),
      locator: "bench.json#/summary",
    }, "records/evidence/EVD-2026-0001.md"),
    record("CASE-2026-0002", {
      type: "case",
      title: "训练吞吐回退定位",
      status: "observed",
      visibility: "internal",
      owners: ["bob"],
      areas: ["training"],
      tags: ["regression"],
      created: "2026-09-05",
      updated: "2026-09-20",
      context: { workload: "training", model_family: "qwen", framework: "mindspore", accelerator_model: "910b2c" },
    }, "records/cases/training/CASE-2026-0002.md", "# body\n唯一线索是 send/recv 重叠失败\n"),
    record("PAT-2026-0001", {
      type: "pattern",
      title: "Batch schedule interacts with KV pressure",
      status: "proposed",
      visibility: "restricted",
      owners: ["alice", "bob"],
      areas: ["inference"],
      tags: ["prefill"],
      relations: [{ type: "applies_to", target: "CASE-2026-0001" }],
      created: "2026-09-11",
      updated: "2026-09-12",
    }, "records/patterns/PAT-2026-0001.md"),
  ];
}

describe("department retrieval", () => {
  it("builds a deterministic catalog with sorted tokens and metadata", () => {
    const first = buildCatalog(corpus());
    const second = buildCatalog(corpus().reverse());

    assert.equal(first.record_count, 4);
    assert.deepEqual(first.records.map((entry) => entry.id), [
      "CASE-2026-0001",
      "CASE-2026-0002",
      "EVD-2026-0001",
      "PAT-2026-0001",
    ]);
    assert.deepEqual(JSON.stringify(first), JSON.stringify(second));
    const entry = first.records[0];
    assert.equal(entry.context.model_family, "deepseek");
    assert.equal(entry.context.accelerator_model, "910b2c");
    assert.deepEqual(entry.owners, ["alice"]);
    assert.equal(entry.terms.includes("prefill"), true);
  });

  it("ranks by field weight and explains every hit", () => {
    const catalog = buildCatalog(corpus());

    const byTitle = queryCatalog(catalog, { terms: ["prefill"], limit: 10 });
    assert.deepEqual(byTitle.hits.map((hit) => hit.id), ["CASE-2026-0001", "PAT-2026-0001"]);
    assert.ok(byTitle.hits[0].matched.some((item) => item.startsWith("title:prefill")));

    const byId = queryCatalog(catalog, { terms: ["CASE-2026-0002"], limit: 10 });
    assert.equal(byId.hit_count, 1);
    assert.equal(byId.hits[0].id, "CASE-2026-0002");

    const byModel = queryCatalog(catalog, { terms: ["qwen"], limit: 10 });
    assert.deepEqual(byModel.hits.map((hit) => hit.id), ["CASE-2026-0002"]);
    assert.ok(byModel.hits[0].matched.includes("model_family:qwen"));
  });

  it("ANDs terms by default, ORs on request, and falls back to the body", () => {
    const catalog = buildCatalog(corpus());

    const both = queryCatalog(catalog, { terms: ["prefill", "deepseek"], limit: 10 });
    assert.deepEqual(both.hits.map((hit) => hit.id), ["CASE-2026-0001"]);

    const andMiss = queryCatalog(catalog, { terms: ["prefill", "qwen"], limit: 10 });
    assert.equal(andMiss.hit_count, 0);

    const or = queryCatalog(catalog, { terms: ["prefill", "qwen"], any: true, limit: 10 });
    assert.equal(or.hit_count, 3);

    const sources = new Map(corpus().map((item) => [item.data.id, item.source]));
    const bodyOnly = queryCatalog(catalog, { terms: ["send"], limit: 10, sources });
    assert.deepEqual(bodyOnly.hits.map((hit) => hit.id), ["CASE-2026-0002"]);
    assert.ok(bodyOnly.hits[0].matched.includes("text:send"));

    const withoutSources = queryCatalog(catalog, { terms: ["send"], limit: 10 });
    assert.equal(withoutSources.hit_count, 0);
  });

  it("matches Chinese queries through CJK bigrams", () => {
    const catalog = buildCatalog(corpus());

    const hits = queryCatalog(catalog, { terms: ["训练吞吐"], limit: 10 });

    assert.equal(hits.hit_count, 1);
    assert.equal(hits.hits[0].id, "CASE-2026-0002");
    assert.deepEqual(tokenize("训练吞吐"), ["吞吐", "练吞", "训练"]);
  });

  it("keeps kana and astral ideographs inside one run", () => {
    // The prolonged-sound mark is script-Common. Leaving it out of the class would split ケース into
    // ケ + ス and quietly break Japanese queries.
    assert.deepEqual(tokenize("ケース"), ["ケー", "ース"]);
    // Decomposed kana normalizes to the precomposed form that records actually contain.
    assert.deepEqual(tokenize("か\u3099"), tokenize("が"));
    // Han outside the BMP is covered and stays whole; a UTF-16 slice used to emit lone surrogates as
    // index terms, which can never match a query.
    assert.deepEqual(tokenize("汉字𠀋扩展区"), ["字𠀋", "展区", "扩展", "汉字", "𠀋扩"]);
    for (const token of tokenize("汉字𠀋扩展区")) {
      assert.doesNotMatch(Buffer.from(token, "utf8").toString("utf8"), /\uFFFD/, token);
    }
  });

  it("names the fields a term really matched, instead of every field with any content", () => {
    const catalog = buildCatalog(corpus());
    // "deepseek" lives in model_family only; a term matched once must not claim the other fields.
    const hit = queryCatalog(catalog, { terms: ["deepseek"], limit: 10 }).hits[0];

    assert.deepEqual(hit.matched, ["model_family:deepseek"]);
    assert.deepEqual(queryCatalog(catalog, { terms: ["prefill"], limit: 10 }).hits[0].matched, ["tags:prefill", "title:prefill"]);
  });

  it("applies metadata filters and reports corpus aggregates", () => {
    const catalog = buildCatalog(corpus());

    assert.equal(queryCatalog(catalog, { filters: { type: "case" }, limit: 10 }).hit_count, 2);
    assert.equal(queryCatalog(catalog, { filters: { area: "training" }, limit: 10 }).hit_count, 1);
    assert.equal(queryCatalog(catalog, { filters: { owner: "bob" }, limit: 10 }).hit_count, 2);
    assert.equal(queryCatalog(catalog, { filters: { accelerator: "910b2c" }, limit: 10 }).hit_count, 2);
    assert.equal(queryCatalog(catalog, { filters: { since: "2026-09-15" }, limit: 10 }).hit_count, 1);
    assert.equal(matchesFilters(catalog.records[0], { status: "verified" }), true);
    assert.equal(matchesFilters(catalog.records[0], { visibility: "restricted" }), false);

    const table = overview(catalog);
    assert.equal(table.records, 4);
    assert.equal(table.verified_records, 2);
    assert.equal(table.verification_ratio, 0.5);
    assert.equal(table.pending_review, 1);
    assert.equal(table.not_shareable, 1);
    assert.equal(table.newest_update, "2026-09-20");
    assert.equal(table.oldest_update, "2026-09-01");
    assert.deepEqual(table.by_type, [
      { name: "case", count: 2 },
      { name: "evidence", count: 1 },
      { name: "pattern", count: 1 },
    ]);
    assert.deepEqual(table.by_owner.find((row) => row.name === "alice"), { name: "alice", count: 3 });
    assert.deepEqual(table.by_accelerator.find((row) => row.name === "910b2c"), { name: "910b2c", count: 2 });
  });

  it("walks the relation graph in both directions and flags dangling references", () => {
    const catalog = buildCatalog([...corpus(), record("PAT-2026-0002", {
      type: "pattern",
      title: "Dangling",
      status: "observed",
      visibility: "internal",
      owners: ["carol"],
      relations: [{ type: "refutes", target: "CASE-2026-9999" }],
      created: "2026-09-01",
      updated: "2026-09-01",
    }, "records/patterns/PAT-2026-0002.md")]);

    const graph = relatedRecords(catalog, "CASE-2026-0001");
    assert.equal(graph.found, true);
    assert.deepEqual(graph.outgoing.map((item) => item.id), ["EVD-2026-0001", "PAT-2026-0001"]);
    assert.deepEqual(graph.incoming.map((item) => item.id), ["PAT-2026-0001"]);
    assert.equal(graph.incoming[0].relation, "applies_to");

    const dangling = relatedRecords(catalog, "PAT-2026-0002");
    assert.equal(dangling.outgoing[0].resolved, false);
    assert.equal(dangling.outgoing[0].title, null);

    assert.equal(relatedRecords(catalog, "NOPE-0000").found, false);
    assert.equal(buildEdges(catalog).length, 4);
  });

  it("renders index and overview deterministically", () => {
    const catalog = buildCatalog(corpus());
    const index = renderIndexMarkdown(catalog);
    const table = renderOverviewMarkdown(overview(catalog));

    assert.match(index, /\[CASE-2026-0001: Prefill throughput gain from batch schedule tuning\]\(\.\.\/records\/cases\/inference\/CASE-2026-0001\.md\) — verified · areas=inference · owners=alice · model=deepseek · accel=910b2c · updated=2026-09-10/);
    assert.match(table, /- records: 4/);
    assert.match(table, /- verified or replicated: 2 \(50\.0%\)/);
    assert.match(table, /## By accelerator\n\n- 910b2c: 2/);
    assert.equal(renderIndexMarkdown(catalog), index);
    assert.equal(renderOverviewMarkdown(overview(catalog)), table);
  });
});
