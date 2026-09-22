#!/usr/bin/env node
"use strict";

/**
 * team-wiki — the department knowledge CLI.
 *
 * Every subcommand is offline, dependency-free and deterministic, because the same binary runs in
 * CI on a colleague's machine and inside an agent session.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function fail(message, code = 1) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exitCode = code;
  return code;
}

let core;
let gateModule;
let publishModule;
let queryModule;
let scaffoldModule;
let SchemaSet;
try {
  core = require("./lib/team-wiki");
  gateModule = require("./lib/skill-gate");
  publishModule = require("./lib/publish");
  queryModule = require("./lib/query");
  scaffoldModule = require("./lib/scaffold");
  ({ SchemaSet } = require("./lib/schema"));
} catch (error) {
  // A single-URL install used to produce exactly this: a SKILL.md and scripts/team-wiki.js without
  // scripts/lib, and the user saw a raw MODULE_NOT_FOUND stack. Say what is wrong and how to fix it.
  process.stderr.write(
    "ERROR: this Skill installation is incomplete.\n"
    + `  ${error.message}\n`
    + "  scripts/lib/ (and templates/) must sit next to scripts/team-wiki.js.\n"
    + "  Reinstall the whole skill directory:\n"
    + "    hermes skills tap add <owner>/<repo> && hermes skills install <owner>/<repo>/ai-infra-department-wiki\n"
    + "    # or: bash install.sh --platform hermes\n"
    + "  See the 'Support Files' section of SKILL.md for the complete file list.\n",
  );
  process.exitCode = 1;
  process.exit(1);
}

const USAGE = `team-wiki — reviewed AI Infra department knowledge

Usage:
  team-wiki init <repo> [--name <name>] [--no-scaffold]      create or complete a knowledge repository
  team-wiki pull <repo>                                      fast-forward the clone and rebuild artifacts
  team-wiki sync <repo>                                      pull, then report what colleagues added
  team-wiki capture <repo> <type> <id>                       start a draft from the department template
  team-wiki validate <repo> [--strict] [--json]              schema, evidence, reference and redaction checks
  team-wiki build <repo>                                     regenerate index, catalog, overview and graph
  team-wiki overview <repo> [--json]                         corpus aggregates (type, area, owner, model)
  team-wiki health <repo>                                    one-line validation and redaction status
  team-wiki query <repo> [terms...] [filters]                search records across the department
  team-wiki show <repo> <id> [--json]                        print the record that owns an id
  team-wiki related <repo> <id> [--json]                     walk the relation graph around a record
  team-wiki publish <repo> <record...> [--push] [--dry-run]  publish a record set on a contribution branch
  team-wiki gate <repo> <baseline.json> <candidate.json> <id> score a held-out Skill candidate
  team-wiki upgrade-tools <repo> [--write]                   re-pin .department-tools/ to this Skill version
  team-wiki help

Capture types: case | evidence | decision | pattern | runbook | environment

Query filters:
  --type --status --visibility --area --owner --tag --model --framework --accelerator --since
  --limit <n> --any          (--any = OR between terms; default is AND)

Publish flags:
  --push                 push the contribution branch and read the remote commit back
  --dry-run              show the branch, the record set and the commit message, change nothing
  --only                 do not follow evidence/relation references into the publish set
  --allow-warnings       publish despite redaction warnings (blockers always fail)
  --message "<text>"     commit message (default: "knowledge: add <ids>")

Gate flags:
  --alpha <p>            significance level (default 0.05)
  --min-effect <delta>   smallest score delta worth acting on (default 0)
  --min-discordant <n>   extra bar on discordant pairs, on top of the statistical floor
  --critical <file>      JSON array or newline list of task ids that must not regress

Exit codes: 0 ok, 1 error, 2 usage, 3 gate not accepted
`;

const BOOLEAN_FLAGS = new Set([
  "push", "dry-run", "only", "json", "strict", "any", "write", "no-scaffold", "allow-warnings", "help",
]);

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "-h") {
      flags.help = true;
      continue;
    }
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const equals = body.indexOf("=");
      const name = equals >= 0 ? body.slice(0, equals) : body;
      if (equals >= 0) {
        flags[name] = body.slice(equals + 1);
      } else if (BOOLEAN_FLAGS.has(name)) {
        flags[name] = true;
      } else {
        const value = argv[index + 1];
        flags[name] = value === undefined || value.startsWith("--") ? true : value;
        if (typeof flags[name] === "string") index += 1;
      }
      continue;
    }
    positionals.push(token);
  }
  return { positionals, flags };
}

function requireValue(flags, name, fallback) {
  const value = flags[name];
  if (value === undefined) return fallback;
  if (value === true) throw new Error(`--${name} needs a value`);
  return value;
}

/** Numeric flag that stays `undefined` when absent, so the library default applies. */
function numberFlag(flags, name) {
  const value = requireValue(flags, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} needs a number, got ${value}`);
  return parsed;
}

function draftTemplate(type, id) {
  const date = new Date().toISOString().slice(0, 10);
  const prefixes = { case: "CASE", evidence: "EVD", decision: "DEC", pattern: "PAT", runbook: "RUN", environment: "ENV" };
  if (!prefixes[type]) throw new Error(`unsupported capture type: ${type} (expected one of ${Object.keys(prefixes).join(", ")})`);
  if (!core.ID_PATTERNS[type].test(id)) throw new Error(`invalid ${type} id: ${id}`);
  const skillRoot = path.resolve(__dirname, "..");
  const templatePath = path.join(skillRoot, "templates", "department", `${type}-template.md`);
  if (!fs.existsSync(templatePath)) throw new Error(`department template missing: ${templatePath} (incomplete Skill installation?)`);
  return fs.readFileSync(templatePath, "utf8")
    .replace(/^(id:)\s*.*$/m, `$1 ${id}`)
    .replace(/^(created:)\s*.*$/m, `$1 ${date}`)
    .replace(/^(updated:)\s*.*$/m, `$1 ${date}`);
}

function capture(repoPath, type, id) {
  const root = path.resolve(repoPath);
  if (!fs.existsSync(path.join(root, ".department-wiki.json"))) {
    throw new Error(`${root} is not an initialized knowledge repository; run team-wiki init first`);
  }
  const drafts = path.join(root, "drafts");
  fs.mkdirSync(drafts, { recursive: true });
  const target = path.join(drafts, `${id}.md`);
  if (fs.existsSync(target)) throw new Error(`draft already exists: ${target}`);
  fs.writeFileSync(target, draftTemplate(type, id), "utf8");
  return target;
}

function filterOptions(flags) {
  return {
    type: requireValue(flags, "type"),
    status: requireValue(flags, "status"),
    visibility: requireValue(flags, "visibility"),
    area: requireValue(flags, "area"),
    owner: requireValue(flags, "owner"),
    tag: requireValue(flags, "tag"),
    model: requireValue(flags, "model"),
    framework: requireValue(flags, "framework"),
    accelerator: requireValue(flags, "accelerator"),
    since: requireValue(flags, "since"),
  };
}

function loadCatalog(repoPath) {
  const root = path.resolve(repoPath);
  return queryModule.buildCatalog(core.loadRecords(root));
}

function readSources(catalog, repoPath) {
  const root = path.resolve(repoPath);
  const sources = new Map();
  for (const entry of catalog.records) {
    try {
      sources.set(entry.id, fs.readFileSync(path.join(root, entry.path), "utf8"));
    } catch {
      // A record that disappeared between catalog and query is not worth failing a search over.
    }
  }
  return sources;
}

function findEntry(catalog, id) {
  return catalog.records.find((entry) => entry.id === id) || null;
}

function gate(repoPath, baselineFile, candidateFile, proposalId, flags) {
  const root = path.resolve(repoPath);
  if (!/^SKP-[A-Za-z0-9._-]+$/.test(proposalId || "")) throw new Error(`invalid proposal id: ${proposalId}`);
  const read = (file) => JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  let criticalTasks = [];
  const criticalFile = requireValue(flags, "critical");
  if (typeof criticalFile === "string") {
    const raw = fs.readFileSync(path.resolve(criticalFile), "utf8").trim();
    criticalTasks = raw.startsWith("[") ? JSON.parse(raw) : raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }
  const report = gateModule.compareGateRuns(read(baselineFile), read(candidateFile), {
    alpha: numberFlag(flags, "alpha"),
    minEffect: numberFlag(flags, "min-effect"),
    minDiscordant: numberFlag(flags, "min-discordant"),
    criticalTasks,
  });
  report.proposal_id = proposalId;
  // The gate report is a contract like a record is: a new verdict that the schema does not know
  // about must fail here rather than be written out as an unvalidated artifact.
  const schemas = new SchemaSet(core.SCHEMA_DIRECTORY);
  const check = schemas.validate(report, "skill-gate.schema.json");
  if (!check.valid) {
    throw new Error(`gate report does not match skill-gate.schema.json (${check.errors[0].keyword}): ${check.errors[0].message}`);
  }
  const target = path.join(root, "skill-impact", `${proposalId}.json`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { report, target };
}

function relative(repoPath, file) {
  return path.relative(path.resolve(repoPath), path.resolve(file)).split(path.sep).join("/");
}

function describeSyncChanges(repoPath, before, after, catalog) {
  const changed = publishModule.changedRecordsBetween(repoPath, before, after);
  const byId = new Map(catalog.records.map((entry) => [entry.id, entry]));
  return changed.map((item) => {
    const entry = byId.get(item.id);
    return {
      id: item.id,
      path: item.path,
      title: entry ? entry.title : "(not in the current corpus)",
      status: entry ? entry.status : null,
      owners: entry ? entry.owners : [],
    };
  });
}

/** A local-only marker so `sync` can tell "new to you" from "new in the repository". */
const SYNC_MARKER = ".wiki-cache.json";

function readSyncMarker(repoPath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(path.resolve(repoPath), SYNC_MARKER), "utf8"));
  } catch {
    return null;
  }
}

function writeSyncMarker(repoPath, head) {
  const target = path.join(path.resolve(repoPath), SYNC_MARKER);
  fs.writeFileSync(target, `${JSON.stringify({ schema_version: 1, last_sync_head: head }, null, 2)}\n`, "utf8");
}

function main(argv) {
  const { positionals, flags } = parseArgs(argv);
  const command = positionals[0];

  if (!command || flags.help || command === "help") {
    process.stdout.write(USAGE);
    return command ? 0 : 2;
  }

  const repoPath = positionals[1];
  const rest = positionals.slice(2);

  if (command === "init") {
    if (!repoPath) return fail("init needs a repository path", 2);
    const report = core.initKnowledgeRepo(repoPath, {
      name: requireValue(flags, "name"),
      scaffold: flags["no-scaffold"] !== true,
    });
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return 0;
    }
    process.stdout.write(`${report.created ? "initialized" : "completed"} ${report.root}\n`);
    if (report.configuration && report.configuration.name) process.stdout.write(`name=${report.configuration.name}\n`);
    for (const item of report.added) process.stdout.write(`  added  ${item}\n`);
    for (const item of report.kept) process.stdout.write(`  kept   ${item}\n`);
    if (report.pre_existing_entries.length > 0) {
      process.stdout.write(`existing content kept: ${report.pre_existing_entries.length} entry/entries (nothing overwritten)\n`);
    }
    process.stdout.write(`tools: ${report.tools.files} pinned files from skill ${report.tools.version}\n`);
    process.stdout.write("next: edit .department-redaction.json with your codewords, then commit\n");
    return 0;
  }

  if (!repoPath) return fail(`${command} needs a repository path`, 2);

  if (command === "pull") {
    const result = core.pullKnowledgeRepo(repoPath);
    process.stdout.write(`updated=${result.updated} head=${result.head.slice(0, 8)} nodes=${result.nodes} edges=${result.edges}\n`);
    return 0;
  }

  if (command === "sync") {
    const previousMarker = readSyncMarker(repoPath);
    const result = core.pullKnowledgeRepo(repoPath);
    let changes;
    let scope;
    if (previousMarker && previousMarker.last_sync_head && previousMarker.last_sync_head !== result.head) {
      scope = "since your last sync";
      changes = describeSyncChanges(repoPath, previousMarker.last_sync_head, result.head, result.catalog);
    } else if (!previousMarker) {
      // First sync from this clone: everything in the corpus is new to this colleague.
      scope = "new to you (first sync)";
      changes = result.catalog.records.map((entry) => ({
        id: entry.id,
        path: entry.path,
        title: entry.title,
        status: entry.status,
        owners: entry.owners,
      }));
    } else {
      scope = "since your last sync";
      changes = [];
    }
    writeSyncMarker(repoPath, result.head);
    process.stdout.write(`updated=${result.updated}\n`);
    if (changes.length > 0) {
      process.stdout.write(`records ${scope}: ${changes.length}\n`);
      for (const change of changes.slice(0, 25)) {
        process.stdout.write(`  ${change.id}  ${change.status || "?"}  ${change.title}  [${(change.owners || []).join(",")}]\n`);
      }
      if (changes.length > 25) process.stdout.write(`  ... and ${changes.length - 25} more; use query to narrow down\n`);
    } else {
      process.stdout.write("no record changed since your last sync\n");
    }
    const summary = result.overview;
    process.stdout.write(
      `corpus: records=${summary.records} verified=${summary.verified_records}`
      + ` (${(summary.verification_ratio * 100).toFixed(1)}%) pending_review=${summary.pending_review}`
      + ` newest=${summary.newest_update || "n/a"}\n`,
    );
    return 0;
  }

  if (command === "capture") {
    const target = capture(repoPath, rest[0], rest[1]);
    process.stdout.write(`draft=${target}\n`);
    return 0;
  }

  if (command === "validate" || command === "health") {
    const report = core.validateKnowledgeRepo(repoPath, { strict: flags.strict === true });
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else if (command === "health") {
      process.stdout.write(`records=${report.records} errors=${report.errors.length} warnings=${report.warnings.length} ok=${report.ok}\n`);
    } else {
      process.stdout.write(`ok=${report.ok} records=${report.records} errors=${report.errors.length} warnings=${report.warnings.length}\n`);
    }
    if (command === "validate" && !flags.json) {
      for (const warning of report.warnings) process.stderr.write(`${warning.file || "<repo>"}: ${warning.code}: ${warning.message}\n`);
      for (const error of report.errors) process.stderr.write(`${error.file || "<repo>"}: ${error.code}: ${error.message}\n`);
    }
    return report.ok ? 0 : 1;
  }

  if (command === "build") {
    const result = core.buildKnowledgeArtifacts(repoPath, { strict: flags.strict === true });
    process.stdout.write(`nodes=${result.nodes} edges=${result.edges} records=${result.records} warnings=${result.warnings}\n`);
    return 0;
  }

  if (command === "overview") {
    const table = queryModule.overview(loadCatalog(repoPath));
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(table, null, 2)}\n`);
      return 0;
    }
    process.stdout.write(`records=${table.records} verified=${table.verified_records} (${(table.verification_ratio * 100).toFixed(1)}%) pending_review=${table.pending_review} not_shareable=${table.not_shareable}\n`);
    process.stdout.write(`newest_update=${table.newest_update || "n/a"} oldest_update=${table.oldest_update || "n/a"}\n`);
    const section = (label, rows) => {
      if (rows.length === 0) return;
      process.stdout.write(`${label}: ${rows.map((row) => `${row.name}(${row.count})`).join(" ")}\n`);
    };
    section("by_type", table.by_type);
    section("by_status", table.by_status);
    section("by_visibility", table.by_visibility);
    section("by_area", table.by_area);
    section("by_owner", table.by_owner);
    section("by_model", table.by_model_family);
    section("by_accelerator", table.by_accelerator);
    section("top_tags", table.by_tag);
    return 0;
  }

  if (command === "query") {
    const catalog = loadCatalog(repoPath);
    const result = queryModule.queryCatalog(catalog, {
      terms: rest,
      filters: filterOptions(flags),
      limit: flags.limit === undefined ? 10 : Number(requireValue(flags, "limit")),
      any: flags.any === true,
      sources: readSources(catalog, repoPath),
    });
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }
    process.stdout.write(`terms=${result.terms.join(",") || "(none)"} hits=${result.hit_count}\n`);
    for (const hit of result.hits) process.stdout.write(`${queryModule.formatHit(hit)}\n`);
    if (result.hits.length === 0) process.stdout.write("no matching record; try fewer terms or --any\n");
    return 0;
  }

  if (command === "show") {
    const id = rest[0];
    if (!id) return fail("show needs a record id", 2);
    const catalog = loadCatalog(repoPath);
    const entry = findEntry(catalog, id);
    if (!entry) return fail(`no record with id ${id}`, 1);
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(entry, null, 2)}\n`);
      return 0;
    }
    const source = fs.readFileSync(path.join(path.resolve(repoPath), entry.path), "utf8");
    process.stdout.write(`# ${entry.id} — ${entry.title}\npath=${entry.path}\nstatus=${entry.status} type=${entry.type} visibility=${entry.visibility}\nowners=${entry.owners.join(",")}\n\n${source}`);
    return 0;
  }

  if (command === "related") {
    const id = rest[0];
    if (!id) return fail("related needs a record id", 2);
    const catalog = loadCatalog(repoPath);
    const graph = queryModule.relatedRecords(catalog, id);
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(graph, null, 2)}\n`);
      return 0;
    }
    if (!graph.found) return fail(`no record with id ${id}`, 1);
    const line = (item, direction) => {
      const arrow = direction === "outgoing" ? "->" : "<-";
      const target = item.title ? `(${item.status}) ${item.title}` : "(dangling reference)";
      return `  ${arrow} ${item.relation}  ${item.id}  ${target}`;
    };
    process.stdout.write(`outgoing=${graph.outgoing.length} incoming=${graph.incoming.length}\n`);
    for (const item of graph.outgoing) process.stdout.write(`${line(item, "outgoing")}\n`);
    for (const item of graph.incoming) process.stdout.write(`${line(item, "incoming")}\n`);
    return 0;
  }

  if (command === "publish") {
    if (rest.length === 0) return fail("publish needs at least one record path", 2);
    const result = publishModule.publishRecordSet(repoPath, rest, {
      push: flags.push === true,
      dryRun: flags["dry-run"] === true,
      withDependencies: flags.only !== true,
      allowWarnings: flags["allow-warnings"] === true,
      message: requireValue(flags, "message"),
    });
    process.stdout.write(`branch=${result.branch}\n`);
    for (const item of result.paths) {
      process.stdout.write(`  ${item}${result.reasons && result.reasons[item] && result.reasons[item] !== "requested" ? `  (${result.reasons[item]})` : ""}\n`);
    }
    if (result.dry_run) {
      process.stdout.write(`dry-run: message=${result.message}\n`);
      return 0;
    }
    process.stdout.write(`commit=${result.commit.slice(0, 8)} branch_validated=ok records=${result.branch_validation.records}\n`);
    process.stdout.write(result.pushed ? `pushed=${result.remote_commit.slice(0, 8)} (remote readback verified)\n` : "not pushed (add --push when the record is ready)\n");
    if (result.pr_url) process.stdout.write(`open a pull request: ${result.pr_url}\n`);
    return 0;
  }

  if (command === "gate") {
    const [baselineFile, candidateFile, proposalId] = rest;
    if (!baselineFile || !candidateFile || !proposalId) return fail("gate needs <baseline.json> <candidate.json> <proposal-id>", 2);
    const result = gate(repoPath, baselineFile, candidateFile, proposalId, flags);
    const report = result.report;
    process.stdout.write(`accepted=${report.accepted} verdict=${report.verdict} report=${result.target}\n`);
    process.stdout.write(
      `baseline=${report.baseline_score.toFixed(4)} candidate=${report.candidate_score.toFixed(4)} delta=${report.delta.toFixed(4)}`
      + ` discordant=${report.resolution.discordant_pairs}/${report.resolution.required_discordant_pairs}`
      + ` p=${report.paired_exact_binomial_p} mde=${report.resolution.minimum_detectable_effect}\n`,
    );
    if (report.critical_regressions.length > 0) {
      process.stdout.write(`critical regressions: ${report.critical_regressions.join(", ")}\n`);
    }
    if (report.verdict === "rejected_not_enough_resolution") {
      process.stdout.write(
        `not enough resolution: ${report.resolution.discordant_pairs} discordant pair(s) observed,`
        + ` ${report.resolution.required_discordant_pairs} needed at alpha=${report.resolution.alpha}.`
        + ` This task set cannot tell an improvement from noise below a delta of ${report.resolution.minimum_detectable_effect}.\n`,
      );
    }
    return report.accepted ? 0 : 3;
  }

  if (command === "upgrade-tools") {
    // The vendored copy cannot pin itself to a newer version: it would compare a directory against
    // itself and always report "in sync". Only the installed Skill knows what the current toolchain
    // is, so refuse and say which command to run.
    if (path.basename(path.resolve(__dirname, "..")) === scaffoldModule.TOOLS_DIRECTORY) {
      return fail(
        "upgrade-tools must run from the installed Skill, not from the repository's pinned copy.\n"
        + "  run: node <installed-skill>/scripts/team-wiki.js upgrade-tools <repo> [--write]",
        2,
      );
    }
    const result = scaffoldModule.upgradeTools(repoPath, undefined, { write: flags.write === true });
    if (!result.manifest_present) {
      process.stdout.write("no .department-tools/TOOLS.json in this repository; run team-wiki init first\n");
      return 1;
    }
    process.stdout.write(`vendored=${result.vendored_version} skill=${result.skill_version} in_sync=${result.in_sync}\n`);
    for (const item of result.added) process.stdout.write(`  add     ${item}\n`);
    for (const item of result.changed) process.stdout.write(`  update  ${item}\n`);
    for (const item of result.removed) process.stdout.write(`  drop    ${item}\n`);
    if (flags.write !== true && !result.in_sync) process.stdout.write("re-run with --write to pin the repository to this Skill version\n");
    return 0;
  }

  process.stderr.write(`unknown command: ${command}\n\n${USAGE}`);
  return 2;
}

let exitCode;
try {
  exitCode = main(process.argv.slice(2));
} catch (error) {
  exitCode = fail(error.message);
}
process.exitCode = exitCode;
