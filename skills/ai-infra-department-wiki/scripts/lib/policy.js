"use strict";

/**
 * Redaction policy: what may never reach the shared knowledge repository.
 *
 * Built-in rules are deliberately conservative and identical for every department, so they cover
 * only universally-dangerous material (credentials, personal home paths, private network
 * addresses). Anything department-specific — customer names, project codenames, internal host
 * tags, ticket prefixes — belongs in the knowledge repository's own `.department-redaction.json`
 * so the rules travel with the records and every colleague inherits them.
 *
 * Severities:
 *   block — validate fails and publish refuses.
 *   warn  — reported and recorded; publish refuses unless `--allow-warnings`, validate needs
 *           `--strict` to fail. Use for things that are usually fine (a public IP in a public
 *           benchmark note) but must be seen by a human.
 */

const fs = require("node:fs");
const path = require("node:path");

const POLICY_FILE = ".department-redaction.json";

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
  /^255\./,
];

function isPublicIPv4(candidate) {
  const octets = candidate.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return !PRIVATE_V4.some((range) => range.test(candidate));
}

/** Universal blockers: credentials and personal data, never acceptable in a shared record. */
const BUILTIN_BLOCK = Object.freeze([
  { name: "private_key", pattern: "-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----" },
  { name: "github_token", pattern: "\\b(?:ghp_|github_pat_)[A-Za-z0-9_-]{12,}\\b" },
  { name: "api_key", pattern: "\\bsk-[A-Za-z0-9_-]{12,}\\b" },
  {
    name: "credential_assignment",
    pattern: "\\b(?:api[_-]?key|password|passwd|secret|token)\\s*[:=]\\s*[\"']?[A-Za-z0-9_./+=-]{12,}",
    flags: "i",
  },
  { name: "personal_home", pattern: "(?:^|[\\s`\"'])\\/(?:home|Users)\\/(?!user\\b|example\\b|demo\\b)[^/\\s`\"']+\\/" },
  { name: "private_ipv4", pattern: "\\b(?:10(?:\\.\\d{1,3}){3}|192\\.168(?:\\.\\d{1,3}){2}|172\\.(?:1[6-9]|2\\d|3[01])(?:\\.\\d{1,3}){2})(?::\\d{1,5})?\\b" },
]);

/**
 * Universal warnings. `filter` receives the matched text and may veto the match, which keeps
 * "every IPv4 literal" from firing on 10.x addresses the blocker already owns.
 */
const BUILTIN_WARN = Object.freeze([
  {
    name: "public_ipv4",
    pattern: "\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b",
    filter: (match) => isPublicIPv4(match),
  },
  {
    // Host tags such as S900K3-1240 or A800-9000: letters+digits, a dash, more digits. Bare
    // numeric host ids (60006) cannot be told apart from ordinary quantities in this domain
    // (16384, 65536), so they belong in the policy file, not in the universal rule set.
    name: "host_tag",
    pattern: "\\b[A-Z]{1,4}\\d{2,4}[A-Z0-9]*-\\d{2,5}\\b",
  },
]);

function stringifyRule(rule, severity) {
  if (!rule || typeof rule !== "object") throw new Error(`${severity} rule must be an object`);
  const name = typeof rule.name === "string" && rule.name.trim();
  if (!name) throw new Error(`${severity} rule requires a name`);
  if (typeof rule.pattern !== "string" || !rule.pattern) throw new Error(`${severity} rule ${name} requires a pattern`);
  const flags = typeof rule.flags === "string" ? rule.flags : "";
  let expression;
  try {
    expression = new RegExp(rule.pattern, flags.includes("g") ? flags : `${flags}g`);
  } catch (error) {
    throw new Error(`${severity} rule ${name} has an invalid pattern: ${error.message}`);
  }
  return {
    name,
    severity,
    expression,
    filter: typeof rule.filter === "function" ? rule.filter : null,
    source: typeof rule.source === "string" ? rule.source : "policy",
  };
}

function compileBuiltin(rule, severity) {
  const compiled = stringifyRule(rule, severity);
  return { ...compiled, filter: rule.filter || null, source: "builtin" };
}

function compileAllow(entry, index) {
  if (typeof entry === "string") return { name: `allow[${index}]`, expression: new RegExp(entry) };
  if (entry && typeof entry === "object" && typeof entry.pattern === "string") {
    return { name: entry.name || `allow[${index}]`, expression: new RegExp(entry.pattern, entry.flags || "") };
  }
  throw new Error(`allow[${index}] must be a pattern string or an object with a pattern`);
}

/**
 * Load the merged policy for a knowledge repository. A missing policy file is normal (the
 * built-ins still apply); a malformed one is a hard error, because silently degrading redaction is
 * worse than refusing to validate.
 */
function loadPolicy(repoPath) {
  const file = path.join(path.resolve(repoPath), POLICY_FILE);
  let config = {};
  let present = false;
  if (fs.existsSync(file)) {
    present = true;
    try {
      config = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      throw new Error(`${POLICY_FILE} is not valid JSON: ${error.message}`);
    }
    if (config === null || typeof config !== "object" || Array.isArray(config)) {
      throw new Error(`${POLICY_FILE} must contain a JSON object`);
    }
  }
  const disabled = new Set(Array.isArray(config.disable_builtin) ? config.disable_builtin : []);
  for (const list of [config.block, config.warn, config.allow, config.disable_builtin]) {
    if (list !== undefined && !Array.isArray(list)) throw new Error(`${POLICY_FILE}: block/warn/allow/disable_builtin must be arrays`);
  }
  const block = [
    ...BUILTIN_BLOCK.filter((rule) => !disabled.has(rule.name)).map((rule) => compileBuiltin(rule, "block")),
    ...(Array.isArray(config.block) ? config.block : []).map((rule) => stringifyRule(rule, "block")),
  ];
  const warn = [
    ...BUILTIN_WARN.filter((rule) => !disabled.has(rule.name)).map((rule) => compileBuiltin(rule, "warn")),
    ...(Array.isArray(config.warn) ? config.warn : []).map((rule) => stringifyRule(rule, "warn")),
  ];
  const allow = (Array.isArray(config.allow) ? config.allow : []).map(compileAllow);
  return { file: present ? POLICY_FILE : null, present, block, warn, allow, rules: [...block, ...warn] };
}

/**
 * Scan one source document. Returns findings sorted by severity then rule name, each finding
 * carrying the first offending excerpt so a reviewer can see what was matched without opening the
 * file.
 */
function scanSource(source, policy) {
  const findings = [];
  for (const rule of policy.rules) {
    rule.expression.lastIndex = 0;
    const match = rule.expression.exec(source);
    if (!match) continue;
    const text = match[0];
    if (rule.filter && !rule.filter(text)) continue;
    if (policy.allow.some((allowed) => allowed.expression.test(text))) continue;
    findings.push({ rule: rule.name, severity: rule.severity, source: rule.source, match: text });
  }
  findings.sort((left, right) => (left.severity === right.severity
    ? left.rule.localeCompare(right.rule)
    : left.severity === "block" ? -1 : 1));
  return findings;
}

function defaultPolicyConfig() {
  return {
    schema_version: 1,
    _comment: "Department redaction rules. Committed with the knowledge repository so every colleague inherits them. Edit block/warn/allow below; 'examples' is ignored by the tool.",
    block: [
      {
        name: "customer_or_project_codename",
        pattern: "REPLACE-WITH-INTERNAL-CODEWORD",
        flags: "i",
      },
    ],
    warn: [
      { name: "internal_ticket_prefix", pattern: "\\b(?:JIRA|ISSUE|TICKET)-\\d+", flags: "i" },
    ],
    allow: [
      { name: "public_demo_host", pattern: "example\\.invalid" },
    ],
    disable_builtin: [],
    examples: {
      numeric_host_id: {
        name: "numeric_host_id",
        pattern: "(?<![\\w.-])(?:60006|60007)(?![\\w.-])",
        flags: "",
        note: "Bare unit numbers cannot be told apart from ordinary quantities (16384, 65536), so they are not a built-in rule. Copy this into warn/block and list your own units.",
      },
      customer_name: {
        name: "customer_name",
        pattern: "某客户|某部门",
        flags: "",
        note: "Prefer codewords and generic nouns in shared records; use block when a real name must never appear.",
      },
    },
  };
}

module.exports = {
  BUILTIN_BLOCK,
  BUILTIN_WARN,
  POLICY_FILE,
  defaultPolicyConfig,
  isPublicIPv4,
  loadPolicy,
  scanSource,
};
