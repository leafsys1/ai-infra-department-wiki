"use strict";

/**
 * The dashboard is the human half of the knowledge base, so its access path is a shipped contract:
 * the file travels with the Skill, `build` places it beside the catalog it reads, and the page must
 * work both over HTTP (auto-load) and from file:// (manual import). A dashboard that only exists in
 * the Skill repository is invisible to every colleague who installed the Skill.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const { describe, it } = require("node:test");

const SKILL = path.resolve(__dirname, "../../skills/ai-infra-department-wiki");
const CLI = path.join(SKILL, "scripts/team-wiki.js");
const DASHBOARD = path.join(SKILL, "assets/dashboard/index.html");

function scriptOf(html) {
  const match = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(match, "the dashboard must contain one inline script");
  return match[1];
}

describe("knowledge dashboard", () => {
  it("ships inside the Skill, so an install carries it", () => {
    assert.ok(fs.existsSync(DASHBOARD), "assets/dashboard/index.html must exist in the Skill");

    const manifest = fs
      .readFileSync(path.join(SKILL, "SKILL.md"), "utf8")
      .split(/^## Support Files\s*$/m)[1]
      .match(/```text\n([\s\S]*?)```/)[1]
      .split(/\r?\n/)
      .map((line) => line.trim());

    assert.ok(manifest.includes("assets/dashboard/index.html"), "the dashboard must be in the manifest");
  });

  it("is copied beside the catalog by build, byte for byte", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-build-"));
    const init = spawnSync(process.execPath, [CLI, "init", repo, "--no-scaffold"], { encoding: "utf8" });
    assert.equal(init.status, 0, init.stderr);
    const built = spawnSync(process.execPath, [CLI, "build", repo], { encoding: "utf8" });

    assert.equal(built.status, 0, built.stderr);
    const emitted = path.join(repo, "generated/dashboard.html");
    assert.ok(fs.existsSync(emitted), "build must emit generated/dashboard.html");
    assert.equal(fs.readFileSync(emitted, "utf8"), fs.readFileSync(DASHBOARD, "utf8"));
    // Same directory as the catalog the page reads, so the relative fetch resolves.
    assert.ok(fs.existsSync(path.join(repo, "generated/catalog.json")));
    assert.match(built.stdout, /dashboard=.*generated[/\\]dashboard\.html/);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("auto-loads the sibling catalog over HTTP and degrades to import on file://", () => {
    const html = fs.readFileSync(DASHBOARD, "utf8");

    assert.match(html, /fetch\('\.\/catalog\.json'/, "over http it must load ./catalog.json");
    assert.match(html, /\^https\?:\$/, "the protocol check must gate the automatic fetch");
    assert.match(html, /id="importBtn"/, "file:// needs a manual import button");
    assert.match(html, /id="fileInput"/);
  });

  it("parses as JavaScript and renders records without a build step", () => {
    const html = fs.readFileSync(DASHBOARD, "utf8");
    new vm.Script(scriptOf(html));

    for (const feature of ["renderTree", "renderGraph", "renderMarkdown", "normalizeEdges", "readRecord"]) {
      assert.ok(html.includes(`function ${feature}`), `missing ${feature}`);
    }
    assert.doesNotMatch(scriptOf(html), /\brequire\(/, "the page must stay dependency-free");
  });

  it("renders the built catalog when opened over HTTP, without a browser", () => {
    // Executes the real inline script against the real generated catalog.json. A text-only assertion
    // would pass while the page silently showed its demo data instead of the department's records.
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-render-"));
    assert.equal(spawnSync(process.execPath, [CLI, "init", repo, "--no-scaffold"], { encoding: "utf8" }).status, 0);
    const record = [
      "---",
      "schema_version: 1",
      "id: PAT-2026-9001",
      "type: pattern",
      'title: "Dashboard render probe"',
      "status: proposed",
      "visibility: internal",
      "owners: [probe]",
      "reviewers: []",
      "created: 2026-09-22",
      "updated: 2026-09-22",
      "evidence: []",
      "relations: []",
      "---",
      "",
      "# Dashboard render probe",
      "",
      "## Trigger Signals",
      "",
      "Body text the reader view must show.",
      "",
    ].join("\n");
    fs.mkdirSync(path.join(repo, "records/patterns"), { recursive: true });
    fs.writeFileSync(path.join(repo, "records/patterns/PAT-2026-9001.md"), record, "utf8");
    const built = spawnSync(process.execPath, [CLI, "build", repo], { encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr);

    const generated = path.join(repo, "generated");
    const html = fs.readFileSync(path.join(generated, "dashboard.html"), "utf8");
    const catalog = JSON.parse(fs.readFileSync(path.join(generated, "catalog.json"), "utf8"));
    const nodes = new Map();
    const element = (id) => {
      if (!nodes.has(id)) {
        nodes.set(id, {
          innerHTML: "",
          textContent: "",
          value: "",
          dataset: {},
          classList: { add() {}, remove() {}, toggle() {} },
          click() {},
          querySelectorAll: () => [],
        });
      }
      return nodes.get(id);
    };
    const fetches = [];
    const sandbox = {
      console,
      document: { getElementById: element, querySelectorAll: () => [], querySelector: () => null },
      location: { protocol: "http:" },
      fetch: (url) => {
        fetches.push(url);
        return Promise.resolve({ ok: true, json: () => Promise.resolve(catalog) });
      },
      setTimeout: () => 0,
      FileReader: function FileReader() {},
      window: {},
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    new vm.Script(html.match(/<script>([\s\S]*)<\/script>/)[1]).runInContext(sandbox);

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          assert.deepEqual(fetches, ["./catalog.json"]);
          assert.equal(String(element("totalStat").textContent), String(catalog.record_count));
          assert.equal(catalog.record_count, 1);
          assert.ok(element("knowledgeTree").innerHTML.includes("Dashboard render probe"));
          assert.equal((element("graphCanvas").innerHTML.match(/class="graph-node"/g) || []).length, 1);
          resolve();
        } catch (error) {
          reject(error);
        } finally {
          fs.rmSync(repo, { recursive: true, force: true });
        }
      }, 20);
    });
  });

  it("never opens a source URL outside http, https or mailto", () => {
    const html = fs.readFileSync(DASHBOARD, "utf8");

    // Sources are rendered as data attributes and routed through openSource, so a javascript: or
    // data: URL in a record's frontmatter cannot become a clickable link.
    assert.match(html, /function openSource\(value\)/);
    assert.match(html, /\^\(https\?:\\\/\\\/\|mailto:\)/);
    assert.doesNotMatch(html, /href="\$\{esc\(s\)\}"/, "sources must not be interpolated into href");
  });
});
