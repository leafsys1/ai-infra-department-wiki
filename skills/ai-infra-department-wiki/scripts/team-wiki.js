#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  buildKnowledgeArtifacts,
  initKnowledgeRepo,
  pullKnowledgeRepo,
  validateKnowledgeRepo,
} = require("./lib/team-wiki");
const { compareGateRuns } = require("./lib/skill-gate");

function usage() {
  process.stderr.write(`Usage:
  team-wiki init <repo-path> [--name <name>]
  team-wiki pull <repo-path>
  team-wiki capture <repo-path> <case|evidence|decision> <id>
  team-wiki validate <repo-path>
  team-wiki build <repo-path>
  team-wiki health <repo-path>
  team-wiki publish <repo-path> <record-path> [--push]
  team-wiki gate <repo-path> <baseline.json> <candidate.json> <proposal-id>
`);
}

function optionValue(args, option) {
  const index = args.indexOf(option);
  return index >= 0 ? args[index + 1] : undefined;
}

function draftTemplate(type, id) {
  const date = new Date().toISOString().slice(0, 10);
  const prefixes = { case: "CASE", evidence: "EVD", decision: "DEC", pattern: "PAT", runbook: "RUN", environment: "ENV" };
  if (!prefixes[type]) throw new Error(`unsupported capture type: ${type}`);
  const patterns = {
    case: /^CASE-\d{4}-\d{4}$/,
    evidence: /^EVD-\d{4}-\d{4}$/,
    decision: /^DEC-\d{4}-\d{4}$/,
    pattern: /^PAT-\d{4}-\d{4}$/,
    runbook: /^RUN-\d{4}-\d{4}$/,
    environment: /^ENV-[A-Z0-9][A-Z0-9-]*$/,
  };
  if (!patterns[type].test(id)) throw new Error(`invalid ${type} id: ${id}`);
  const skillRoot = path.resolve(__dirname, "..");
  const templatePath = path.join(skillRoot, "templates", "department", `${type}-template.md`);
  if (!fs.existsSync(templatePath)) throw new Error(`department template missing: ${templatePath}`);
  return fs.readFileSync(templatePath, "utf8")
    .replace(/^(id:)\s*.*$/m, `$1 ${id}`)
    .replace(/^(created:)\s*.*$/m, `$1 ${date}`)
    .replace(/^(updated:)\s*.*$/m, `$1 ${date}`);
}

function capture(repoPath, type, id) {
  const root = path.resolve(repoPath);
  const drafts = path.join(root, "drafts");
  fs.mkdirSync(drafts, { recursive: true });
  const target = path.join(drafts, `${id}.md`);
  if (fs.existsSync(target)) throw new Error(`draft already exists: ${target}`);
  fs.writeFileSync(target, draftTemplate(type, id), "utf8");
  return target;
}

function publish(repoPath, recordPath, push) {
  const root = path.resolve(repoPath);
  const absolute = path.resolve(root, recordPath);
  if (!absolute.startsWith(`${root}${path.sep}`) || !fs.existsSync(absolute)) throw new Error("record path must exist inside the knowledge repository");
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  const { execFileSync } = require("node:child_process");
  const run = (args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  const changes = run(["status", "--porcelain"]).split(/\r?\n/).filter(Boolean);
  const unrelated = changes.filter((line) => line.slice(3).replaceAll("\\", "/") !== relative);
  if (unrelated.length > 0) throw new Error(`knowledge repository has unrelated uncommitted changes: ${unrelated.join(", ")}`);
  const report = validateKnowledgeRepo(root);
  if (!report.ok) throw new Error(`knowledge validation failed with ${report.errors.length} error(s)`);
  const { parseFrontmatter } = require("./lib/team-wiki");
  const record = parseFrontmatter(fs.readFileSync(absolute, "utf8"));
  if (record.status === "draft") throw new Error("draft records cannot be published");
  if (record.visibility === "local-only") throw new Error("local-only records cannot be published");
  const id = path.basename(absolute, ".md");
  const branch = `knowledge/${process.env.USER || "contributor"}/${id.toLowerCase()}`;
  run(["switch", "-c", branch]);
  run(["add", relative]);
  run(["commit", "-m", `knowledge: add ${id}`]);
  if (push) run(["push", "-u", "origin", branch]);
  return branch;
}

function gate(repoPath, baselinePath, candidatePath, proposalId) {
  if (!baselinePath || !candidatePath || !proposalId) {
    throw new Error("gate requires baseline.json, candidate.json and proposal-id");
  }
  if (!/^SKP-\d{4,}$/.test(proposalId)) throw new Error(`invalid proposal id: ${proposalId}`);
  const root = path.resolve(repoPath);
  const baseline = JSON.parse(fs.readFileSync(path.resolve(baselinePath), "utf8"));
  const candidate = JSON.parse(fs.readFileSync(path.resolve(candidatePath), "utf8"));
  const report = { proposal_id: proposalId, ...compareGateRuns(baseline, candidate) };
  const directory = path.join(root, "skill-impact");
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, `${proposalId}.json`);
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { target, report };
}

function main(argv) {
  const [command, repoPath, ...args] = argv;
  if (!command || !repoPath) {
    usage();
    return 2;
  }

  if (command === "init") {
    const result = initKnowledgeRepo(repoPath, { name: optionValue(args, "--name") });
    process.stdout.write(`initialized=${result.path}\n`);
    return 0;
  }
  if (command === "pull") {
    const result = pullKnowledgeRepo(repoPath);
    process.stdout.write(`updated=${result.updated} nodes=${result.nodes} edges=${result.edges}\n`);
    return 0;
  }
  if (command === "capture") {
    const target = capture(repoPath, args[0], args[1]);
    process.stdout.write(`draft=${target}\n`);
    return 0;
  }
  if (command === "validate") {
    const report = validateKnowledgeRepo(repoPath);
    process.stdout.write(`ok=${report.ok} records=${report.records} errors=${report.errors.length} warnings=${report.warnings.length}\n`);
    for (const error of report.errors) process.stderr.write(`${error.file || "<repo>"}: ${error.code}: ${error.message}\n`);
    return report.ok ? 0 : 1;
  }
  if (command === "build") {
    const result = buildKnowledgeArtifacts(repoPath);
    process.stdout.write(`nodes=${result.nodes} edges=${result.edges}\n`);
    return 0;
  }
  if (command === "health") {
    const report = validateKnowledgeRepo(repoPath);
    process.stdout.write(`records=${report.records} errors=${report.errors.length} warnings=${report.warnings.length}\n`);
    return report.ok ? 0 : 1;
  }
  if (command === "publish") {
    const branch = publish(repoPath, args[0], args.includes("--push"));
    process.stdout.write(`branch=${branch}\n`);
    return 0;
  }
  if (command === "gate") {
    const result = gate(repoPath, args[0], args[1], args[2]);
    process.stdout.write(`accepted=${result.report.accepted} verdict=${result.report.verdict} report=${result.target}\n`);
    return result.report.accepted ? 0 : 3;
  }
  usage();
  return 2;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exitCode = 1;
}
