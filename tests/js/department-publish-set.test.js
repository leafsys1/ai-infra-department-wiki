"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { afterEach, describe, it } = require("node:test");

const {
  resolvePublishSet,
  publishRecordSet,
} = require("../../skills/ai-infra-department-wiki/scripts/lib/publish");
const { initKnowledgeRepo } = require("../../scripts/lib/team-wiki");

const CLI = path.join(__dirname, "../../scripts/team-wiki.js");
const temporaryDirectories = [];

function makeTempDir(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function git(repo, args) {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function mustGit(repo, args) {
  const result = git(repo, args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", ...options });
}

function record(id, type, extra = {}) {
  const directory = type === "case" ? "records/cases/inference" : `records/${type}s`;
  const context = type === "case"
    ? `context:
  workload: inference
  model_family: qwen
  model_version: v3
  framework: vllm-ascend
  framework_version: 0.26.0
  accelerator_model: ascend-910c
validation:
  repetitions: 3
  conclusion_level: verified
`
    : "";
  const evidence = extra.evidence ? `evidence: [${extra.evidence}]\n` : "";
  const relations = extra.relations ? `relations:\n${extra.relations}` : "";
  const hashes = type === "evidence"
    ? `source_sha256: ${"a".repeat(64)}
locator: results/bench.json#/summary
verified_by: [bob]
verified_at: 2026-09-21
`
    : "";
  return `---
schema_version: 1
id: ${id}
type: ${type}
title: ${extra.title || id}
status: ${extra.status || "verified"}
visibility: ${extra.visibility || "internal"}
owners: [alice]
created: 2026-09-21
updated: 2026-09-21
${evidence}${relations}${hashes}${context}---

# ${id}
`;
}

function write(repo, relativePath, body) {
  const target = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, "utf8");
}

/** A repository with a bare origin, on the default branch, with no records yet. */
function shareableRepo() {
  const parent = makeTempDir("department-publish-");
  const repo = path.join(parent, "knowledge");
  const origin = path.join(parent, "origin.git");
  fs.mkdirSync(repo);
  initKnowledgeRepo(repo, { name: "AI Infra" });
  mustGit(repo, ["init", "-b", "main"]);
  mustGit(repo, ["config", "user.email", "t@example.com"]);
  mustGit(repo, ["config", "user.name", "Test User"]);
  mustGit(repo, ["add", "."]);
  mustGit(repo, ["commit", "-m", "init"]);
  spawnSync("git", ["init", "--bare", "--initial-branch=main", origin], { encoding: "utf8" });
  mustGit(repo, ["remote", "add", "origin", origin]);
  mustGit(repo, ["push", "-u", "origin", "main"]);
  return { repo, origin };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("sync for a colleague joining the department", () => {
  it("shows the whole corpus on a first sync and only the delta afterwards", () => {
    const { repo, origin } = shareableRepo();
    write(repo, "records/evidence/EVD-2026-0001.md", record("EVD-2026-0001", "evidence"));
    write(repo, "records/cases/inference/CASE-2026-0001.md", record("CASE-2026-0001", "case", { evidence: "EVD-2026-0001" }));
    mustGit(repo, ["add", "."]);
    mustGit(repo, ["commit", "-m", "alice: two records"]);
    mustGit(repo, ["push", "origin", "main"]);

    const clone = path.join(path.dirname(repo), "bob");
    spawnSync("git", ["clone", "-q", origin, clone], { encoding: "utf8" });

    const first = run(["sync", clone]);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /records new to you \(first sync\): 2/);
    assert.match(first.stdout, /CASE-2026-0001/);
    assert.match(first.stdout, /EVD-2026-0001/);
    assert.match(first.stdout, /corpus: records=2 verified=2/);
    assert.equal(fs.existsSync(path.join(clone, ".wiki-cache.json")), true);

    const second = run(["sync", clone]);
    assert.match(second.stdout, /no record changed since your last sync/);

    // Alice adds another record; Bob's next sync reports only that one.
    write(repo, "records/patterns/PAT-2026-0001.md", record("PAT-2026-0001", "pattern", { status: "observed" }));
    mustGit(repo, ["add", "."]);
    mustGit(repo, ["commit", "-m", "alice: pattern"]);
    mustGit(repo, ["push", "origin", "main"]);

    const third = run(["sync", clone]);
    assert.match(third.stdout, /updated=true/);
    assert.match(third.stdout, /records since your last sync: 1/);
    assert.match(third.stdout, /PAT-2026-0001/);
    assert.doesNotMatch(third.stdout, /CASE-2026-0001\s+verified/, "an unchanged record must not be reported again");
  });
});

describe("record-set publishing", () => {
  it("publishes a case together with the evidence it newly references", () => {
    const { repo } = shareableRepo();
    write(repo, "records/evidence/EVD-2026-0001.md", record("EVD-2026-0001", "evidence"));
    write(repo, "records/cases/inference/CASE-2026-0001.md", record("CASE-2026-0001", "case", { evidence: "EVD-2026-0001" }));

    const set = resolvePublishSet(repo, ["records/cases/inference/CASE-2026-0001.md"]);
    assert.deepEqual(set.paths, [
      "records/cases/inference/CASE-2026-0001.md",
      "records/evidence/EVD-2026-0001.md",
    ]);
    assert.equal(set.reasons["records/evidence/EVD-2026-0001.md"], "referenced by CASE-2026-0001");

    const result = publishRecordSet(repo, ["records/cases/inference/CASE-2026-0001.md"]);
    assert.deepEqual(result.paths, set.paths);
    assert.equal(result.branch_validation.ok, true);
    assert.equal(result.branch_validation.records, 2);
    assert.equal(result.pr_url, null, "a local bare remote is not a pull-request host");
    assert.match(result.branch, /^knowledge\/test-user\/case-2026-0001$/);
    assert.match(mustGit(repo, ["show", "--name-only", "--format="]), /records\/evidence\/EVD-2026-0001\.md/);
    assert.match(mustGit(repo, ["show", "--name-only", "--format="]), /records\/cases\/inference\/CASE-2026-0001\.md/);
    assert.equal(mustGit(repo, ["status", "--porcelain"]), "");
  });

  it("leaves references that are already on the base branch out of the set", () => {
    const { repo } = shareableRepo();
    write(repo, "records/evidence/EVD-2026-0001.md", record("EVD-2026-0001", "evidence"));
    mustGit(repo, ["add", "."]);
    mustGit(repo, ["commit", "-m", "evidence first"]);
    mustGit(repo, ["push", "origin", "main"]);
    write(repo, "records/cases/inference/CASE-2026-0001.md", record("CASE-2026-0001", "case", { evidence: "EVD-2026-0001" }));

    const set = resolvePublishSet(repo, ["records/cases/inference/CASE-2026-0001.md"]);

    assert.deepEqual(set.paths, ["records/cases/inference/CASE-2026-0001.md"]);
  });

  it("still refuses work that is not part of the set", () => {
    const { repo } = shareableRepo();
    write(repo, "records/evidence/EVD-2026-0001.md", record("EVD-2026-0001", "evidence"));
    write(repo, "records/evidence/EVD-2026-0002.md", record("EVD-2026-0002", "evidence"));
    write(repo, "records/cases/inference/CASE-2026-0001.md", record("CASE-2026-0001", "case", { evidence: "EVD-2026-0001" }));

    const result = run(["publish", repo, "records/cases/inference/CASE-2026-0001.md"]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /changes outside the publish set/);
    assert.match(result.stderr, /EVD-2026-0002/);
    assert.equal(mustGit(repo, ["branch", "--show-current"]), "main");
  });

  it("can publish exactly one record when the author asks for it", () => {
    const { repo } = shareableRepo();
    write(repo, "records/evidence/EVD-2026-0001.md", record("EVD-2026-0001", "evidence"));
    write(repo, "records/cases/inference/CASE-2026-0001.md", record("CASE-2026-0001", "case", { evidence: "EVD-2026-0001" }));

    const set = resolvePublishSet(repo, ["records/cases/inference/CASE-2026-0001.md"], { withDependencies: false });

    assert.deepEqual(set.paths, ["records/cases/inference/CASE-2026-0001.md"]);
  });

  it("rolls the branch back when the committed tree would not validate", () => {
    const { repo } = shareableRepo();
    // A record directory that .gitignore silently swallows: the case is publishable in the working
    // tree, but the evidence it needs can never make it into the branch.
    fs.appendFileSync(path.join(repo, ".gitignore"), "records/evidence/*.md\n");
    mustGit(repo, ["add", ".gitignore"]);
    mustGit(repo, ["commit", "-m", "ignore evidence"]);
    write(repo, "records/evidence/EVD-2026-0001.md", record("EVD-2026-0001", "evidence"));
    write(repo, "records/cases/inference/CASE-2026-0001.md", record("CASE-2026-0001", "case", { evidence: "EVD-2026-0001" }));
    const branchesBefore = mustGit(repo, ["branch", "--list"]).split("\n").filter(Boolean).sort();

    const result = run(["publish", repo, "records/cases/inference/CASE-2026-0001.md"]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /rolled back/);
    assert.deepEqual(mustGit(repo, ["branch", "--list"]).split("\n").filter(Boolean).sort(), branchesBefore);
    assert.equal(mustGit(repo, ["branch", "--show-current"]), "main");
  });

  it("refuses a set that does not validate and stays on the default branch", () => {
    const { repo } = shareableRepo();
    write(repo, "records/patterns/PAT-2026-0001.md", record("PAT-2026-0001", "pattern", { status: "observed", relations: "  - type: applies_to\n    target: CASE-2026-9999\n" }));

    const result = run(["publish", repo, "records/patterns/PAT-2026-0001.md"]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /validation failed/);
    assert.equal(mustGit(repo, ["branch", "--show-current"]), "main");
  });

  it("derives the pull-request link from a GitHub remote without contacting it", () => {
    const { repo } = shareableRepo();
    mustGit(repo, ["remote", "set-url", "origin", "git@github.com:acme/ai-infra-knowledge.git"]);
    write(repo, "records/evidence/EVD-2026-0001.md", record("EVD-2026-0001", "evidence"));
    write(repo, "records/cases/inference/CASE-2026-0001.md", record("CASE-2026-0001", "case", { evidence: "EVD-2026-0001" }));

    const result = run(["publish", repo, "records/cases/inference/CASE-2026-0001.md"]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /open a pull request: https:\/\/github\.com\/acme\/ai-infra-knowledge\/compare\/main\.\.\.knowledge%2Ftest-user%2Fcase-2026-0001\?expand=1/);
  });

  it("pushes explicitly, reads the remote commit back, and reports a pull-request link", () => {
    const { repo, origin } = shareableRepo();
    write(repo, "records/evidence/EVD-2026-0001.md", record("EVD-2026-0001", "evidence"));
    write(repo, "records/cases/inference/CASE-2026-0001.md", record("CASE-2026-0001", "case", { evidence: "EVD-2026-0001" }));

    const result = run(["publish", repo, "records/cases/inference/CASE-2026-0001.md", "--push"]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /pushed=[0-9a-f]{8} \(remote readback verified\)/);
    const local = mustGit(repo, ["rev-parse", "HEAD"]);
    const remote = spawnSync("git", ["--git-dir", origin, "rev-parse", "knowledge/test-user/case-2026-0001"], { encoding: "utf8" }).stdout.trim();
    assert.equal(remote, local);
    assert.equal(mustGit(repo, ["ls-tree", "-r", "--name-only", `origin/knowledge/test-user/case-2026-0001`]).includes("EVD-2026-0001.md"), true);
  });

  it("does not push without --push", () => {
    const { repo, origin } = shareableRepo();
    write(repo, "records/evidence/EVD-2026-0001.md", record("EVD-2026-0001", "evidence"));
    write(repo, "records/cases/inference/CASE-2026-0001.md", record("CASE-2026-0001", "case", { evidence: "EVD-2026-0001" }));

    const result = run(["publish", repo, "records/cases/inference/CASE-2026-0001.md"]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /not pushed/);
    const remoteBranches = spawnSync("git", ["--git-dir", origin, "branch", "--list"], { encoding: "utf8" }).stdout;
    assert.doesNotMatch(remoteBranches, /knowledge/);
  });

  it("shows the plan without touching Git on --dry-run", () => {
    const { repo } = shareableRepo();
    write(repo, "records/evidence/EVD-2026-0001.md", record("EVD-2026-0001", "evidence"));
    write(repo, "records/cases/inference/CASE-2026-0001.md", record("CASE-2026-0001", "case", { evidence: "EVD-2026-0001" }));

    const result = run(["publish", repo, "records/cases/inference/CASE-2026-0001.md", "--dry-run"]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /branch=knowledge\/test-user\/case-2026-0001/);
    assert.match(result.stdout, /referenced by CASE-2026-0001/);
    assert.match(result.stdout, /dry-run: message=knowledge: add CASE-2026-0001/);
    assert.equal(mustGit(repo, ["branch", "--show-current"]), "main");
    assert.equal(mustGit(repo, ["branch", "--list"]).includes("knowledge/"), false);
  });

  it("refuses a draft or a local-only record as part of a set", () => {
    const { repo } = shareableRepo();
    write(repo, "records/cases/inference/CASE-2026-0001.md", record("CASE-2026-0001", "case", { status: "draft" }));

    const draft = run(["publish", repo, "records/cases/inference/CASE-2026-0001.md"]);
    assert.equal(draft.status, 1);
    assert.match(draft.stderr, /draft records cannot be published/);

    write(repo, "records/cases/inference/CASE-2026-0001.md", record("CASE-2026-0001", "case", { visibility: "local-only" }));
    const localOnly = run(["publish", repo, "records/cases/inference/CASE-2026-0001.md"]);
    assert.equal(localOnly.status, 1);
    assert.match(localOnly.stderr, /local-only records cannot be published/);
  });

  it("names every unrelated change when it refuses, so the author knows what to do", () => {
    const { repo } = shareableRepo();
    write(repo, "records/evidence/EVD-2026-0001.md", record("EVD-2026-0001", "evidence"));
    write(repo, "records/patterns/PAT-2026-0001.md", record("PAT-2026-0001", "pattern", { status: "observed" }));
    write(repo, "records/cases/inference/CASE-2026-0001.md", record("CASE-2026-0001", "case", { evidence: "EVD-2026-0001" }));

    const result = run(["publish", repo, "records/cases/inference/CASE-2026-0001.md"]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /PAT-2026-0001\.md/);
    assert.doesNotMatch(result.stderr, /EVD-2026-0001\.md/, "the evidence is part of the set and must not be listed as unrelated");
    assert.equal(mustGit(repo, ["branch", "--show-current"]), "main");
  });
});
