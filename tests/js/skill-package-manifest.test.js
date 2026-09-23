"use strict";

/**
 * Guards the install surface.
 *
 * A Hermes URL install fetches SKILL.md plus the support files SKILL.md references, and nothing
 * else. The department Skill needs scripts/lib/*.js, every template and every schema to run, so the
 * "Support Files" list has to stay complete: this test derives the required set from the code and
 * fails when a file is added without being listed.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");

const SKILL = path.resolve(__dirname, "../../skills/ai-infra-department-wiki");
const SKILL_FILE = path.join(SKILL, "SKILL.md");
const ROOT = path.resolve(__dirname, "../..");

function listFiles(directory, prefix = "") {
  if (!fs.existsSync(directory)) return [];
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...listFiles(absolute, relative));
    else if (entry.isFile()) results.push(relative);
  }
  return results;
}

function manifestFromSkillFile(source) {
  const section = source.split(/^## Support Files\s*$/m)[1];
  assert.ok(section, "SKILL.md must have a '## Support Files' section");
  const block = section.match(/```text\n([\s\S]*?)```/);
  assert.ok(block, "the Support Files section must contain a fenced text block");
  return block[1].split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/** Files the CLI cannot start or cannot complete a command without. */
function requiredFiles() {
  const required = [];
  for (const directory of ["scripts", "templates"]) {
    for (const relative of listFiles(path.join(SKILL, directory))) required.push(`${directory}/${relative}`);
  }
  // Every module in the require() graph of the CLI entry point.
  const queue = ["scripts/team-wiki.js"];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const relative = queue.shift();
    const source = fs.readFileSync(path.join(SKILL, relative), "utf8");
    for (const match of source.matchAll(/require\("(\.[^"]+)"\)/g)) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1]));
      assert.ok(fs.existsSync(path.join(SKILL, `${resolved}.js`)), `${relative} requires missing ${resolved}.js`);
      if (!seen.has(`${resolved}.js`)) {
        seen.add(`${resolved}.js`);
        queue.push(`${resolved}.js`);
      }
    }
  }
  for (const module of seen) assert.ok(required.includes(module), `${module} must be part of the runtime set`);
  // Documentation the Skill instructs the agent to read before acting.
  for (const reference of listFiles(path.join(SKILL, "references"))) required.push(`references/${reference}`);
  // The single-file dashboard `build` copies beside the catalog. Not needed to start the CLI, but the
  // documented "Open The Dashboard" step is broken without it, so it ships in the same manifest.
  for (const asset of listFiles(path.join(SKILL, "assets"))) required.push(`assets/${asset}`);
  return [...new Set(required)].sort();
}

describe("Skill package surface", () => {
  it("lists every runtime file in the Support Files manifest", () => {
    const manifest = manifestFromSkillFile(fs.readFileSync(SKILL_FILE, "utf8")).sort();
    const required = requiredFiles();

    assert.deepEqual(manifest, required, "SKILL.md Support Files must match the files the Skill needs at runtime");
  });

  it("keeps the manifest free of paths the installer would refuse or skip", () => {
    const manifest = manifestFromSkillFile(fs.readFileSync(SKILL_FILE, "utf8"));
    // Hermes installers fetch support files only from these directories (tools/skills_hub_models.py
    // _ALLOWED_SUPPORT_DIRS). A path outside them is silently skipped, which is how a skill "installs
    // successfully" and then cannot start.
    const fetchable = ["references", "templates", "scripts", "assets", "examples"];

    for (const entry of manifest) {
      assert.doesNotMatch(entry, /[*?<>]/, `${entry} contains a glob the installer skips`);
      assert.ok(
        fetchable.includes(entry.split("/")[0]),
        `${entry} lives outside the directories an installer fetches (${fetchable.join(", ")})`,
      );
      assert.ok(fs.existsSync(path.join(SKILL, entry)), `${entry} does not exist`);
    }
    assert.equal(new Set(manifest).size, manifest.length, "duplicate entries in the manifest");
  });

  it("never tells the agent to read a file that does not exist", () => {
    const source = fs.readFileSync(SKILL_FILE, "utf8");
    const referenced = [...source.matchAll(/`(references\/[^`]+\.md)`/g)].map((match) => match[1]);

    assert.ok(referenced.length >= 6);
    for (const reference of referenced) {
      assert.ok(fs.existsSync(path.join(SKILL, reference)), `${reference} is referenced but missing`);
    }
  });

  it("keeps the root compatibility copies identical to the packaged Skill", () => {
    for (const relative of listFiles(path.join(SKILL, "references"))) {
      const rootCopy = path.join(ROOT, "references", relative);
      assert.ok(fs.existsSync(rootCopy), `root references/${relative} is missing`);
      assert.equal(
        fs.readFileSync(rootCopy, "utf8"),
        fs.readFileSync(path.join(SKILL, "references", relative), "utf8"),
        `references/${relative} drifted from the packaged Skill`,
      );
    }
  });

  it("re-exports every packaged library from the root compatibility layout", () => {
    const libraries = listFiles(path.join(SKILL, "scripts/lib")).filter((file) => file.endsWith(".js"));

    assert.ok(libraries.includes("query.js"));
    for (const library of libraries) {
      const shim = path.join(ROOT, "scripts/lib", library);
      assert.ok(fs.existsSync(shim), `root scripts/lib/${library} shim is missing`);
      const reexport = require(shim);
      assert.equal(typeof reexport, "object", `root scripts/lib/${library} does not re-export the packaged module`);
      assert.deepEqual(Object.keys(reexport).sort(), Object.keys(require(path.join(SKILL, "scripts/lib", library))).sort());
    }
  });

  it("documents every command the CLI implements", () => {
    const cli = fs.readFileSync(path.join(SKILL, "scripts/team-wiki.js"), "utf8");
    const implemented = new Set([...cli.matchAll(/command === "([a-z-]+)"/g)].map((match) => match[1]));
    const skillDoc = fs.readFileSync(SKILL_FILE, "utf8");
    const usage = cli.split("const USAGE = `")[1].split("`;")[0];
    implemented.delete("help");

    for (const command of implemented) {
      assert.ok(new RegExp(`team-wiki ${command}\\b`).test(usage), `${command} is missing from the CLI usage text`);
      assert.ok(new RegExp(`team-wiki\\.js ${command}\\b`).test(skillDoc), `${command} is missing from SKILL.md`);
    }
    assert.ok(implemented.size >= 13, `expected the full command set, saw ${[...implemented].join(", ")}`);
  });
});
