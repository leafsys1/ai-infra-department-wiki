#!/usr/bin/env node
// Proves that the install channel is complete: a colleague who receives only the files SKILL.md
// lists under "## Support Files" gets a Skill that actually runs. The copy is assembled from the
// manifest alone (nothing else), then the documented commands are driven from that copy — so a
// runtime file added without being listed, or a documented path that does not exist, fails here
// instead of on a colleague's machine.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILL_SOURCE = path.join(REPO_ROOT, "skills", "ai-infra-department-wiki");
const SKILL_NAME = "ai-infra-department-wiki";

const failures = [];
const checks = [];

function check(label, condition, detail = "") {
  checks.push(`${condition ? "ok  " : "FAIL"}  ${label}`);
  if (!condition) failures.push(`${label}${detail ? `: ${detail}` : ""}`);
}

function manifestFiles() {
  const text = fs.readFileSync(path.join(SKILL_SOURCE, "SKILL.md"), "utf8");
  const marker = "## Support Files";
  const start = text.indexOf(marker);
  if (start === -1) throw new Error("SKILL.md has no '## Support Files' section");
  const block = text.slice(start).match(/```text\n([\s\S]*?)```/);
  if (!block) throw new Error("SKILL.md Support Files section has no ```text block");
  return block[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function walk(directory, prefix = "") {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...walk(path.join(directory, entry.name), relative));
    else found.push(relative);
  }
  return found;
}

function node(args, cwd) {
  return spawnSync(process.execPath, args, { cwd, encoding: "utf8" });
}

function git(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function main() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "verify-skill-install-"));
  const install = path.join(workspace, SKILL_NAME);

  // 1. Assemble the install from the manifest alone.
  const listed = manifestFiles();
  check("SKILL.md lists runtime files", listed.length > 0, `found ${listed.length}`);
  for (const relative of listed) {
    const source = path.join(SKILL_SOURCE, relative);
    if (!fs.existsSync(source)) {
      check(`listed file exists in the Skill: ${relative}`, false);
      continue;
    }
    const target = path.join(install, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  fs.copyFileSync(path.join(SKILL_SOURCE, "SKILL.md"), path.join(install, "SKILL.md"));
  check("every listed file was copied", failures.length === 0);

  // The install must be exactly the shipped Skill: anything a colleague is missing shows up here.
  const shipped = walk(SKILL_SOURCE).filter((relative) => relative !== "SKILL.md");
  const missing = shipped.filter((relative) => !listed.includes(relative));
  check("no shipped runtime file is left out of the manifest", missing.length === 0, missing.join(", "));

  const cli = path.join(install, "scripts/team-wiki.js");

  // 2. Documented paths must resolve inside the assembled install.
  const documents = [
    path.join(install, "SKILL.md"),
    ...fs.readdirSync(path.join(install, "references")).map((name) => path.join(install, "references", name)),
  ];
  const referenced = new Set();
  for (const document of documents) {
    for (const match of fs.readFileSync(document, "utf8").matchAll(/\.department-tools\/[A-Za-z0-9_./-]+/g)) {
      referenced.add(match[0]);
    }
  }
  check("documentation names the pinned toolchain", referenced.size > 0);

  // 3. Drive the documented workflow from the installed copy.
  const repo = path.join(workspace, "knowledge");
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, "README.md"), "# AI Infra Department Knowledge\n", "utf8");

  const initialized = node([cli, "init", ".", "--name", "AI Infra Department", "--json"], repo);
  check("init runs from the installed copy", initialized.status === 0, initialized.stderr.trim());
  check(
    "init is safe on a directory that already has a README",
    initialized.status === 0 && fs.existsSync(path.join(repo, "README.md")),
  );

  for (const relative of referenced) {
    check(`documented pinned path exists after init: ${relative}`, fs.existsSync(path.join(repo, relative)));
  }

  const captured = node([cli, "capture", ".", "case", "CASE-2026-0001"], repo);
  check("capture finds the installed templates", captured.status === 0, captured.stderr.trim());
  check("capture writes the draft", fs.existsSync(path.join(repo, "drafts/CASE-2026-0001.md")));

  const validated = node([cli, "validate", ".", "--strict"], repo);
  check("validate finds the installed schemas", validated.status === 0, validated.stderr.trim());
  check("validate reports a clean repository", /ok=true/.test(validated.stdout), validated.stdout.trim());
  check(
    "validate points out the draft that was never published",
    /drafts=1 local only/.test(validated.stdout),
    validated.stdout.trim(),
  );

  const built = node([cli, "build", "."], repo);
  check("build runs from the installed copy", built.status === 0, built.stderr.trim());
  check("build writes the catalog", fs.existsSync(path.join(repo, "generated/catalog.json")));

  const overview = node([cli, "overview", "."], repo);
  check("overview runs from the installed copy", overview.status === 0, overview.stderr.trim());

  const queried = node([cli, "query", ".", "prefill"], repo);
  check("query runs from the installed copy", queried.status === 0, queried.stderr.trim());

  const pinned = node([".department-tools/scripts/team-wiki.js", "validate", ".", "--strict"], repo);
  check("the pinned toolchain runs standalone (the CI command)", pinned.status === 0, pinned.stderr.trim());

  // 4. The colleague half: clone the shared repository and sync from the installed copy.
  const origin = path.join(workspace, "origin.git");
  git(["init", "-q", "--bare", "--initial-branch=main", origin], workspace);
  git(["init", "-q", "-b", "main"], repo);
  git(["-c", "user.email=a@example.com", "-c", "user.name=alice", "add", "-A"], repo);
  git(["-c", "user.email=a@example.com", "-c", "user.name=alice", "commit", "-qm", "init"], repo);
  git(["remote", "add", "origin", origin], repo);
  const pushed = git(["-c", "user.email=a@example.com", "-c", "user.name=alice", "push", "-q", "-u", "origin", "main"], repo);
  check("the initialized repository pushes to a shared remote", pushed.status === 0, pushed.stderr.trim());

  const colleague = path.join(workspace, "colleague");
  const cloned = git(["clone", "-q", origin, colleague], workspace);
  check("a colleague can clone the shared repository", cloned.status === 0, cloned.stderr.trim());

  const synced = node([cli, "sync", "."], colleague);
  check("sync runs from the installed copy in a colleague clone", synced.status === 0, synced.stderr.trim());
  check("sync reports the corpus", /corpus: records=/.test(synced.stdout), synced.stdout.trim());

  const uninitialized = path.join(workspace, "uninitialized");
  fs.mkdirSync(uninitialized, { recursive: true });
  const refused = node([cli, "capture", ".", "case", "CASE-2026-0002"], uninitialized);
  check("capture refuses an uninitialized directory", refused.status === 1 && /not an initialized knowledge repository/.test(refused.stderr));

  console.log(checks.join("\n"));
  if (failures.length > 0) {
    console.error(`\nverify-skill-install: ${failures.length} failure(s)\n- ${failures.join("\n- ")}`);
    return 1;
  }
  console.log(`\nverify-skill-install: PASS (${checks.length} checks, install assembled from ${listed.length} listed files)`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`verify-skill-install: ${error.message}`);
  process.exitCode = 1;
}
