"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { afterEach, describe, it } = require("node:test");

const {
  TOOLS_MANIFEST,
  compareTools,
  initKnowledgeRepo,
  upgradeTools,
} = require("../../skills/ai-infra-department-wiki/scripts/lib/scaffold");

const SKILL = path.resolve(__dirname, "../../skills/ai-infra-department-wiki");
const CLI = path.join(SKILL, "scripts/team-wiki.js");
const temporaryDirectories = [];

function makeTempDir(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", ...options });
}

function git(repo, args) {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function record(id, overrides = {}) {
  const fields = { type: "case", status: "observed", visibility: "internal", owners: "[alice]", ...overrides };
  const directory = fields.type === "case" ? "records/cases/inference" : `records/${fields.type}s`;
  const context = fields.type === "case"
    ? `context:
  workload: inference
  model_family: qwen
  model_version: v3
  framework: vllm-ascend
  framework_version: 0.26.0
  accelerator_model: ascend-910c
validation:
  repetitions: 1
  conclusion_level: observed
`
    : "";
  return {
    path: `${directory}/${id}.md`,
    body: `---
schema_version: 1
id: ${id}
type: ${fields.type}
title: ${fields.title || "Record " + id}
status: ${fields.status}
visibility: ${fields.visibility}
owners: ${fields.owners}
created: 2026-09-21
updated: 2026-09-21
${context}---

# Body
`,
  };
}

function writeRecord(repo, entry) {
  const target = path.join(repo, entry.path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, entry.body, "utf8");
}

function initializedRepo(prefix = "department-scaffold-") {
  const repo = makeTempDir(prefix);
  initKnowledgeRepo(repo, { name: "AI Infra" });
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "t@example.com"]);
  git(repo, ["config", "user.name", "Test User"]);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "init"]);
  return repo;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("knowledge repository scaffolding", () => {
  it("completes a repository that already has content instead of refusing it", () => {
    const repo = makeTempDir("department-existing-");
    fs.writeFileSync(path.join(repo, "README.md"), "# my own readme\n", "utf8");
    fs.writeFileSync(path.join(repo, "LICENSE"), "MIT\n", "utf8");

    const result = run(["init", repo, "--name", "AI Infra"]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(repo, "README.md"), "utf8"), "# my own readme\n");
    assert.match(result.stdout, /kept\s+README\.md/);
    assert.match(result.stdout, /existing content kept: 2 entry/);
    assert.equal(fs.existsSync(path.join(repo, ".department-wiki.json")), true);
  });

  it("is idempotent and never overwrites an edited file", () => {
    const repo = initializedRepo();
    const policy = path.join(repo, ".department-redaction.json");
    const edited = JSON.parse(fs.readFileSync(policy, "utf8"));
    edited.block.push({ name: "ours", pattern: "codeword" });
    fs.writeFileSync(policy, `${JSON.stringify(edited, null, 2)}\n`, "utf8");

    const second = run(["init", repo]);

    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /completed/);
    assert.match(second.stdout, /kept\s+\.department-redaction\.json/);
    assert.deepEqual(JSON.parse(fs.readFileSync(policy, "utf8")).block.length, edited.block.length);
  });

  it("writes the governance files a shared repository needs", () => {
    const repo = initializedRepo();

    for (const relative of [
      ".github/workflows/knowledge-validate.yml",
      ".github/pull_request_template.md",
      ".github/CODEOWNERS",
      "CONTRIBUTING.md",
      ".department-redaction.json",
      TOOLS_MANIFEST,
    ]) {
      assert.equal(fs.existsSync(path.join(repo, relative)), true, relative);
    }
    const workflow = fs.readFileSync(path.join(repo, ".github/workflows/knowledge-validate.yml"), "utf8");
    assert.match(workflow, /node \.department-tools\/scripts\/team-wiki\.js validate \. --strict/);
    assert.match(workflow, /node \.department-tools\/scripts\/team-wiki\.js build \./);
    const template = fs.readFileSync(path.join(repo, ".github/pull_request_template.md"), "utf8");
    assert.match(template, /Sensitive content was removed rather than relabelled/);
    const contributing = fs.readFileSync(path.join(repo, "CONTRIBUTING.md"), "utf8");
    assert.match(contributing, /Node\.js 22 or newer/);
  });

  it("pins a toolchain the whole repository shares and CI can run offline", () => {
    const repo = initializedRepo();
    const manifest = JSON.parse(fs.readFileSync(path.join(repo, TOOLS_MANIFEST), "utf8"));

    assert.equal(manifest.skill_name, "ai-infra-department-wiki");
    assert.equal(Object.keys(manifest.files).length, 18);
    assert.ok(Object.keys(manifest.files).includes("scripts/lib/query.js"));
    assert.ok(Object.keys(manifest.files).includes("assets/dashboard/index.html"));
    assert.ok(Object.keys(manifest.files).every((file) => /^(scripts|templates|assets)\//.test(file)));

    // The pinned copy is a complete Skill in its own right: no reference to the installed one.
    const direct = spawnSync(process.execPath, [path.join(repo, ".department-tools/scripts/team-wiki.js"), "validate", repo], { encoding: "utf8" });
    assert.equal(direct.status, 0, direct.stderr);
    assert.match(direct.stdout, /ok=true/);
  });

  it("runs the exact commands CI runs, including inside the pinned toolchain", () => {
    const repo = initializedRepo();
    writeRecord(repo, record("CASE-2026-0001", { title: "Prefill throughput after batch schedule tuning" }));
    const tools = path.join(repo, ".department-tools/scripts/team-wiki.js");

    const validated = spawnSync(process.execPath, [tools, "validate", ".", "--strict"], { cwd: repo, encoding: "utf8" });
    assert.equal(validated.status, 0, validated.stderr);
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "add record"]);
    const built = spawnSync(process.execPath, [tools, "build", "."], { cwd: repo, encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr);
    assert.match(built.stdout, /records=1/);
    const overview = spawnSync(process.execPath, [tools, "overview", "."], { cwd: repo, encoding: "utf8" });
    assert.equal(overview.status, 0, overview.stderr);

    assert.equal(fs.existsSync(path.join(repo, "generated/catalog.json")), true);
    assert.equal(fs.existsSync(path.join(repo, "generated/overview.md")), true);
    // Generated artifacts must not dirty the repository.
    assert.equal(git(repo, ["status", "--porcelain"]), "");
  });

  it("reports tool drift and re-pins on request", () => {
    const repo = initializedRepo();
    assert.equal(compareTools(repo, SKILL).in_sync, true);

    const drifted = path.join(repo, ".department-tools/scripts/lib/query.js");
    fs.appendFileSync(drifted, "\n// local edit\n");
    const drift = compareTools(repo, SKILL);
    assert.equal(drift.in_sync, false);
    assert.deepEqual(drift.changed, ["scripts/lib/query.js"]);

    const dry = upgradeTools(repo, SKILL);
    assert.equal(dry.written, false);

    const written = upgradeTools(repo, SKILL, { write: true });
    assert.equal(written.written, true);
    assert.equal(compareTools(repo, SKILL).in_sync, true);
    assert.doesNotMatch(fs.readFileSync(drifted, "utf8"), /local edit/);

    // A file the pinned set no longer contains is dropped.
    const stale = path.join(repo, ".department-tools/scripts/lib/obsolete.js");
    fs.writeFileSync(stale, "// gone\n", "utf8");
    upgradeTools(repo, SKILL, { write: true });
    assert.equal(fs.existsSync(stale), false);
  });

  it("refuses to run upgrade-tools from the pinned copy itself", () => {
    const repo = initializedRepo();
    const result = spawnSync(process.execPath, [path.join(repo, ".department-tools/scripts/team-wiki.js"), "upgrade-tools", repo], { encoding: "utf8" });

    assert.equal(result.status, 2);
    assert.match(result.stderr, /must run from the installed Skill/);
  });

  it("records the repository configuration without a timestamp so init stays reproducible", () => {
    const first = initializedRepo("department-config-a-");
    const second = initializedRepo("department-config-b-");
    const read = (repo) => JSON.parse(fs.readFileSync(path.join(repo, ".department-wiki.json"), "utf8"));

    assert.deepEqual(read(first), read(second));
    assert.equal(read(first).default_branch, "main");
    assert.equal(read(first).tools_directory, ".department-tools");
  });

  it("can skip governance files when the organization brings its own", () => {
    const repo = makeTempDir("department-no-scaffold-");
    const result = run(["init", repo, "--no-scaffold"]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(repo, ".github/CODEOWNERS")), false);
    assert.equal(fs.existsSync(path.join(repo, TOOLS_MANIFEST)), true);
  });

  it("refuses to capture into a directory that was never initialized", () => {
    const repo = makeTempDir("department-uninitialized-");
    const result = run(["capture", repo, "case", "CASE-2026-0001"]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /not an initialized knowledge repository/);
  });
  it("documents only pinned paths that init actually writes", () => {
    const repo = initializedRepo();
    const documents = [
      path.join(SKILL, "SKILL.md"),
      ...fs.readdirSync(path.join(SKILL, "references")).map((name) => path.join(SKILL, "references", name)),
    ];
    const referenced = new Set();
    for (const file of documents) {
      for (const match of fs.readFileSync(file, "utf8").matchAll(/\.department-tools\/[A-Za-z0-9_./-]+/g)) {
        referenced.add(match[0]);
      }
    }

    assert.ok(referenced.size > 0, "expected the documentation to name the pinned toolchain");
    for (const relative of referenced) {
      assert.equal(
        fs.existsSync(path.join(repo, relative)),
        true,
        `${relative} is documented but init does not write it — a colleague following the Skill would fail`,
      );
    }
  });

  it("tells a new colleague what to do instead of leaking git errors", () => {
    const notARepository = makeTempDir("department-notrepo-");
    const pulled = run(["pull", notARepository]);
    assert.equal(pulled.status, 1);
    assert.match(pulled.stderr, /not a git repository/);

    const uninitialized = makeTempDir("department-uninit-sync-");
    git(uninitialized, ["init"]);
    const synced = run(["sync", uninitialized]);
    assert.equal(synced.status, 1);
    assert.match(synced.stderr, /not an initialized knowledge repository/);

    const noCommit = makeTempDir("department-nocommit-");
    assert.equal(run(["init", noCommit]).status, 0);
    git(noCommit, ["init"]);
    const empty = run(["pull", noCommit]);
    assert.equal(empty.status, 1);
    assert.match(empty.stderr, /has no commits yet/);
    assert.doesNotMatch(empty.stderr, /ambiguous argument/);
  });
});
