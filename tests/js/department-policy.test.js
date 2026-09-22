"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { afterEach, describe, it } = require("node:test");

const {
  BUILTIN_BLOCK,
  BUILTIN_WARN,
  isPublicIPv4,
  loadPolicy,
  scanSource,
} = require("../../skills/ai-infra-department-wiki/scripts/lib/policy");
const { initKnowledgeRepo, validateKnowledgeRepo } = require("../../scripts/lib/team-wiki");

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

function caseRecord(extraBody = "") {
  return `---
schema_version: 1
id: CASE-2026-0001
type: case
title: Throughput work
status: observed
visibility: internal
owners: [alice]
created: 2026-09-21
updated: 2026-09-21
context:
  workload: inference
  model_family: qwen
  model_version: v3
  framework: vllm-ascend
  framework_version: 0.26.0
  accelerator_model: ascend-910c
validation:
  repetitions: 1
  conclusion_level: observed
---

# Body

${extraBody}
`;
}

function preparedRepo(policy) {
  const repo = makeTempDir("department-policy-");
  initKnowledgeRepo(repo, { name: "AI Infra" });
  if (policy !== undefined) {
    fs.writeFileSync(path.join(repo, ".department-redaction.json"), typeof policy === "string" ? policy : JSON.stringify(policy, null, 2));
  }
  return repo;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("redaction policy", () => {
  it("classifies addresses and host tags the way the rules claim", () => {
    assert.equal(isPublicIPv4("203.0.113.7"), true);
    assert.equal(isPublicIPv4("61.241.77.34"), true);
    assert.equal(isPublicIPv4("192.168.6.110"), false);
    assert.equal(isPublicIPv4("999.1.1.1"), false);

    const policy = loadPolicy(makeTempDir("policy-none-"));
    const findings = scanSource("public host 203.0.113.7 and tag S900K3-1240 on 192.168.6.110, workdir /home/alice/run/\n", policy);
    const names = findings.map((finding) => finding.rule);

    assert.ok(names.includes("public_ipv4"));
    assert.ok(names.includes("host_tag"));
    assert.ok(names.includes("private_ipv4"));
    assert.ok(names.includes("personal_home"));
    assert.deepEqual(findings.filter((finding) => finding.severity === "block").map((finding) => finding.rule).sort(), ["personal_home", "private_ipv4"]);
    assert.equal(severityOf(findings, "public_ipv4"), "warn");
    assert.equal(severityOf(findings, "host_tag"), "warn");
  });

  it("does not fire the host-id rule on ordinary quantities", () => {
    const policy = loadPolicy(makeTempDir("policy-noise-"));
    const findings = scanSource("max_model_len 16384, kv cache 65536, batch 32768, tp=8\n", policy);
    assert.deepEqual(findings, []);
  });

  it("lets the repository add its own rules to every colleague's validation", () => {
    const repo = preparedRepo({
      schema_version: 1,
      block: [{ name: "customer_codename", pattern: "acme|project-x", flags: "i" }],
      warn: [{ name: "lab_unit", pattern: "(?<![\\w.-])(?:60006|60007)(?![\\w.-])" }],
    });
    writeRecord(repo, "records/cases/inference/CASE-2026-0001.md", caseRecord("See Project-X for the customer. Ran on 60006 in the lab."));

    const report = validateKnowledgeRepo(repo);

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.code === "sensitive_content" && /customer_codename/.test(error.message)));
    assert.ok(report.warnings.some((warning) => warning.code === "sensitive_content" && /lab_unit/.test(warning.message)));
    assert.equal(report.policy_rules, BUILTIN_BLOCK.length + BUILTIN_WARN.length + 2);
  });

  it("keeps warnings out of the way unless strict mode is on", () => {
    const repo = preparedRepo();
    writeRecord(repo, "records/cases/inference/CASE-2026-0001.md", caseRecord("Published endpoint 203.0.113.7."));

    const lenient = validateKnowledgeRepo(repo);
    const strict = validateKnowledgeRepo(repo, { strict: true });

    assert.equal(lenient.ok, true);
    assert.equal(lenient.warnings.length, 1);
    assert.equal(strict.ok, false);
    assert.equal(strict.errors.length, 0);
  });

  it("honours an explicit allow entry for a string a rule would otherwise flag", () => {
    const repo = preparedRepo({
      schema_version: 1,
      allow: [{ name: "public_benchmark_host", pattern: "203\\.0\\.113\\.7" }],
    });
    writeRecord(repo, "records/cases/inference/CASE-2026-0001.md", caseRecord("Published endpoint 203.0.113.7."));

    const report = validateKnowledgeRepo(repo, { strict: true });

    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.equal(report.warnings.length, 0);
  });

  it("can disable a built-in rule but not silently", () => {
    const repo = preparedRepo({ schema_version: 1, disable_builtin: ["public_ipv4"] });
    writeRecord(repo, "records/cases/inference/CASE-2026-0001.md", caseRecord("Published endpoint 203.0.113.7."));

    const report = validateKnowledgeRepo(repo, { strict: true });

    assert.equal(report.ok, true);
    assert.equal(report.policy_rules, BUILTIN_BLOCK.length + BUILTIN_WARN.length - 1);
  });

  it("refuses a malformed policy instead of validating with weaker rules", () => {
    const repo = preparedRepo("{ this is not json }");
    writeRecord(repo, "records/cases/inference/CASE-2026-0001.md", caseRecord());

    const report = validateKnowledgeRepo(repo);

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.code === "policy"));
  });

  it("reports an invalid rule pattern as an error rather than ignoring the rule", () => {
    const repo = preparedRepo({ schema_version: 1, block: [{ name: "broken", pattern: "(" }] });
    writeRecord(repo, "records/cases/inference/CASE-2026-0001.md", caseRecord());

    const report = validateKnowledgeRepo(repo);

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.code === "policy" && /broken/.test(error.message)));
  });

  it("ships a policy file with a usable shape and an ignored examples block", () => {
    const repo = preparedRepo();
    const policyFile = path.join(repo, ".department-redaction.json");
    const parsed = JSON.parse(fs.readFileSync(policyFile, "utf8"));

    assert.equal(parsed.schema_version, 1);
    assert.equal(Array.isArray(parsed.block), true);
    assert.equal(Array.isArray(parsed.warn), true);
    assert.equal(Array.isArray(parsed.allow), true);
    assert.ok(parsed.examples.numeric_host_id.pattern.includes("60006"));
    assert.equal(loadPolicy(repo).present, true);
  });

  it("makes publish refuse a warning unless it is explicitly allowed", () => {
    const repo = preparedRepo();
    const cli = path.join(__dirname, "../../scripts/team-wiki.js");
    const git = (args) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    git(["init", "-b", "main"]);
    git(["config", "user.email", "t@example.com"]);
    git(["config", "user.name", "Test User"]);
    git(["add", "."]);
    git(["commit", "-m", "init"]);
    writeRecord(repo, "records/cases/inference/CASE-2026-0001.md", caseRecord("Published endpoint 203.0.113.7."));

    const refused = spawnSync(process.execPath, [cli, "publish", repo, "records/cases/inference/CASE-2026-0001.md"], { encoding: "utf8" });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /knowledge validation failed/);

    const dryRun = spawnSync(process.execPath, [cli, "publish", repo, "records/cases/inference/CASE-2026-0001.md", "--allow-warnings", "--dry-run"], { encoding: "utf8" });
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /branch=knowledge\/test-user\/case-2026-0001/);
  });
});

function severityOf(findings, rule) {
  const found = findings.find((finding) => finding.rule === rule);
  return found ? found.severity : null;
}
