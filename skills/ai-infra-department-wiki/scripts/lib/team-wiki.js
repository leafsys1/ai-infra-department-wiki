"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const RECORD_DIRECTORIES = Object.freeze({
  case: "records/cases",
  evidence: "records/evidence",
  decision: "records/decisions",
  pattern: "records/patterns",
  runbook: "records/runbooks",
  environment: "records/environments",
});

const ID_PATTERNS = Object.freeze({
  case: /^CASE-\d{4}-\d{4}$/,
  evidence: /^EVD-\d{4}-\d{4}$/,
  decision: /^DEC-\d{4}-\d{4}$/,
  pattern: /^PAT-\d{4}-\d{4}$/,
  runbook: /^RUN-\d{4}-\d{4}$/,
  environment: /^ENV-[A-Z0-9][A-Z0-9-]*$/,
});

const VALID_STATUS = new Set(["draft", "proposed", "observed", "verified", "replicated", "rejected", "deprecated"]);
const VALID_VISIBILITY = new Set(["shareable", "internal", "restricted", "local-only"]);
const VALID_RELATIONS = new Set([
  "validated_by",
  "supports",
  "refutes",
  "applies_to",
  "observed_in",
  "caused_by",
  "mitigated_by",
  "implemented_by",
  "supersedes",
  "contradicts",
]);

const SENSITIVE_PATTERNS = [
  { name: "private_key", expression: /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/ },
  { name: "github_token", expression: /\b(?:ghp_|github_pat_)[A-Za-z0-9_-]{12,}\b/ },
  { name: "api_key", expression: /\bsk-[A-Za-z0-9_-]{12,}\b/ },
  { name: "credential_assignment", expression: /\b(?:api[_-]?key|password|passwd|secret|token)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}/i },
  { name: "personal_home", expression: /(?:^|[\s`"'])\/(?:home|Users)\/(?!user\b|example\b|demo\b)[^/\s`"']+\// },
  { name: "private_ipv4", expression: /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d{1,5})?\b/ },
];

function scalar(value) {
  const trimmed = value.trim();
  if (trimmed === "") return {};
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const content = trimmed.slice(1, -1).trim();
    return content ? content.split(",").map((item) => scalar(item.trim())) : [];
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error("missing YAML frontmatter");
  const root = {};
  const stack = [{ indent: -1, value: root }];
  const lines = match[1].split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1).value;
    const line = raw.trim();

    if (line.startsWith("- ")) {
      if (!Array.isArray(parent)) throw new Error(`line ${index + 1}: list item without list key`);
      const item = line.slice(2);
      const pair = item.match(/^([^:]+):\s*(.*)$/);
      if (pair) {
        const object = { [pair[1].trim()]: scalar(pair[2]) };
        parent.push(object);
        stack.push({ indent, value: object });
      } else {
        parent.push(scalar(item));
      }
      continue;
    }

    const pair = line.match(/^([^:]+):\s*(.*)$/);
    if (!pair) throw new Error(`line ${index + 1}: unsupported YAML syntax`);
    const key = pair[1].trim();
    const rest = pair[2];
    if (rest !== "") {
      parent[key] = scalar(rest);
      continue;
    }

    const next = lines.slice(index + 1).find((candidate) => candidate.trim());
    const child = next && next.trim().startsWith("-") ? [] : {};
    parent[key] = child;
    stack.push({ indent, value: child });
  }

  return root;
}

function listMarkdownFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...listMarkdownFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith(".md")) results.push(absolute);
  }
  return results;
}

function recordFiles(repoPath) {
  return listMarkdownFiles(path.join(repoPath, "records"));
}

function loadRecords(repoPath) {
  return recordFiles(repoPath).map((file) => {
    const source = fs.readFileSync(file, "utf8");
    return {
      file,
      relativePath: path.relative(repoPath, file).split(path.sep).join("/"),
      source,
      data: parseFrontmatter(source),
    };
  });
}

function addError(errors, record, code, message) {
  errors.push({ code, file: record ? record.relativePath : null, message });
}

function validateRequired(record, errors) {
  for (const field of ["schema_version", "id", "type", "title", "status", "visibility", "owners", "created", "updated"]) {
    if (record.data[field] === undefined || record.data[field] === "" || (Array.isArray(record.data[field]) && record.data[field].length === 0)) {
      addError(errors, record, "missing_field", `missing required field: ${field}`);
    }
  }
  if (record.data.schema_version !== 1) addError(errors, record, "schema_version", "schema_version must be 1");
  if (!RECORD_DIRECTORIES[record.data.type]) addError(errors, record, "record_type", `unsupported record type: ${record.data.type}`);
  if (record.data.type && ID_PATTERNS[record.data.type] && !ID_PATTERNS[record.data.type].test(String(record.data.id || ""))) {
    addError(errors, record, "record_id", `invalid ${record.data.type} id: ${record.data.id}`);
  }
  if (record.data.status && !VALID_STATUS.has(record.data.status)) addError(errors, record, "status", `invalid status: ${record.data.status}`);
  if (record.data.visibility && !VALID_VISIBILITY.has(record.data.visibility)) addError(errors, record, "visibility", `invalid visibility: ${record.data.visibility}`);
  for (const field of ["owners", "reviewers", "evidence", "relations", "supersedes", "superseded_by"]) {
    if (record.data[field] !== undefined && !Array.isArray(record.data[field])) {
      addError(errors, record, "field_type", `${field} must be an array`);
    }
  }
  for (const relation of Array.isArray(record.data.relations) ? record.data.relations : []) {
    if (!relation || typeof relation !== "object" || Array.isArray(relation) || !relation.type || !relation.target) {
      addError(errors, record, "field_type", "each relation must be an object with type and target");
    }
  }
  if (record.data.id && path.basename(record.file, ".md") !== record.data.id) {
    addError(errors, record, "filename", "record filename must equal its id");
  }
  const expectedDirectory = RECORD_DIRECTORIES[record.data.type];
  if (expectedDirectory && !(record.relativePath === `${expectedDirectory}/${record.data.id}.md` || record.relativePath.startsWith(`${expectedDirectory}/`))) {
    addError(errors, record, "record_directory", `${record.data.type} records must live under ${expectedDirectory}/`);
  }
}

function validateCase(record, errors) {
  const data = record.data;
  const context = data.context || {};
  const validation = data.validation || {};
  for (const field of ["workload", "model_family", "model_version", "framework", "framework_version", "accelerator_model"]) {
    if (!context[field]) addError(errors, record, "missing_context", `case context missing: ${field}`);
  }
  if (["verified", "replicated"].includes(data.status)) {
    for (const field of ["workload", "model_family", "model_version", "framework", "framework_version", "accelerator_model"]) {
      if (String(context[field]).trim().toLowerCase() === "unknown") {
        addError(errors, record, "unknown_context", `verified case context cannot be unknown: ${field}`);
      }
    }
    if (!Array.isArray(data.evidence) || data.evidence.length === 0) addError(errors, record, "missing_evidence", "verified case requires evidence");
    if (!Number.isInteger(validation.repetitions) || validation.repetitions < 2) {
      addError(errors, record, "validation", "verified case requires at least 2 repetitions");
    }
    if (!validation.conclusion_level) addError(errors, record, "validation", "verified case requires conclusion_level");
  }
}

function validateEvidence(record, errors) {
  const data = record.data;
  if (!/^[a-f0-9]{64}$/.test(String(data.source_sha256 || ""))) addError(errors, record, "evidence_hash", "evidence requires a sha256 source hash");
  if (!data.locator) addError(errors, record, "evidence_locator", "evidence requires a source locator");
  if (["verified", "replicated"].includes(data.status)) {
    if (!Array.isArray(data.verified_by) || data.verified_by.length === 0) addError(errors, record, "verification", "verified evidence requires verified_by");
    if (!data.verified_at) addError(errors, record, "verification", "verified evidence requires verified_at");
  }
}

function validateSensitive(record, errors) {
  for (const { name, expression } of SENSITIVE_PATTERNS) {
    if (expression.test(record.source)) addError(errors, record, "sensitive_content", `blocked sensitive content: ${name}`);
  }
}

function collectReferences(record) {
  const references = [];
  for (const value of Array.isArray(record.data.evidence) ? record.data.evidence : []) references.push({ field: "evidence", target: value });
  for (const relation of Array.isArray(record.data.relations) ? record.data.relations : []) {
    if (!relation || typeof relation !== "object") continue;
    if (!VALID_RELATIONS.has(relation.type)) references.push({ field: "relation_type", target: relation.type, invalid: true });
    if (relation.target) references.push({ field: "relation", target: relation.target });
  }
  for (const field of ["supersedes", "superseded_by"]) {
    for (const value of Array.isArray(record.data[field]) ? record.data[field] : []) references.push({ field, target: value });
  }
  return references;
}

function validateKnowledgeRepo(repoPath) {
  const root = path.resolve(repoPath);
  const config = path.join(root, ".department-wiki.json");
  const errors = [];
  if (!fs.existsSync(config)) addError(errors, null, "configuration", "missing .department-wiki.json; run team-wiki init first");

  let records = [];
  try {
    records = loadRecords(root);
  } catch (error) {
    addError(errors, null, "frontmatter", error.message);
    return { ok: false, records: 0, errors, warnings: [] };
  }

  const byId = new Map();
  for (const record of records) {
    validateRequired(record, errors);
    validateSensitive(record, errors);
    if (record.data.type === "case") validateCase(record, errors);
    if (record.data.type === "evidence") validateEvidence(record, errors);
    if (record.data.id) {
      if (byId.has(record.data.id)) addError(errors, record, "duplicate_id", `duplicate record id: ${record.data.id}`);
      byId.set(record.data.id, record);
    }
  }

  for (const record of records) {
    for (const reference of collectReferences(record)) {
      if (reference.invalid) addError(errors, record, "relation_type", `unsupported relation type: ${reference.target}`);
      else if (!byId.has(reference.target)) addError(errors, record, "missing_reference", `${reference.field} target does not exist: ${reference.target}`);
    }
  }

  return { ok: errors.length === 0, records: records.length, errors, warnings: [] };
}

function ensureEmptyOrInitialized(repoPath) {
  if (!fs.existsSync(repoPath)) return;
  const entries = fs.readdirSync(repoPath).filter((entry) => entry !== ".git");
  if (entries.length > 0 && !fs.existsSync(path.join(repoPath, ".department-wiki.json"))) {
    throw new Error(`target directory is not empty: ${repoPath}`);
  }
}

function initKnowledgeRepo(repoPath, options = {}) {
  const root = path.resolve(repoPath);
  ensureEmptyOrInitialized(root);
  fs.mkdirSync(root, { recursive: true });
  const directories = [
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
  ];
  for (const directory of directories) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
    fs.writeFileSync(path.join(root, directory, ".gitkeep"), "", "utf8");
  }
  const configuration = {
    schema_version: 1,
    name: options.name || "AI Infra Department Knowledge",
    default_visibility: "internal",
    generated_directory: "generated",
  };
  fs.writeFileSync(path.join(root, ".department-wiki.json"), `${JSON.stringify(configuration, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    path.join(root, ".gitignore"),
    [".wiki-cache.json", ".wiki-tmp/", "drafts/", "raw-local/", "cache/", "generated/*", "!generated/.gitkeep", "*.pem", "*.key", ""].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "README.md"),
    `# ${configuration.name}\n\nThis private repository stores reviewed, desensitized AI Infra knowledge records.\n`,
    "utf8",
  );
  return { created: true, path: root };
}

function buildKnowledgeArtifacts(repoPath) {
  const root = path.resolve(repoPath);
  const report = validateKnowledgeRepo(root);
  if (!report.ok) throw new Error(`knowledge validation failed with ${report.errors.length} error(s)`);
  const records = loadRecords(root).sort((left, right) => String(left.data.id).localeCompare(String(right.data.id)));
  const generated = path.join(root, "generated");
  fs.mkdirSync(generated, { recursive: true });

  const grouped = new Map();
  for (const record of records) {
    if (!grouped.has(record.data.type)) grouped.set(record.data.type, []);
    grouped.get(record.data.type).push(record);
  }
  const lines = ["# Department Knowledge Index", "", "Generated from reviewed records. Do not edit manually.", ""];
  for (const type of [...grouped.keys()].sort()) {
    lines.push(`## ${type}`, "");
    for (const record of grouped.get(type)) {
      lines.push(`- [${record.data.id}: ${record.data.title}](../${record.relativePath}) - ${record.data.status}`);
    }
    lines.push("");
  }
  fs.writeFileSync(path.join(generated, "index.md"), `${lines.join("\n").trimEnd()}\n`, "utf8");

  const nodes = records.map((record) => ({
    id: record.data.id,
    label: record.data.title,
    path: record.relativePath,
    status: record.data.status,
    type: record.data.type,
    visibility: record.data.visibility,
  }));
  const edges = [];
  for (const record of records) {
    for (const evidenceId of Array.isArray(record.data.evidence) ? record.data.evidence : []) {
      edges.push({ from: record.data.id, relation_type: "has_evidence", to: evidenceId });
    }
    for (const relation of Array.isArray(record.data.relations) ? record.data.relations : []) {
      if (relation && relation.type && relation.target) edges.push({ from: record.data.id, relation_type: relation.type, to: relation.target });
    }
    for (const target of Array.isArray(record.data.supersedes) ? record.data.supersedes : []) {
      edges.push({ from: record.data.id, relation_type: "supersedes", to: target });
    }
    for (const source of Array.isArray(record.data.superseded_by) ? record.data.superseded_by : []) {
      edges.push({ from: source, relation_type: "supersedes", to: record.data.id });
    }
  }
  edges.sort((left, right) => `${left.from}\0${left.relation_type}\0${left.to}`.localeCompare(`${right.from}\0${right.relation_type}\0${right.to}`));
  const graph = { schema_version: 1, nodes, edges };
  fs.writeFileSync(path.join(generated, "graph-data.json"), `${JSON.stringify(graph, null, 2)}\n`, "utf8");

  const health = {
    schema_version: 1,
    generated_at: null,
    records: records.length,
    errors: report.errors.length,
    warnings: report.warnings.length,
    sha256: crypto.createHash("sha256").update(JSON.stringify(graph)).digest("hex"),
  };
  fs.writeFileSync(path.join(generated, "health-report.json"), `${JSON.stringify(health, null, 2)}\n`, "utf8");
  return { nodes: nodes.length, edges: edges.length };
}

function git(repoPath, args) {
  return execFileSync("git", ["-C", repoPath, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function pullKnowledgeRepo(repoPath) {
  const root = path.resolve(repoPath);
  if (!fs.existsSync(path.join(root, ".git"))) throw new Error("knowledge path is not a git repository");
  if (git(root, ["status", "--porcelain"])) throw new Error("knowledge repository has uncommitted changes; commit or discard them before pull");
  git(root, ["fetch", "--prune", "origin"]);
  git(root, ["merge", "--ff-only", "@{u}"]);
  const artifacts = buildKnowledgeArtifacts(root);
  return { updated: true, ...artifacts };
}

module.exports = {
  RECORD_DIRECTORIES,
  buildKnowledgeArtifacts,
  initKnowledgeRepo,
  loadRecords,
  parseFrontmatter,
  pullKnowledgeRepo,
  validateKnowledgeRepo,
};
