"use strict";

/**
 * The dashboard is the human half of the knowledge base, so its access path is a shipped contract:
 * the file travels with the Skill, `build` places it beside the catalog it reads, and the page must
 * work both over HTTP (auto-load) and from file:// (manual import). A dashboard that only exists in
 * the Skill repository is invisible to every colleague who installed the Skill.
 *
 * The assertions below track the page's own DOM contract (`$('...')` ids and `data-*` hooks). When
 * the dashboard is rewritten, update this file in the same change: a red test here means the page
 * and the shipped contract disagree.
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

/** Minimal DOM: elements by id, plus the data-* hooks the page wires up after each render. */
function domStub(catalog, graph) {
  const registry = new Map();
  const mk = (dataset) => ({
    dataset: dataset || {},
    style: {},
    innerHTML: "",
    textContent: "",
    value: "",
    classList: { add() {}, remove() {}, toggle() {} },
    onclick: null,
    click() {
      if (this.onclick) this.onclick();
    },
  });
  const register = (attr, markup) => {
    const re = new RegExp(`data-${attr}="([^"]*)"`, "g");
    if (!re.test(markup)) return registry.get(attr) || [];
    re.lastIndex = 0;
    const found = [];
    let m;
    while ((m = re.exec(markup))) found.push(mk({ [attr]: m[1] }));
    registry.set(attr, found);
    return found;
  };
  const nodes = new Map();
  const element = (id) => {
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        textContent: "",
        value: "",
        dataset: {},
        style: {},
        classList: { add() {}, remove() {}, toggle() {} },
        onclick: null,
        oninput: null,
        onchange: null,
        querySelectorAll: () => [],
        click() {},
        _html: "",
        get innerHTML() {
          return this._html;
        },
        set innerHTML(value) {
          this._html = value;
          for (const attr of ["record", "type", "status", "node", "recent", "link", "source"]) register(attr, value);
        },
      });
    }
    return nodes.get(id);
  };
  const tabs = ["overview", "knowledge", "graph"].map((t) => ({ dataset: { tab: t }, classList: { toggle() {} }, onclick: null }));
  const views = ["overview", "knowledge", "graph"].map((v) => ({ id: v, classList: { toggle() {} } }));
  const fetches = [];
  const opened = [];
  const sandbox = {
    console,
    document: {
      getElementById: element,
      querySelectorAll(sel) {
        if (sel === "[data-tab]") return tabs;
        if (sel === ".view") return views;
        const m = /^\[data-([a-z]+)\]$/.exec(sel);
        if (m) return registry.get(m[1]) || [];
        return [];
      },
      querySelector: () => null,
      createElement: () => mk({}),
    },
    location: { protocol: "http:" },
    fetch: (url) => {
      fetches.push(url);
      return Promise.resolve({ ok: true, json: () => Promise.resolve(String(url).includes("graph-data") ? graph : catalog) });
    },
    setTimeout: () => 0,
    FileReader: function FileReader() {},
    window: { open: (url) => opened.push(url) },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return { sandbox, element, fetches, opened, registry };
}

const RECORD = (id, title, sources) =>
  [
    "---",
    "schema_version: 1",
    `id: ${id}`,
    "type: pattern",
    `title: "${title}"`,
    "status: proposed",
    "visibility: internal",
    "origin: external_import",
    "owners: [probe]",
    "reviewers: []",
    "created: 2026-09-22",
    "updated: 2026-09-22",
    "areas: [交付复现, 证据]",
    "tags: [probe, bash -n]",
    "evidence: []",
    "relations: []",
    ...(sources ? [`sources: [${sources.map((s) => `"${s}"`).join(", ")}]`] : []),
    "---",
    "",
    `# ${title}`,
    "",
    "## Trigger Signals",
    "",
    "Body text the reader view must show.",
    "",
  ].join("\n");

function buildProbeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-render-"));
  assert.equal(spawnSync(process.execPath, [CLI, "init", repo, "--no-scaffold"], { encoding: "utf8" }).status, 0);
  fs.mkdirSync(path.join(repo, "records/patterns"), { recursive: true });
  fs.writeFileSync(path.join(repo, "records/patterns/PAT-2026-9001.md"), RECORD("PAT-2026-9001", "Dashboard render probe", ["https://example.com/spec"]), "utf8");
  fs.writeFileSync(path.join(repo, "records/patterns/PAT-2026-9002.md"), RECORD("PAT-2026-9002", "Unsafe source probe", ["javascript:alert(1)"]), "utf8");
  const built = spawnSync(process.execPath, [CLI, "build", repo], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  return repo;
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
    assert.match(html, /id="importBtn"/, "file:// needs a manual import button");
    assert.match(html, /id="fileInput"/);
    assert.match(html, /\$\('importBtn'\)\.onclick/, "the import button must be wired to the file picker");
    assert.match(html, /\$\('fileInput'\)\.onchange/, "the picked file must be parsed and loaded");
    assert.match(html, /file:\/\//, "the failure message must explain the file:// limitation");
  });

  it("parses as JavaScript and renders records without a build step", () => {
    const html = fs.readFileSync(DASHBOARD, "utf8");
    new vm.Script(scriptOf(html));

    for (const feature of ["renderRecords", "renderGraph", "markdown", "showRecord", "load", "filtered", "openSource", "sourcesOf"]) {
      assert.ok(html.includes(`function ${feature}`), `missing ${feature}`);
    }
    assert.match(html, /table-scroll/, "Markdown tables must render as scrollable HTML tables");
    assert.match(html, /language-\$\{esc\(lang\)\}/, "fenced code blocks must preserve language classes");
    assert.match(html, /class=\"mindmap\"/, "Mermaid mindmap blocks must render as readable mindmaps");
    assert.match(html, /source-footer/, "external records must have an original-document footer");
    assert.match(html, /在空白处拖动整张图谱/, "graph instructions must explain background panning");
    assert.doesNotMatch(scriptOf(html), /\brequire\(/, "the page must stay dependency-free");
  });

  it("renders the built catalog when opened over HTTP, without a browser", () => {
    // Executes the real inline script against the real generated catalog.json. A text-only assertion
    // would pass while the page silently showed demo data or an empty graph.
    const repo = buildProbeRepo();
    const generated = path.join(repo, "generated");
    const html = fs.readFileSync(path.join(generated, "dashboard.html"), "utf8");
    const catalog = JSON.parse(fs.readFileSync(path.join(generated, "catalog.json"), "utf8"));
    const graph = JSON.parse(fs.readFileSync(path.join(generated, "graph-data.json"), "utf8"));
    const { sandbox, element, fetches, opened, registry } = domStub(catalog, graph);
    new vm.Script(html.match(/<script>([\s\S]*)<\/script>/)[1]).runInContext(sandbox);

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          assert.equal(catalog.record_count, 2);
          // The relations live in graph-data.json, not on the catalog: a page that only reads
          // catalog.edges silently draws a graph with no relations at all.
          assert.deepEqual(fetches, ["./catalog.json", "./graph-data.json"]);
          assert.equal(String(element("statRecords").textContent), String(catalog.record_count));
          assert.equal(String(element("navTotal").textContent), String(catalog.record_count));
          assert.ok(element("recordList").innerHTML.includes("Dashboard render probe"));
          assert.equal((element("graphWrap").innerHTML.match(/data-node="/g) || []).length, catalog.record_count);
          // `areas`/`tags` are the catalog's field names; a page reading `area`/`model_family`
          // shows "未分类" and an empty pill row for every record.
          assert.ok(element("recordList").innerHTML.includes("交付复现"), "the card must show the record's areas");
          assert.doesNotMatch(element("recordList").innerHTML, /未分类/, "a record with areas must not read 未分类");

          // Clicking a record opens its body, and its sources are clickable only when allowed.
          const first = registry.get("record").find((b) => b.dataset.record === "PAT-2026-9001");
          first.click();
          const detail = element("detail").innerHTML;
          assert.ok(detail.includes("Body text the reader view must show"), "the reader must show the record body");
          assert.ok(detail.includes('data-source="https://example.com/spec"'), "allowed sources must be rendered");

          const sourceButton = registry.get("source").find((b) => b.dataset.source === "https://example.com/spec");
          sourceButton.click();
          assert.deepEqual(opened, ["https://example.com/spec"], "only the allowed source may be opened");

          const unsafe = registry.get("record").find((b) => b.dataset.record === "PAT-2026-9002");
          unsafe.click();
          assert.ok(element("detail").innerHTML.includes('暂无可核验的公开源文档地址'), "unsafe source must not become a link");
          assert.ok(!element("detail").innerHTML.includes('data-source="javascript:'), "unsafe scheme must not be exposed");
          assert.deepEqual(opened, ["https://example.com/spec"], "a blocked source must never be opened");

          // Filtering really filters.
          element("globalSearch").oninput({ target: { value: "Unsafe source probe" } });
          assert.equal((element("recordList").innerHTML.match(/data-record="/g) || []).length, 1);
          element("clearFilters").onclick();
          assert.equal((element("recordList").innerHTML.match(/data-record="/g) || []).length, catalog.record_count);
          resolve();
        } catch (error) {
          reject(error);
        } finally {
          fs.rmSync(repo, { recursive: true, force: true });
        }
      }, 30);
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
