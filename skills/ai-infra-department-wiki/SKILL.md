---
name: ai-infra-department-wiki
description: Use when a team captures, reviews, syncs, queries, or evolves shared AI Infra knowledge. Enforces evidence, applicability, redaction, Git review, and held-out Skill gates.
version: 0.2.0
author: leafsys1
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [ai-infra, wiki, knowledge-management, retrieval, performance, skill-evolution]
---

# AI Infra Department Wiki

## Overview

Maintain a private, reviewed department knowledge repository for model inference, training,
communication, deployment, incidents, and performance optimization. This Skill complements the root
`llm-wiki` personal research workflow; it does not turn a personal vault into a shared repository.

The shared unit is a desensitized, evidence-backed record. Personal drafts, raw logs, caches, customer
material, and local graph state stay local.

Two things matter more than anything else here: a colleague must be able to **find** what the
department already knows, and everything in the repository must still be **true** when someone else
reads it next quarter.

## Required Orientation

Before any department operation:

1. Read `references/ai-infra-schema.md`.
2. Read `references/security-and-redaction.md`.
3. For publish/review, read `references/contribution-workflow.md` and `references/review-policy.md`.
4. To find knowledge, read `references/retrieval-and-sync.md`.
5. For the shared repository model and onboarding, read `references/knowledge-repo-governance.md`.
6. For Pattern-to-Skill work, read `references/wikiskill-comparison.md`.
7. For inference validation, customer delivery, and QA-package ingestion, read `references/inference-delivery-qa-bridge.md` and load the sibling `inference-delivery-qa` Skill.

Resolve paths relative to this `SKILL.md` directory. The support files are installed beside the Skill.

## Supported sibling Skill

The distribution package also includes `inference-delivery-qa`, a standalone Python Agent Skill adopted from the delivery QA project. Install or load the complete `skills/inference-delivery-qa/` directory when an agent needs to inspect an inference deployment, optimization result, benchmark dataset, or customer delivery package. Its original upstream tests are mirrored under `tests/inference-delivery-qa/`; the adoption record is `docs/inference-delivery-qa-adoption.md`.


```bash
node scripts/team-wiki.js init <repo> [--name "AI Infra Department"] [--no-scaffold]
node scripts/team-wiki.js pull <repo>
node scripts/team-wiki.js sync <repo>
node scripts/team-wiki.js capture <repo> <case|evidence|decision|pattern|runbook|environment> <id>
node scripts/team-wiki.js validate <repo> [--strict]
node scripts/team-wiki.js build <repo>
node scripts/team-wiki.js overview <repo> [--json]
node scripts/team-wiki.js health <repo>
node scripts/team-wiki.js query <repo> [terms...] [--type --status --area --owner --tag --model --framework --accelerator --since --limit --any --json]
node scripts/team-wiki.js show <repo> <id>
node scripts/team-wiki.js related <repo> <id>
node scripts/team-wiki.js publish <repo> <record...> [--push] [--dry-run] [--only] [--allow-warnings]
node scripts/team-wiki.js upgrade-tools <repo> [--write]
node scripts/team-wiki.js gate <repo> <baseline.json> <candidate.json> <proposal-id> [--alpha --min-effect --min-discordant --critical <file>]
```

Exit codes: 0 ok, 1 error, 2 usage, 3 gate not accepted.

## Workflow Routing

### Initialize

`init` creates a new private knowledge repository **or completes an existing one**. It is safe on a
non-empty directory (the usual case: a fresh private repo already has a README), idempotent, and never
overwrites an existing file. It writes the record directories, the local-only ignore rules, a shared
redaction policy, a CI workflow, a pull-request template and CODEOWNERS, and vendors the validator into
`.department-tools/` with a pinned version.

Completion criterion: `.department-wiki.json` exists, `validate` returns `ok=true`, and
`.department-tools/scripts/team-wiki.js validate . --strict` runs (that is the command CI uses).

### Sync Before You Search

`sync` fast-forwards the clone, rebuilds artifacts, and lists what changed since your previous HEAD,
then prints the corpus summary. Run it before starting work: the cheapest way to avoid duplicating a
colleague's result is to see that they already got one.

### Query Before You Derive

`query` searches the department catalog with field-weighted scoring, ANDed terms, and per-hit reasons.
The same retrieval is available to a human as `generated/index.md`, `generated/catalog.json` and
`generated/overview.md` after a `build`. Never answer "does anyone know about X" by reading every
record; query first, then read the hits, then `related` to see what cites them.

Completion criterion: the answer names record ids, and the ids resolve.

### Capture

`capture` creates a complete local draft from the department template. Fill unknown facts as
`unknown`; never guess model, hardware, framework, topology, benchmark, or validation data. Drafts stay
in the ignored `drafts/` directory until a human moves the finished record into `records/`. Completion
criterion: the draft contains context, evidence, applicability, and owner fields appropriate to its type.

### Validate

Run `validate` before any publish or review. Errors are blockers; warnings are surfaced and become
blockers under `--strict`, which is what CI and `publish` use. Treat the scanner as a minimum control,
not proof that content is safe. `validate` also reports `drafts=N local only`: drafts are gitignored, so
a finished draft that was never moved into `records/` reaches nobody however green the output is.
Completion criterion: `ok=true`, then a domain reviewer confirms claims and redaction.

### Publish

Publish a **record set**: the records you name plus the records they newly reference. The command
refuses unrelated worktree changes, refuses `draft`/`rejected`/`local-only` records, creates a
contribution branch, revalidates the committed tree in a temporary worktree, and pushes only when
`--push` is explicit, reading the remote commit back. It rolls the branch back if the tree would not
validate on its own. Do not create or merge a PR unless the user or department policy explicitly
requests it. Completion criterion: the branch contains only the intended records, the branch validates
in isolation, and a remote push is read back when requested.

### Compile And Query Artifacts

`build` regenerates the local artifacts deterministically: `index.md`, `catalog.json`, `overview.md`,
`graph-data.json` and `dashboard.html`. They are gitignored and never an authority for a claim. Human
edits go to source records. Completion criterion: a rebuild produces identical bytes and `validate`
stays `ok=true`.

### Open The Dashboard

`build` copies the shipped single-file dashboard (`assets/dashboard/index.html`) to
`<repo>/generated/dashboard.html`, next to the `catalog.json` it renders. There is no server and no
build step.

1. Run `node .department-tools/scripts/team-wiki.js build <repo>`.
2. Open `<repo>/generated/dashboard.html` in a browser.
3. Over `http(s)://` it auto-loads `./catalog.json`. From `file://` the browser blocks that fetch, so
   click **导入 catalog.json** and select `<repo>/generated/catalog.json`.

The page shows the corpus overview, a type-organised knowledge tree, a Markdown reader with each
record's body, the relation graph, cross-references and sources. Agents never read this file: they use
`query`, `show`, `related` and `overview`, which return the same catalog data.

### Evolve A Skill

`gate` compares a candidate against the baseline on **identical** held-out task ids and accepts only a
strict improvement that clears the configured effect and significance floors. It reports the observed
discordant pairs, the number significance requires, and the smallest delta the task set could have
detected. Below that floor the verdict is `rejected_not_enough_resolution` — say "not enough
resolution", never "no benefit". Rejected proposals stay in `skill-impact/`. Completion criterion: the
gate report exists, verdict and per-task outcomes are recorded, and no accepted candidate regresses a
critical task.

### Upgrade The Pinned Toolchain

`upgrade-tools` reports drift between the repository's pinned `.department-tools/` and the installed
Skill, and `--write` re-pins it. Run it from the installed Skill, never from the pinned copy. Treat the
resulting diff as a governance change: it alters the rules every future record is validated against.

## Safety Rules

- Never publish raw logs, weights, customer material, credentials, private addresses, or a colleague's
  home path.
- Never guess engineering facts; write `unknown` and leave the record `observed`.
- Never rewrite or delete reviewed history when `supersedes`/`deprecated` expresses the change.
- Never present a generated artifact as evidence.
- Never let `publish` reach the default branch: it makes a contribution branch, nothing else.
- Never claim "no benefit" from an underpowered gate; report the resolution instead.
- Do not treat `local-only` content as unclassified; it must not reach an external model.
- Do not `git reset --hard` in a shared knowledge repository.
- Never expose the current local Workbench as a department service; it has no department SSO/RBAC model.

## Common Pitfalls

- Searching from memory instead of `query`, then writing a record that already exists.
- Sharing `.wiki-cache.json`, generated graph layouts, or a common Obsidian vault.
- Treating source confidence as engineering validation.
- Comparing results from different models, quantization, hardware, versions, workloads, or benchmark settings.
- Building a visually rich graph before enforcing evidence and lifecycle rules.
- Accepting a Skill from one stochastic run or a higher mean without per-task paired evidence.
- Copying WikiSkill's `git reset --hard` rollback into a shared department repository.
- Putting any plain markdown file under `records/`; everything matching `records/**/*.md` is parsed as a
  record and will fail without frontmatter.
- Editing `.department-tools/` by hand instead of running `upgrade-tools`, which hides the version change.
- Adding a redaction exception by disabling a built-in rule instead of an explicit `allow` entry.

## Verification Checklist

- [ ] Knowledge repository is private and separate from the installed Skill.
- [ ] Record ID, filename, type, status, visibility, owner, and schema version are valid.
- [ ] Engineering context and applicability are explicit.
- [ ] Evidence IDs resolve and include source hashes and locators.
- [ ] Sensitive-content scan has no blocker, warnings are either resolved or explicitly allowed, and
      domain review is complete.
- [ ] Links and explicit relations resolve.
- [ ] Generated artifacts rebuild deterministically.
- [ ] The published branch contains only the intended record set and validates on its own.
- [ ] Before writing new knowledge, `query` confirmed no existing record covers the same mechanism.
- [ ] Skill candidates use identical held-out task IDs, clear the resolution floor, and preserve
      rejected outcomes.

## Support Files

Every file this Skill needs at runtime. Kept complete on purpose: an install that fetches only the
files the text happens to link would produce a Skill whose CLI cannot start, so any new file must be
listed here and the package test enforces it.

```text
scripts/team-wiki.js
scripts/lib/team-wiki.js
scripts/lib/query.js
scripts/lib/schema.js
scripts/lib/policy.js
scripts/lib/scaffold.js
scripts/lib/publish.js
scripts/lib/skill-gate.js
scripts/schemas/record.schema.json
scripts/schemas/relation.schema.json
scripts/schemas/skill-gate.schema.json
templates/department/case-template.md
templates/department/evidence-template.md
templates/department/decision-template.md
templates/department/pattern-template.md
templates/department/runbook-template.md
templates/department/environment-template.md
references/ai-infra-schema.md
references/contribution-workflow.md
references/knowledge-repo-governance.md
references/retrieval-and-sync.md
references/review-policy.md
references/security-and-redaction.md
references/wikiskill-comparison.md
references/inference-delivery-qa-bridge.md
assets/dashboard/index.html
```

If a command fails with `Cannot find module './lib/…'` or `department template missing`, the
installation is incomplete: reinstall the whole Skill directory rather than copying individual files.
