"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { afterEach, describe, it } = require("node:test");

const { SchemaSet } = require("../../skills/ai-infra-department-wiki/scripts/lib/schema");
const {
  RECORD_SCHEMA,
  SCHEMA_DIRECTORY,
  initKnowledgeRepo,
  validateKnowledgeRepo,
} = require("../../scripts/lib/team-wiki");

const SKILL = path.resolve(__dirname, "../../skills/ai-infra-department-wiki");
const temporaryDirectories = [];

function makeTempDir(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function writeRecord(repo, relativePath, body) {
  const target = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, "utf8");
  return target;
}

function caseRecord(overrides = {}) {
  const fields = { title: "Title", evidence: "[EVD-2026-0001]", ...overrides };
  return `---
schema_version: 1
id: CASE-2026-0001
type: case
title: ${fields.title}
status: verified
visibility: internal
owners: [alice]
created: 2026-09-21
updated: 2026-09-21
evidence: ${fields.evidence}
context:
  workload: inference
  model_family: qwen
  model_version: v3
  framework: vllm-ascend
  framework_version: 0.26.0
  accelerator_model: ascend-910c
validation:
  repetitions: 3
  conclusion_level: verified
---

# Body
`;
}

function evidenceRecord() {
  return `---
schema_version: 1
id: EVD-2026-0001
type: evidence
title: Evidence
status: verified
visibility: internal
owners: [alice]
created: 2026-09-21
updated: 2026-09-21
source_sha256: ${"a".repeat(64)}
locator: result.csv:last-row
verified_by: [bob]
verified_at: 2026-09-21
---

# Evidence
`;
}

function preparedRepo() {
  const repo = makeTempDir("department-schema-");
  initKnowledgeRepo(repo, { name: "AI Infra" });
  return repo;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("dependency-free schema validation", () => {
  it("supports the keyword subset the department schemas use", () => {
    const directory = makeTempDir("schema-keywords-");
    fs.writeFileSync(path.join(directory, "subject.schema.json"), JSON.stringify({
      type: "object",
      required: ["name", "kind"],
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 3, pattern: "^[a-z]+$" },
        kind: { enum: ["a", "b"] },
        version: { const: 1 },
        count: { type: "number", minimum: 1, maximum: 3 },
        items: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string" } },
        either: { anyOf: [{ type: "string" }, { type: "null" }] },
        conditional: { type: "object", if: { properties: { flag: { const: true } } }, then: { required: ["flag"] } },
      },
    }));
    const schemas = new SchemaSet(directory);

    const good = schemas.validate(
      { name: "abc", kind: "a", version: 1, count: 2, items: ["x"], either: null, conditional: { flag: true } },
      "subject.schema.json",
    );
    assert.equal(good.valid, true, JSON.stringify(good.errors));

    const bad = schemas.validate(
      { name: "ab", kind: "c", version: 2, count: 9, items: [], either: 5, conditional: {} },
      "subject.schema.json",
    );
    assert.equal(bad.valid, false);
    assert.deepEqual(bad.errors.map((error) => error.keyword).sort(), ["anyOf", "const", "enum", "maximum", "minItems", "minLength", "required"]);

    const unknown = schemas.validate({ name: "abc", kind: "a", extra: 1 }, "subject.schema.json");
    assert.equal(unknown.valid, false);
    assert.equal(unknown.errors[0].keyword, "additionalProperties");
    assert.match(unknown.errors[0].message, /\/extra/);

    const duplicated = schemas.validate({ name: "abc", kind: "a", items: ["x", "x"] }, "subject.schema.json");
    assert.ok(duplicated.errors.some((error) => error.keyword === "uniqueItems"));

    const wrongType = schemas.validate({ name: "abc", kind: "a", count: "two" }, "subject.schema.json");
    assert.ok(wrongType.errors.some((error) => error.keyword === "type" && /expected number, got string/.test(error.message)));
  });

  it("resolves local $ref between the shipped schemas", () => {
    const schemas = new SchemaSet(SCHEMA_DIRECTORY);

    const ok = schemas.validate({ type: "supports", target: "CASE-2026-0001" }, "relation.schema.json");
    assert.equal(ok.valid, true, JSON.stringify(ok.errors));

    const bad = schemas.validate({ type: "not_a_relation", target: "CASE-2026-0001" }, "relation.schema.json");
    assert.equal(bad.valid, false);
    assert.match(bad.errors[0].message, /is not one of/);
  });

  it("enforces the shipped schema inside validate, not just as documentation", () => {
    const repo = preparedRepo();
    writeRecord(repo, "records/evidence/EVD-2026-0001.md", evidenceRecord());
    writeRecord(repo, "records/cases/inference/CASE-2026-0001.md", caseRecord({ evidence: "notalist" }));

    const report = validateKnowledgeRepo(repo);

    assert.equal(report.ok, false);
    assert.equal(report.schema_errors > 0, true);
    assert.ok(report.errors.some((error) => error.code === "schema" && /type/.test(error.message)));
  });

  it("rejects an evidence id that violates the schema item pattern", () => {
    const repo = preparedRepo();
    writeRecord(repo, "records/evidence/EVD-2026-0001.md", evidenceRecord());
    writeRecord(repo, "records/cases/inference/CASE-2026-0001.md", caseRecord({ evidence: "[not-an-id]" }));

    const report = validateKnowledgeRepo(repo);

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.code === "schema" && /pattern/.test(error.message)));
  });

  it("rejects unexpected relation properties through additionalProperties: false", () => {
    const repo = preparedRepo();
    writeRecord(repo, "records/evidence/EVD-2026-0001.md", evidenceRecord());
    writeRecord(
      repo,
      "records/cases/inference/CASE-2026-0001.md",
      caseRecord().replace("evidence: [EVD-2026-0001]", "evidence: [EVD-2026-0001]\nrelations:\n  - type: supports\n    target: EVD-2026-0001\n    note: not allowed"),
    );

    const report = validateKnowledgeRepo(repo);

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.code === "schema" && /note/.test(error.message)));
  });

  it("reports one diagnostic per mistake rather than one per mechanism", () => {
    const repo = preparedRepo();
    writeRecord(repo, "records/evidence/EVD-2026-0001.md", evidenceRecord());
    writeRecord(repo, "records/cases/inference/CASE-2026-0001.md", caseRecord({ evidence: "[EVD-2026-9999]" }));

    const report = validateKnowledgeRepo(repo);
    const evidenceErrors = report.errors.filter((error) => /EVD-2026-9999/.test(error.message));

    // One dangling reference, reported once — not once by the hand validator and once by the schema.
    assert.equal(evidenceErrors.length, 1, JSON.stringify(evidenceErrors, null, 2));
    assert.equal(evidenceErrors[0].code, "missing_reference");
  });

  it("keeps the schema's required list and the validator's required list in step", () => {
    const schema = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIRECTORY, RECORD_SCHEMA), "utf8"));
    const validatorRequired = ["schema_version", "id", "type", "title", "status", "visibility", "owners", "created", "updated"];

    assert.deepEqual([...schema.required].sort(), [...validatorRequired].sort());
    assert.deepEqual(schema.properties.type.enum, ["case", "evidence", "decision", "pattern", "runbook", "environment"]);
    assert.equal(schema.properties.evidence.items.pattern, "^EVD-[0-9]{4}-[0-9]{4}$");
    assert.deepEqual(schema.properties.status.enum, ["draft", "proposed", "observed", "verified", "replicated", "rejected", "deprecated"]);
  });

  it("keeps the gate schema and the gate verdicts in step", () => {
    const schema = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIRECTORY, "skill-gate.schema.json"), "utf8"));
    const { compareGateRuns, VERDICTS } = require("../../skills/ai-infra-department-wiki/scripts/lib/skill-gate");
    const schemas = new SchemaSet(SCHEMA_DIRECTORY);

    assert.deepEqual([...schema.properties.verdict.enum].sort(), Object.values(VERDICTS).sort());

    // Every verdict the code can produce must be a report the schema accepts.
    const baseline = [{ task_id: "a", passed: false }];
    const accepted = compareGateRuns(
      Array.from({ length: 10 }, (unused, index) => ({ task_id: `t${index}`, passed: false })),
      Array.from({ length: 10 }, (unused, index) => ({ task_id: `t${index}`, passed: index < 7 })),
    );
    const underPowered = compareGateRuns(baseline, [{ task_id: "a", passed: true }]);
    const critical = compareGateRuns(
      [{ task_id: "a", passed: true }, { task_id: "b", passed: false }],
      [{ task_id: "a", passed: false }, { task_id: "b", passed: true }],
      { criticalTasks: ["a"] },
    );

    for (const report of [accepted, underPowered, critical]) {
      const result = schemas.validate({ ...report, proposal_id: "SKP-0001" }, "skill-gate.schema.json");
      assert.equal(result.valid, true, `${report.verdict}: ${JSON.stringify(result.errors)}`);
    }
    assert.deepEqual([accepted.verdict, underPowered.verdict, critical.verdict], [
      VERDICTS.ACCEPTED,
      VERDICTS.UNDER_POWERED,
      VERDICTS.CRITICAL,
    ]);
  });

  it("tells the user an incomplete installation is incomplete instead of raising MODULE_NOT_FOUND", () => {
    const partial = makeTempDir("partial-install-");
    fs.mkdirSync(path.join(partial, "scripts"), { recursive: true });
    fs.copyFileSync(path.join(SKILL, "SKILL.md"), path.join(partial, "SKILL.md"));
    fs.copyFileSync(path.join(SKILL, "scripts/team-wiki.js"), path.join(partial, "scripts/team-wiki.js"));

    const result = spawnSync(process.execPath, [path.join(partial, "scripts/team-wiki.js"), "validate", partial], { encoding: "utf8" });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /installation is incomplete/);
    assert.match(result.stderr, /scripts\/lib/);
    assert.doesNotMatch(result.stderr, /MODULE_NOT_FOUND/);
  });
});
