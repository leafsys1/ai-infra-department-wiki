"use strict";

/**
 * Contribution publishing.
 *
 * Publishing one file at a time could not express the most ordinary contribution there is: a case
 * plus the evidence it cites. The guard rejected the second file as "unrelated", so the only way
 * through was to bypass the tool and commit to the default branch by hand — exactly the review
 * bypass the guard existed to prevent.
 *
 * A publish is now a *record set*: the records you name, plus the records they reference that are
 * not on the base branch yet. That set is what the branch contains, the guard only polices changes
 * outside it, and before anything is pushed the committed tree is materialised in a temporary
 * worktree and validated — so a pushed branch is known to validate on its own.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { parseFrontmatter, validateKnowledgeRepo } = require("./team-wiki");

const DEFAULT_BRANCH = "main";

function git(repoPath, args, options = {}) {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitQuiet(repoPath, args) {
  try {
    return { ok: true, output: git(repoPath, args) };
  } catch (error) {
    return { ok: false, output: (error.stderr || error.message || "").toString().trim() };
  }
}

function toRelative(repoPath, candidate) {
  const root = path.resolve(repoPath);
  const absolute = path.resolve(root, candidate);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error(`target is outside the knowledge repository: ${candidate}`);
  }
  return path.relative(root, absolute).split(path.sep).join("/");
}

function readRecord(repoPath, relative) {
  const file = path.join(repoPath, relative);
  const source = fs.readFileSync(file, "utf8");
  return { relative, source, data: parseFrontmatter(source) };
}

function trackedInHead(repoPath, relative) {
  return gitQuiet(repoPath, ["cat-file", "-e", `HEAD:${relative}`]).ok;
}

function changedAgainstHead(repoPath, relative) {
  const status = git(repoPath, ["status", "--porcelain", "--", relative]);
  return status.length > 0 || !trackedInHead(repoPath, relative);
}

/**
 * The publish set. References are followed in both directions of the natural dependency: a case
 * cites evidence, a pattern cites cases, a record supersedes another. Only referenced records that
 * actually differ from the base branch are pulled in, so an unrelated in-flight edit elsewhere in
 * the repository is never swept into the branch.
 */
function resolvePublishSet(repoPath, targets, options = {}) {
  const root = path.resolve(repoPath);
  const withDependencies = options.withDependencies !== false;
  const primary = targets.map((target) => toRelative(root, target));
  for (const relative of primary) {
    if (!relative.startsWith("records/")) throw new Error(`target must be a record under records/: ${relative}`);
    if (!fs.existsSync(path.join(root, relative))) throw new Error(`target does not exist: ${relative}`);
  }

  const included = new Map(primary.map((relative) => [relative, "requested"]));
  const queue = [...primary];
  const seen = new Set(primary);
  while (withDependencies && queue.length > 0) {
    const current = queue.shift();
    let record;
    try {
      record = readRecord(root, current);
    } catch {
      continue;
    }
    const references = [
      ...(Array.isArray(record.data.evidence) ? record.data.evidence : []),
      ...(Array.isArray(record.data.relations) ? record.data.relations.map((relation) => relation && relation.target) : []),
      ...(Array.isArray(record.data.supersedes) ? record.data.supersedes : []),
      ...(Array.isArray(record.data.superseded_by) ? record.data.superseded_by : []),
    ].filter((value) => typeof value === "string" && value);
    for (const reference of references) {
      const relative = findRecordPath(root, reference);
      if (!relative || seen.has(relative)) continue;
      seen.add(relative);
      if (!changedAgainstHead(root, relative)) continue;
      included.set(relative, `referenced by ${record.data.id || current}`);
      queue.push(relative);
    }
  }

  return {
    primary,
    paths: [...included.keys()].sort(),
    reasons: Object.fromEntries([...included.entries()].sort(([left], [right]) => left.localeCompare(right))),
  };
}

function findRecordPath(repoPath, id) {
  const directories = ["cases", "evidence", "decisions", "patterns", "runbooks", "environments"];
  for (const directory of directories) {
    const hit = searchForId(path.join(repoPath, "records", directory), `${id}.md`, "");
    if (hit) return `records/${directory}${hit}`;
  }
  return null;
}

function searchForId(directory, fileName, prefix) {
  if (!fs.existsSync(directory)) return null;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isDirectory()) {
      const found = searchForId(path.join(directory, entry.name), fileName, `${prefix}/${entry.name}`);
      if (found) return found;
    } else if (entry.name === fileName) {
      return `${prefix}/${entry.name}`;
    }
  }
  return null;
}

function assertPublishable(repoPath, set) {
  for (const relative of set.primary) {
    const record = readRecord(repoPath, relative);
    const status = String(record.data.status || "");
    if (status === "draft") throw new Error(`draft records cannot be published: ${relative}`);
    if (status === "rejected") throw new Error(`rejected records cannot be published: ${relative}`);
    if (String(record.data.visibility || "") === "local-only") throw new Error(`local-only records cannot be published: ${relative}`);
  }
}

function guardUnrelatedChanges(repoPath, allowed) {
  const allowedSet = new Set(allowed);
  const rows = git(repoPath, ["status", "--porcelain"]).split(/\r?\n/).filter(Boolean);
  const unrelated = [];
  for (const row of rows) {
    const raw = row.slice(3);
    const relative = (raw.includes(" -> ") ? raw.split(" -> ").pop() : raw).replace(/^"|"$/g, "").replaceAll("\\", "/");
    if (!allowedSet.has(relative)) unrelated.push(row.trim());
  }
  if (unrelated.length > 0) {
    throw new Error(`knowledge repository has changes outside the publish set: ${unrelated.join(", ")}`);
  }
}

/**
 * Records whose files changed between two commits — what a `sync` actually pulled. Working from the
 * diff (not from the `updated` field) means a colleague sees exactly what arrived, including a fix
 * to an old record that kept its original date.
 */
function changedRecordsBetween(repoPath, from, to) {
  if (!from || !to || from === to) return [];
  const result = gitQuiet(repoPath, ["diff", "--name-only", `${from}..${to}`, "--", "records/"]);
  if (!result.ok || !result.output) return [];
  return result.output.split(/\r?\n/)
    .filter((line) => line.endsWith(".md"))
    .map((line) => ({ path: line, id: path.basename(line, ".md") }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function detectPullRequestUrl(repoPath, baseBranch, branch) {
  const remote = gitQuiet(repoPath, ["remote", "get-url", "origin"]);
  if (!remote.ok) return null;
  const match = remote.output.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) return null;
  return `https://github.com/${match[1]}/${match[2]}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(branch)}?expand=1`;
}

function currentUser(repoPath) {
  const configured = gitQuiet(repoPath, ["config", "user.name"]);
  const name = (configured.ok && configured.output) || process.env.USER || process.env.USERNAME || "contributor";
  return name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "contributor";
}

function branchNameFor(repoPath, primary, baseBranch) {
  const slug = path.basename(primary, ".md").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const base = `knowledge/${currentUser(repoPath)}/${slug}`;
  let candidate = base;
  let suffix = 2;
  while (gitQuiet(repoPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${candidate}`]).ok) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  if (candidate === baseBranch) throw new Error(`refusing to publish onto the base branch name: ${base}`);
  return candidate;
}

/** Validate the committed tree, not the working tree, by materialising it in a temporary worktree. */
function validateCommittedTree(repoPath, strict) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "team-wiki-branch-"));
  const worktree = path.join(parent, "tree");
  try {
    git(repoPath, ["worktree", "add", "--detach", worktree, "HEAD"]);
    const report = validateKnowledgeRepo(worktree, { strict });
    return { ok: report.ok, errors: report.errors, warnings: report.warnings, records: report.records };
  } finally {
    gitQuiet(repoPath, ["worktree", "remove", "--force", worktree]);
    fs.rmSync(parent, { recursive: true, force: true });
  }
}

function publishRecordSet(repoPath, targets, options = {}) {
  const root = path.resolve(repoPath);
  if (targets.length === 0) throw new Error("publish needs at least one record path");
  if (!fs.existsSync(path.join(root, ".git"))) throw new Error("knowledge path is not a git repository");
  const configFile = path.join(root, ".department-wiki.json");
  const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, "utf8")) : {};
  const baseBranch = options.baseBranch || config.default_branch || DEFAULT_BRANCH;

  const currentBranch = git(root, ["branch", "--show-current"]);
  if (currentBranch !== baseBranch) {
    throw new Error(`publish must start from ${baseBranch}, current branch is ${currentBranch || "detached HEAD"}`);
  }

  const set = resolvePublishSet(root, targets, { withDependencies: options.withDependencies });
  assertPublishable(root, set);
  guardUnrelatedChanges(root, set.paths);

  const strict = options.allowWarnings !== true;
  const report = validateKnowledgeRepo(root, { strict });
  if (!report.ok) {
    const first = report.errors[0] || report.warnings[0];
    throw new Error(
      `knowledge validation failed: ${report.errors.length} error(s), ${report.warnings.length} warning(s)`
      + `${first ? ` (first: ${first.message})` : ""}`,
    );
  }

  const staged = set.paths.filter((relative) => changedAgainstHead(root, relative));
  if (staged.length === 0) throw new Error("nothing to publish: every target already matches the base branch");

  const branch = branchNameFor(root, set.primary[0], baseBranch);
  const ids = set.primary.map((relative) => path.basename(relative, ".md")).sort();
  const message = options.message || `knowledge: add ${ids.join(", ")}`;

  if (options.dryRun === true) {
    return { branch, base_branch: baseBranch, paths: set.paths, reasons: set.reasons, message, pushed: false, dry_run: true };
  }

  git(root, ["switch", "-c", branch]);
  try {
    git(root, ["add", "--", ...staged]);
    git(root, ["-c", "commit.gpgsign=false", "commit", "-m", message, "--", ...staged]);
  } catch (error) {
    gitQuiet(root, ["switch", baseBranch]);
    gitQuiet(root, ["branch", "-D", branch]);
    throw new Error(`commit failed, branch rolled back: ${(error.stderr || error.message).toString().trim()}`);
  }

  const branchCheck = validateCommittedTree(root, strict);
  if (!branchCheck.ok) {
    const detail = [...branchCheck.errors, ...branchCheck.warnings].slice(0, 3).map((item) => item.message).join("; ");
    gitQuiet(root, ["switch", baseBranch]);
    gitQuiet(root, ["branch", "-D", branch]);
    throw new Error(`the published branch would not validate on its own, rolled back: ${detail}`);
  }

  const result = {
    branch,
    base_branch: baseBranch,
    paths: staged.slice().sort(),
    reasons: set.reasons,
    message,
    commit: git(root, ["rev-parse", "HEAD"]),
    branch_validation: { ok: true, records: branchCheck.records, warnings: branchCheck.warnings.length },
    pushed: false,
    pr_url: detectPullRequestUrl(root, baseBranch, branch),
  };

  if (options.push === true) {
    git(root, ["push", "-u", "origin", branch]);
    const remote = gitQuiet(root, ["ls-remote", "origin", branch]);
    const remoteSha = remote.ok ? (remote.output.split(/\s+/)[0] || "") : "";
    if (remoteSha !== result.commit) {
      throw new Error(`push readback mismatch: local ${result.commit}, remote ${remoteSha || "<missing>"}`);
    }
    result.pushed = true;
    result.remote_commit = remoteSha;
  }
  return result;
}

module.exports = {
  DEFAULT_BRANCH,
  assertPublishable,
  changedRecordsBetween,
  resolvePublishSet,
  publishRecordSet,
  validateCommittedTree,
};
