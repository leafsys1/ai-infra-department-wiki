"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { afterEach, describe, it } = require("node:test");

const {
  buildKnowledgeArtifacts,
  initKnowledgeRepo,
  pullKnowledgeRepo,
  validateKnowledgeRepo,
} = require("../../scripts/lib/team-wiki");

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

function validCase(overrides = "") {
  return `---
schema_version: 1
id: CASE-2026-0001
type: case
title: Decode optimization validation
status: verified
visibility: internal
owners: [alice]
created: 2026-09-21
updated: 2026-09-21
areas: [inference, performance]
evidence: [EVD-2026-0001]
context:
  workload: inference
  model_family: qwen
  model_version: qwen3.8-27b
  framework: vllm-ascend
  framework_version: 0.26.0rc1
  accelerator_model: ascend-910c
validation:
  repetitions: 3
  conclusion_level: verified
relations:
  - type: supports
    target: DEC-2026-0001
${overrides}---

# Decode optimization validation

## Goal

Validate one controlled optimization.
`;
}

function validEvidence() {
  return `---
schema_version: 1
id: EVD-2026-0001
type: evidence
title: Benchmark evidence
status: verified
visibility: internal
owners: [alice]
created: 2026-09-21
updated: 2026-09-21
source_sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
locator: result.csv:last-row
verified_by: [bob]
verified_at: 2026-09-21
---

# Benchmark evidence

FINISH=48 FAIL=0
`;
}

function validDecision() {
  return `---
schema_version: 1
id: DEC-2026-0001
type: decision
title: Keep the optimization
status: verified
visibility: internal
owners: [bob]
created: 2026-09-21
updated: 2026-09-21
evidence: [EVD-2026-0001]
---

# Keep the optimization

The controlled result is repeatable.
`;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("department knowledge repository", () => {
  it("initializes private-by-default folders without shared cache files", () => {
    const repo = makeTempDir("team-wiki-init-");

    const result = initKnowledgeRepo(repo, { name: "AI Infra Department" });

    assert.equal(result.created, true);
    assert.equal(fs.existsSync(path.join(repo, ".department-wiki.json")), true);
    assert.equal(fs.existsSync(path.join(repo, "records/cases/inference/.gitkeep")), true);
    assert.equal(fs.existsSync(path.join(repo, "records/evidence/.gitkeep")), true);
    assert.equal(fs.existsSync(path.join(repo, "generated/.gitkeep")), true);
    assert.equal(fs.existsSync(path.join(repo, ".wiki-cache.json")), false);
    assert.match(fs.readFileSync(path.join(repo, ".gitignore"), "utf8"), /raw-local\//);
  });

  it("reports an unpublished draft so a finished record cannot be lost quietly", () => {
    const repo = makeTempDir("team-wiki-drafts-");
    initKnowledgeRepo(repo, { name: "AI Infra Department" });
    const cli = path.resolve(__dirname, "../../skills/ai-infra-department-wiki/scripts/team-wiki.js");
    const captured = spawnSync(process.execPath, [cli, "capture", ".", "case", "CASE-2026-0007"], { cwd: repo, encoding: "utf8" });
    assert.equal(captured.status, 0, captured.stderr);

    const validated = spawnSync(process.execPath, [cli, "validate", "."], { cwd: repo, encoding: "utf8" });

    assert.equal(validated.status, 0, validated.stderr);
    assert.match(validated.stdout, /ok=true/);
    assert.match(validated.stdout, /drafts=1 local only/);
    assert.equal(validateKnowledgeRepo(repo).drafts, 1);
  });

  it("accepts a verified case only when referenced evidence exists", () => {
    const repo = makeTempDir("team-wiki-valid-");
    initKnowledgeRepo(repo, { name: "AI Infra Department" });
    writeRecord(repo, "records/cases/inference/CASE-2026-0001.md", validCase());
    writeRecord(repo, "records/evidence/EVD-2026-0001.md", validEvidence());
    writeRecord(repo, "records/decisions/DEC-2026-0001.md", validDecision());

    const report = validateKnowledgeRepo(repo);

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(report.records, 3);
  });

  it("rejects verified cases with missing evidence and blocks secrets", () => {
    const repo = makeTempDir("team-wiki-invalid-");
    initKnowledgeRepo(repo, { name: "AI Infra Department" });
    writeRecord(
      repo,
      "records/cases/inference/CASE-2026-0001.md",
      validCase().replace("evidence: [EVD-2026-0001]", "evidence: [EVD-2026-9999]") +
        "\nAPI token: ghp_1234567890abcdefghijklmnop\n",
    );

    const report = validateKnowledgeRepo(repo);

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.code === "missing_reference"));
    assert.ok(report.errors.some((error) => error.code === "sensitive_content"));
  });

  it("rejects verified cases whose critical applicability context is unknown", () => {
    const repo = makeTempDir("team-wiki-unknown-");
    initKnowledgeRepo(repo, { name: "AI Infra Department" });
    writeRecord(repo, "records/cases/inference/CASE-2026-0001.md", validCase().replace("model_version: qwen3.8-27b", "model_version: unknown"));
    writeRecord(repo, "records/evidence/EVD-2026-0001.md", validEvidence());
    writeRecord(repo, "records/decisions/DEC-2026-0001.md", validDecision());

    const report = validateKnowledgeRepo(repo);

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.code === "unknown_context"));
  });

  it("rejects schema-shape mismatches and records stored under the wrong type directory", () => {
    const repo = makeTempDir("team-wiki-schema-shape-");
    initKnowledgeRepo(repo, { name: "AI Infra Department" });
    const malformed = validCase()
      .replace("owners: [alice]", "owners: alice")
      .replace("relations:\n  - type: supports\n    target: DEC-2026-0001", "relations: invalid");
    writeRecord(repo, "records/decisions/CASE-2026-0001.md", malformed);
    writeRecord(repo, "records/evidence/EVD-2026-0001.md", validEvidence());
    writeRecord(repo, "records/decisions/DEC-2026-0001.md", validDecision());

    const report = validateKnowledgeRepo(repo);

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.code === "field_type" && error.message.includes("owners")));
    assert.ok(report.errors.some((error) => error.code === "field_type" && error.message.includes("relations")));
    assert.ok(report.errors.some((error) => error.code === "record_directory"));
  });

  it("builds deterministic index and graph artifacts from explicit relations", () => {
    const repo = makeTempDir("team-wiki-build-");
    initKnowledgeRepo(repo, { name: "AI Infra Department" });
    writeRecord(repo, "records/cases/inference/CASE-2026-0001.md", validCase());
    writeRecord(repo, "records/evidence/EVD-2026-0001.md", validEvidence());
    writeRecord(repo, "records/decisions/DEC-2026-0001.md", validDecision());

    const first = buildKnowledgeArtifacts(repo);
    const indexBefore = fs.readFileSync(path.join(repo, "generated/index.md"), "utf8");
    const graphBefore = fs.readFileSync(path.join(repo, "generated/graph-data.json"), "utf8");
    const second = buildKnowledgeArtifacts(repo);

    assert.equal(first.nodes, 3);
    assert.equal(first.edges, 3);
    assert.deepEqual(second, first);
    assert.equal(fs.readFileSync(path.join(repo, "generated/index.md"), "utf8"), indexBefore);
    assert.equal(fs.readFileSync(path.join(repo, "generated/graph-data.json"), "utf8"), graphBefore);
    assert.match(indexBefore, /CASE-2026-0001/);
    assert.deepEqual(JSON.parse(graphBefore).edges, [
      { from: "CASE-2026-0001", relation_type: "has_evidence", to: "EVD-2026-0001" },
      { from: "CASE-2026-0001", relation_type: "supports", to: "DEC-2026-0001" },
      { from: "DEC-2026-0001", relation_type: "has_evidence", to: "EVD-2026-0001" },
    ]);
  });

  it("refuses pull when the knowledge worktree is dirty", () => {
    const repo = makeTempDir("team-wiki-pull-");
    initKnowledgeRepo(repo, { name: "AI Infra Department" });
    execFileSync("git", ["init", "-b", "main"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: repo });
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repo });
    fs.writeFileSync(path.join(repo, "local-change.txt"), "dirty\n", "utf8");

    assert.throws(() => pullKnowledgeRepo(repo), /uncommitted changes/i);
  });

  it("keeps generated artifacts local so a rebuild does not dirty git", () => {
    const repo = makeTempDir("team-wiki-generated-");
    initKnowledgeRepo(repo, { name: "AI Infra Department" });
    execFileSync("git", ["init", "-b", "main"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: repo });
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repo });

    buildKnowledgeArtifacts(repo);

    const status = execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" });
    assert.equal(status, "");
  });

  it("exposes init, validate, build and health through the CLI", () => {
    const repo = makeTempDir("team-wiki-cli-");
    const cli = path.join(__dirname, "../../scripts/team-wiki.js");

    const initResult = spawnSync(process.execPath, [cli, "init", repo, "--name", "AI Infra"], {
      encoding: "utf8",
    });
    assert.equal(initResult.status, 0, initResult.stderr);

    const validateResult = spawnSync(process.execPath, [cli, "validate", repo], {
      encoding: "utf8",
    });
    assert.equal(validateResult.status, 0, validateResult.stderr);
    assert.match(validateResult.stdout, /records=0/);

    const buildResult = spawnSync(process.execPath, [cli, "build", repo], {
      encoding: "utf8",
    });
    assert.equal(buildResult.status, 0, buildResult.stderr);

    const healthResult = spawnSync(process.execPath, [cli, "health", repo], {
      encoding: "utf8",
    });
    assert.equal(healthResult.status, 0, healthResult.stderr);
    assert.match(healthResult.stdout, /errors=0/);
  });

  it("capture uses the complete department template", () => {
    const repo = makeTempDir("team-wiki-capture-");
    const cli = path.join(__dirname, "../../scripts/team-wiki.js");
    spawnSync(process.execPath, [cli, "init", repo], { encoding: "utf8" });

    const result = spawnSync(process.execPath, [cli, "capture", repo, "case", "CASE-2026-0002"], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    const draft = fs.readFileSync(path.join(repo, "drafts/CASE-2026-0002.md"), "utf8");
    assert.match(draft, /id: CASE-2026-0002/);
    assert.match(draft, /context:/);
    assert.match(draft, /validation:/);
    assert.match(draft, /## Applicability And Risks/);
  });

  it("capture rejects record ids that can escape the drafts directory", () => {
    const repo = makeTempDir("team-wiki-capture-path-");
    const cli = path.join(__dirname, "../../scripts/team-wiki.js");
    spawnSync(process.execPath, [cli, "init", repo], { encoding: "utf8" });

    const result = spawnSync(process.execPath, [cli, "capture", repo, "case", "CASE-../../outside"], { encoding: "utf8" });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid case id/);
    assert.equal(fs.existsSync(path.join(repo, "outside.md")), false);
  });

  it("publish commits only the validated target record on a contribution branch", () => {
    const repo = makeTempDir("team-wiki-publish-");
    const cli = path.join(__dirname, "../../scripts/team-wiki.js");
    spawnSync(process.execPath, [cli, "init", repo], { encoding: "utf8" });
    execFileSync("git", ["init", "-b", "main"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: repo });
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repo });
    writeRecord(repo, "records/cases/inference/CASE-2026-0001.md", validCase());
    writeRecord(repo, "records/evidence/EVD-2026-0001.md", validEvidence());
    writeRecord(repo, "records/decisions/DEC-2026-0001.md", validDecision());
    execFileSync("git", ["add", "records/evidence/EVD-2026-0001.md", "records/decisions/DEC-2026-0001.md"], { cwd: repo });
    execFileSync("git", ["commit", "-m", "add prerequisites"], { cwd: repo });

    const result = spawnSync(process.execPath, [cli, "publish", repo, "records/cases/inference/CASE-2026-0001.md"], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    assert.match(execFileSync("git", ["branch", "--show-current"], { cwd: repo, encoding: "utf8" }), /knowledge\/.*case-2026-0001/);
    assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }), "");
    assert.match(execFileSync("git", ["show", "--name-only", "--format="], { cwd: repo, encoding: "utf8" }), /CASE-2026-0001\.md/);
  });

  it("publish rejects draft and local-only records", () => {
    const repo = makeTempDir("team-wiki-publish-policy-");
    const cli = path.join(__dirname, "../../scripts/team-wiki.js");
    spawnSync(process.execPath, [cli, "init", repo], { encoding: "utf8" });
    execFileSync("git", ["init", "-b", "main"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: repo });
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repo });
    const draft = validCase().replace("status: verified", "status: draft").replace("visibility: internal", "visibility: local-only");
    writeRecord(repo, "records/cases/inference/CASE-2026-0001.md", draft);
    writeRecord(repo, "records/evidence/EVD-2026-0001.md", validEvidence());
    writeRecord(repo, "records/decisions/DEC-2026-0001.md", validDecision());
    execFileSync("git", ["add", "records/evidence/EVD-2026-0001.md", "records/decisions/DEC-2026-0001.md"], { cwd: repo });
    execFileSync("git", ["commit", "-m", "add prerequisites"], { cwd: repo });

    const result = spawnSync(process.execPath, [cli, "publish", repo, "records/cases/inference/CASE-2026-0001.md"], { encoding: "utf8" });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /draft records cannot be published/);
  });

  it("publish requires main as its base and a target under records", () => {
    const repo = makeTempDir("team-wiki-publish-base-");
    const cli = path.join(__dirname, "../../scripts/team-wiki.js");
    spawnSync(process.execPath, [cli, "init", repo], { encoding: "utf8" });
    execFileSync("git", ["init", "-b", "main"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: repo });
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repo });
    writeRecord(repo, "records/cases/inference/CASE-2026-0001.md", validCase());
    writeRecord(repo, "records/evidence/EVD-2026-0001.md", validEvidence());
    writeRecord(repo, "records/decisions/DEC-2026-0001.md", validDecision());
    execFileSync("git", ["add", "records"], { cwd: repo });
    execFileSync("git", ["commit", "-m", "add records"], { cwd: repo });
    writeRecord(repo, "outside.md", validCase().replace("id: CASE-2026-0001", "id: CASE-2026-0002"));

    const outside = spawnSync(process.execPath, [cli, "publish", repo, "outside.md"], { encoding: "utf8" });
    assert.equal(outside.status, 1);
    assert.match(outside.stderr, /target must be a record under records/);

    fs.rmSync(path.join(repo, "outside.md"));
    execFileSync("git", ["switch", "-c", "work-in-progress"], { cwd: repo });
    fs.appendFileSync(path.join(repo, "records/cases/inference/CASE-2026-0001.md"), "\nNew reviewed detail.\n");
    const wrongBase = spawnSync(process.execPath, [cli, "publish", repo, "records/cases/inference/CASE-2026-0001.md"], { encoding: "utf8" });
    assert.equal(wrongBase.status, 1);
    assert.match(wrongBase.stderr, /publish must start from main/);
  });
});
