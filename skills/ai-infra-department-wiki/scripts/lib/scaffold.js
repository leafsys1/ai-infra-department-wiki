"use strict";

/**
 * Knowledge-repository scaffolding.
 *
 * A shared knowledge repository only works if the rules travel with it: the same validator for
 * everyone, the same redaction policy, CI that refuses a broken record, a PR template that asks the
 * review questions, and CODEOWNERS that routes a change to the area owner. `init` used to create
 * bare directories, which left each department to invent governance by hand.
 *
 * The validator itself is vendored into `.department-tools/` and committed, so:
 *   - CI can validate a pull request without installing the Skill,
 *   - every colleague validates with the repository's pinned tool version (not whatever their
 *     machine happens to have), and
 *   - `upgrade-tools` makes tool drift an explicit, reviewable change.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { POLICY_FILE, defaultPolicyConfig } = require("./policy");

const TOOLS_DIRECTORY = ".department-tools";
const TOOLS_MANIFEST = `${TOOLS_DIRECTORY}/TOOLS.json`;
const VENDORED_DIRECTORIES = Object.freeze(["scripts", "templates"]);
const RECORD_DIRECTORIES = Object.freeze([
  "records/cases/inference",
  "records/cases/training",
  "records/cases/communication",
  "records/cases/deployment",
  "records/cases/incidents",
  "records/evidence",
  "records/decisions",
  "records/patterns",
  "records/runbooks",
  "records/environments",
  "skill-impact",
  "generated",
]);

function skillRootOf(skillRoot) {
  return path.resolve(skillRoot || path.resolve(__dirname, "..", ".."));
}

function skillVersion(skillRoot) {
  const file = path.join(skillRootOf(skillRoot), "SKILL.md");
  try {
    const match = fs.readFileSync(file, "utf8").match(/^version:\s*(.+)$/m);
    return match ? match[1].trim() : "unknown";
  } catch {
    return "unknown";
  }
}

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

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** Every tool file the knowledge repository pins, keyed by its path below the Skill directory. */
function toolFiles(skillRoot) {
  const root = skillRootOf(skillRoot);
  const files = new Map();
  for (const directory of VENDORED_DIRECTORIES) {
    for (const relative of listFiles(path.join(root, directory))) {
      const file = path.join(root, directory, relative);
      files.set(`${directory}/${relative}`, sha256(fs.readFileSync(file)));
    }
  }
  return files;
}

function writeVendoredTools(repoRoot, skillRoot) {
  const root = skillRootOf(skillRoot);
  const files = toolFiles(root);
  const target = path.join(repoRoot, TOOLS_DIRECTORY);
  for (const [relative, hash] of files) {
    const destination = path.join(target, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const existing = fs.existsSync(destination) ? sha256(fs.readFileSync(destination)) : null;
    if (existing !== hash) fs.copyFileSync(path.join(root, relative), destination);
  }
  const manifest = {
    schema_version: 1,
    skill_name: "ai-infra-department-wiki",
    skill_version: skillVersion(root),
    source: "vendored by team-wiki init",
    directories: [...VENDORED_DIRECTORIES],
    files: Object.fromEntries([...files.entries()].sort(([left], [right]) => left.localeCompare(right))),
  };
  fs.writeFileSync(path.join(repoRoot, TOOLS_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { files: files.size, version: manifest.skill_version };
}

function readToolsManifest(repoRoot) {
  const file = path.join(path.resolve(repoRoot), TOOLS_MANIFEST);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${TOOLS_MANIFEST} is not valid JSON: ${error.message}`);
  }
}

/**
 * Drift between the repository's pinned toolchain and the installed Skill.
 *
 * Compares the files that are actually on disk — not the hashes recorded in the manifest — so a
 * hand-edited pinned copy is reported as drift too. That is the property worth enforcing: nobody
 * should be quietly running a different validator from the rest of the department.
 */
function compareTools(repoRoot, skillRoot) {
  const root = skillRootOf(skillRoot);
  const manifest = readToolsManifest(repoRoot);
  const current = toolFiles(root);
  const target = path.join(path.resolve(repoRoot), TOOLS_DIRECTORY);
  const onDisk = new Map();
  for (const directory of VENDORED_DIRECTORIES) {
    const directoryPath = path.join(target, directory);
    for (const relative of listFiles(directoryPath)) {
      onDisk.set(`${directory}/${relative}`, sha256(fs.readFileSync(path.join(directoryPath, relative))));
    }
  }
  const added = [];
  const changed = [];
  const removed = [];
  for (const [relative, hash] of [...current.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (!onDisk.has(relative)) added.push(relative);
    else if (onDisk.get(relative) !== hash) changed.push(relative);
  }
  for (const relative of [...onDisk.keys()].sort()) if (!current.has(relative)) removed.push(relative);
  return {
    manifest_present: Boolean(manifest),
    vendored_version: manifest ? manifest.skill_version : null,
    skill_version: skillVersion(root),
    pinned_files: onDisk.size,
    in_sync: added.length === 0 && changed.length === 0 && removed.length === 0,
    added,
    changed,
    removed,
  };
}

function upgradeTools(repoRoot, skillRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const drift = compareTools(root, skillRoot);
  if (options.write !== true) return { ...drift, written: false };
  const current = toolFiles(skillRoot);
  const target = path.join(root, TOOLS_DIRECTORY);
  // Remove anything the pinned set no longer contains, then rewrite the whole set. Self-cleaning
  // beats tracking individual adds/changes/removals across versions.
  for (const directory of VENDORED_DIRECTORIES) {
    const directoryPath = path.join(target, directory);
    if (!fs.existsSync(directoryPath)) continue;
    for (const relative of listFiles(directoryPath)) {
      const managed = `${directory}/${relative}`;
      if (!current.has(managed)) fs.rmSync(path.join(directoryPath, relative));
    }
  }
  const result = writeVendoredTools(root, skillRoot);
  return { ...drift, written: true, files: result.files, version: result.version };
}

function writeIfAbsent(file, content, report) {
  if (fs.existsSync(file)) {
    report.kept.push(path.relative(report.root, file).split(path.sep).join("/"));
    return false;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  report.added.push(path.relative(report.root, file).split(path.sep).join("/"));
  return true;
}

function workflowFile(config) {
  return `name: Knowledge validation

on:
  pull_request:
  push:
    branches: [${config.default_branch}]

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - name: Validate records against the pinned tool version
        run:
          node .department-tools/scripts/team-wiki.js validate . --strict
      - name: Rebuild index, graph and overview
        run: node .department-tools/scripts/team-wiki.js build .
      - name: Summarise the department corpus
        run: node .department-tools/scripts/team-wiki.js overview .
`;
}

function pullRequestTemplate() {
  const lines = [
    "## What this record adds",
    "",
    "<!-- One or two sentences. What will a colleague be able to do after reading this? -->",
    "",
    "## Review checklist",
    "",
    "- [ ] Record id, filename, type and status match the schema, and the file lives under its type directory.",
    "- [ ] Every claim is tied to evidence with an exact locator and a source hash.",
    "- [ ] Environment and applicability boundaries are complete (model, hardware, framework version, topology, benchmark setting).",
    "- [ ] Intentional variables are separated from uncontrolled factors.",
    "- [ ] The status matches the amount of validation (repetitions, replication).",
    "- [ ] Failure conditions, counterexamples and applicability limits are written down, not omitted.",
    "- [ ] Sensitive content was removed rather than relabelled; CI passes with --strict.",
    "- [ ] Related records are linked instead of restating them (validated_by / supersedes / applies_to).",
    "- [ ] I checked whether an existing record already covers this mechanism.",
    "",
    "## Cross-references",
    "",
    "<!-- Related record ids, superseded ids, or the Skill proposal this feeds. -->",
    "",
  ];
  return lines.join("\n");
}

function codeownersFile(config) {
  const lines = [
    "# Default owner for every path in this knowledge repository.",
    "# Replace with the department team slug once the repository lives in the organization.",
    "* ${OWNER}",
    "",
    "# Route the review to the people who own the area.",
    "/records/cases/inference/ ${INFERENCE_OWNER}",
    "/records/cases/training/ ${TRAINING_OWNER}",
    "/records/cases/communication/ ${COMMUNICATION_OWNER}",
    "/records/cases/deployment/ ${DEPLOYMENT_OWNER}",
    "/records/cases/incidents/ ${INCIDENT_OWNER}",
    "/records/patterns/ ${PATTERN_OWNER}",
    "/records/runbooks/ ${RUNBOOK_OWNER}",
    "/records/decisions/ ${DECISION_OWNER}",
    "/records/evidence/ ${EVIDENCE_OWNER}",
    "/records/environments/ ${ENVIRONMENT_OWNER}",
    "",
    "# Schema, policy and pinned tooling changes need a governance review.",
    "/" + POLICY_FILE + " ${GOVERNANCE_OWNER}",
    "/" + TOOLS_DIRECTORY + "/ ${GOVERNANCE_OWNER}",
    "/scripts/schemas/ ${GOVERNANCE_OWNER}",
    "",
  ];
  return `${lines.join("\n").replace(/\$\{(\w+)\}/g, (match, name) => (name === "OWNER" ? "@REPLACE-WITH-ORG-TEAM" : "@REPLACE-WITH-AREA-OWNER"))}`;
}

function contributingFile(config) {
  const lines = [
    `# Contributing to ${config.name}`,
    "",
    "This repository is the shared AI Infra knowledge base. Records are reviewed like code.",
    "",
    "## Prerequisites",
    "",
    "- Node.js 22 or newer (the pinned validator in `.department-tools/` needs it).",
    "- The `ai-infra-department-wiki` Skill installed in your agent, so capture/validate/publish use the same rules as CI.",
    "",
    "## Daily loop",
    "",
    "```",
    "node .department-tools/scripts/team-wiki.js pull .            # update your clone (fast-forward only)",
    "node .department-tools/scripts/team-wiki.js overview .        # what the department knows today",
    "node .department-tools/scripts/team-wiki.js query . <terms>   # find the record you need",
    "node .department-tools/scripts/team-wiki.js capture . case CASE-2026-0007",
    "node .department-tools/scripts/team-wiki.js validate .        # before moving a draft into records/",
    "node .department-tools/scripts/team-wiki.js publish . records/cases/inference/CASE-2026-0007.md --push",
    "```",
    "",
    "`publish` refuses to start on anything but the default branch and refuses unrelated worktree changes; it creates a contribution branch containing only the records you asked for plus the evidence they newly reference. Open the pull request link it prints.",
    "",
    "## Rules that CI enforces",
    "",
    "- `validate --strict` must pass: schema shape, required context, evidence hashes and locators, resolvable cross-references, no blocked redaction rule, no unresolved warning.",
    "- Generated files (`generated/`) are never hand-edited and never committed.",
    "- Drafts stay in the ignored `drafts/` directory until a human moves them under `records/`.",
    "- Never commit customer material, raw logs, credentials, private addresses, or a colleague's home path.",
    "",
    "## Redaction",
    "",
    `\`${POLICY_FILE}\` is the department's shared rule set. Add your customer codewords and internal host identifiers there so every colleague inherits them. Blocked matches fail CI; warnings fail CI too because the workflow runs \`--strict\`, so an intentional exception must be an explicit \`allow\` entry in the policy — visible and reviewed.`,
    "",
    "## Changing the tooling",
    "",
    "`.department-tools/` is a pinned copy of the Skill's validator. Change it only by running `upgrade-tools`, never by editing files in place, so the diff shows exactly which validator version the repository moved to.",
    "",
  ];
  return lines.join("\n");
}

function recordTypesDoc(config) {
  const lines = [
    `# ${config.name}`,
    "",
    "Private repository of reviewed, desensitized AI Infra knowledge records. This is the shared half of the department wiki; the personal `llm-wiki` vault stays local.",
    "",
    "## Record types",
    "",
    "| Type | Directory | Use it for |",
    "|---|---|---|",
    "| case | `records/cases/<area>/` | One measured engineering finding: goal, baseline, changed variable, controlled variables, results, conclusion, applicability. |",
    "| evidence | `records/evidence/` | The pointer to raw data: source hash, exact locator, who verified it and when. Records reference evidence, never the other way round. |",
    "| decision | `records/decisions/` | A choice with alternatives and consequences. |",
    "| pattern | `records/patterns/` | A mechanism that repeated across cases, with its applicability boundary and counterexamples. |",
    "| runbook | `records/runbooks/` | The steps to repeat an operational procedure. |",
    "| environment | `records/environments/` | A named hardware/software configuration other records cite. |",
    "",
    "## Areas under `records/cases/`",
    "",
    "`inference/`, `training/`, `communication/`, `deployment/`, `incidents/`.",
    "",
    "Do not put a plain markdown file under `records/`: everything matching `records/**/*.md` is parsed as a record and will fail validation without frontmatter.",
    "",
    "## Start here",
    "",
    "```",
    "node .department-tools/scripts/team-wiki.js overview .        # the corpus at a glance",
    "node .department-tools/scripts/team-wiki.js query . <terms>   # find a record",
    "node .department-tools/scripts/team-wiki.js --help",
    "```",
    "",
    "See `CONTRIBUTING.md` for the review rules and the pull-request flow.",
    "",
  ];
  return lines.join("\n");
}

function gitignore() {
  return [
    "# Local-only working areas: never shared",
    "drafts/",
    "raw-local/",
    "cache/",
    ".wiki-cache.json",
    ".wiki-tmp/",
    "# Generated artifacts are rebuilt locally and by CI",
    "generated/*",
    "!generated/.gitkeep",
    "# Never commit key material",
    "*.pem",
    "*.key",
    "",
  ].join("\n");
}

/**
 * Create or complete a knowledge repository.
 *
 * Safe on a non-empty directory (the usual case: a fresh private repo already has a README and a
 * LICENSE) and idempotent — existing files are kept and reported, never overwritten. Only
 * `upgrade-tools` rewrites files, and only inside `.department-tools/`.
 */
function initKnowledgeRepo(repoPath, options = {}) {
  const root = path.resolve(repoPath);
  const existed = fs.existsSync(root);
  const before = existed ? fs.readdirSync(root).filter((entry) => entry !== ".git") : [];
  const alreadyInitialized = fs.existsSync(path.join(root, ".department-wiki.json"));
  fs.mkdirSync(root, { recursive: true });
  const report = { root, existed, already_initialized: alreadyInitialized, pre_existing_entries: before, added: [], kept: [] };

  const configuration = {
    schema_version: 1,
    name: options.name || (alreadyInitialized ? undefined : "AI Infra Department Knowledge"),
    default_branch: options.defaultBranch || "main",
    default_visibility: "internal",
    generated_directory: "generated",
    tools_directory: TOOLS_DIRECTORY,
    tool_version: skillVersion(options.skillRoot),
  };
  const configFile = path.join(root, ".department-wiki.json");
  if (alreadyInitialized) {
    const current = JSON.parse(fs.readFileSync(configFile, "utf8"));
    configuration.name = options.name || current.name || "AI Infra Department Knowledge";
    report.kept.push(".department-wiki.json");
  } else {
    fs.writeFileSync(configFile, `${JSON.stringify(configuration, null, 2)}\n`, "utf8");
    report.added.push(".department-wiki.json");
  }
  configuration.name = configuration.name || "AI Infra Department Knowledge";

  for (const directory of RECORD_DIRECTORIES) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
    const keeper = path.join(root, directory, ".gitkeep");
    if (!fs.existsSync(keeper)) fs.writeFileSync(keeper, "", "utf8");
  }

  writeIfAbsent(path.join(root, ".gitignore"), gitignore(), report);
  writeIfAbsent(path.join(root, "README.md"), recordTypesDoc(configuration), report);
  writeIfAbsent(path.join(root, "CONTRIBUTING.md"), contributingFile(configuration), report);
  if (options.scaffold !== false) {
    writeIfAbsent(path.join(root, POLICY_FILE), `${JSON.stringify(defaultPolicyConfig(), null, 2)}\n`, report);
    writeIfAbsent(path.join(root, ".github/workflows/knowledge-validate.yml"), workflowFile(configuration), report);
    writeIfAbsent(path.join(root, ".github/pull_request_template.md"), pullRequestTemplate(), report);
    writeIfAbsent(path.join(root, ".github/CODEOWNERS"), codeownersFile(configuration), report);
  }

  const tools = writeVendoredTools(root, options.skillRoot);
  report.added.push(`${TOOLS_DIRECTORY}/ (${tools.files} pinned files, skill ${tools.version})`);
  report.tools = tools;
  report.configuration = configuration;
  return report;
}

module.exports = {
  RECORD_DIRECTORIES,
  TOOLS_DIRECTORY,
  TOOLS_MANIFEST,
  VENDORED_DIRECTORIES,
  compareTools,
  initKnowledgeRepo,
  readToolsManifest,
  skillVersion,
  toolFiles,
  upgradeTools,
  writeVendoredTools,
};
