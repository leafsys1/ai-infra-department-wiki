"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { describe, it } = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const SKILL = path.join(ROOT, "skills/ai-infra-department-wiki");

describe("department skill package", () => {
  it("is self-contained for Hermes tap installation", () => {
    for (const relative of [
      "SKILL.md",
      "scripts/team-wiki.js",
      "scripts/lib/team-wiki.js",
      "scripts/lib/skill-gate.js",
      "templates/department/case-template.md",
      "references/ai-infra-schema.md",
      "references/wikiskill-comparison.md",
      "schemas/record.schema.json",
    ]) {
      assert.equal(fs.existsSync(path.join(SKILL, relative)), true, relative);
    }
  });

  it("runs after copying only the skill directory", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "department-skill-package-"));
    const installed = path.join(temp, "ai-infra-department-wiki");
    fs.cpSync(SKILL, installed, { recursive: true });
    const knowledge = path.join(temp, "knowledge");

    const init = spawnSync(process.execPath, [path.join(installed, "scripts/team-wiki.js"), "init", knowledge], { encoding: "utf8" });
    const validate = spawnSync(process.execPath, [path.join(installed, "scripts/team-wiki.js"), "validate", knowledge], { encoding: "utf8" });

    assert.equal(init.status, 0, init.stderr);
    assert.equal(validate.status, 0, validate.stderr);
    assert.match(validate.stdout, /ok=true/);
    fs.rmSync(temp, { recursive: true, force: true });
  });

  it("keeps root compatibility files identical to the self-contained package", () => {
    for (const relative of [
      "references/ai-infra-schema.md",
      "references/contribution-workflow.md",
      "references/security-and-redaction.md",
      "references/review-policy.md",
      "references/wikiskill-comparison.md",
      "schemas/record.schema.json",
      "schemas/relation.schema.json",
      "schemas/skill-gate.schema.json",
    ]) {
      assert.equal(fs.readFileSync(path.join(ROOT, relative), "utf8"), fs.readFileSync(path.join(SKILL, relative), "utf8"), relative);
    }
  });

  it("runs the root compatibility CLI after unified installation", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "department-unified-install-"));
    const installedPersonal = path.join(temp, "skills/llm-wiki");
    const installedDepartment = path.join(temp, "skills/ai-infra-department-wiki");
    fs.mkdirSync(path.dirname(installedPersonal), { recursive: true });
    fs.cpSync(path.join(ROOT, "scripts"), path.join(installedPersonal, "scripts"), { recursive: true });
    fs.cpSync(SKILL, installedDepartment, { recursive: true });
    const knowledge = path.join(temp, "knowledge");

    const result = spawnSync(process.execPath, [path.join(installedPersonal, "scripts/team-wiki.js"), "init", knowledge], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(knowledge, ".department-wiki.json")), true);
    fs.rmSync(temp, { recursive: true, force: true });
  });
});
