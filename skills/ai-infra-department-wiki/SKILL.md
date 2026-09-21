---
name: ai-infra-department-wiki
description: Use when a team captures, reviews, syncs, queries, or evolves shared AI Infra knowledge. Enforces evidence, applicability, redaction, Git review, and held-out Skill gates.
version: 0.1.0
author: leafsys1
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [ai-infra, wiki, knowledge-management, performance, skill-evolution]
---

# AI Infra Department Wiki

## Overview

Maintain a private, reviewed department knowledge repository for model inference, training, communication, deployment, incidents, and performance optimization. This Skill complements the root `llm-wiki` personal research workflow; it does not turn a personal vault into a shared repository.

The shared unit is a desensitized, evidence-backed record. Personal drafts, raw logs, caches, customer material, and local graph state stay local.

## Required Orientation

Before any department operation:

1. Read `references/ai-infra-schema.md`.
2. Read `references/security-and-redaction.md`.
3. For publish/review, read `references/contribution-workflow.md` and `references/review-policy.md`.
4. For Pattern-to-Skill work, read `references/wikiskill-comparison.md`.

Resolve paths relative to this `SKILL.md` directory. The support files are installed beside the Skill.

## Commands

```bash
node scripts/team-wiki.js init <knowledge-repo> --name "AI Infra Department"
node scripts/team-wiki.js pull <knowledge-repo>
node scripts/team-wiki.js capture <knowledge-repo> <case|evidence|decision|pattern|runbook|environment> <id>
node scripts/team-wiki.js validate <knowledge-repo>
node scripts/team-wiki.js build <knowledge-repo>
node scripts/team-wiki.js health <knowledge-repo>
node scripts/team-wiki.js publish <knowledge-repo> <record-path> [--push]
node scripts/team-wiki.js gate <knowledge-repo> <baseline.json> <candidate.json> <proposal-id>
```

## Workflow Routing

### Initialize

Use `init` only for a new private knowledge repository. It creates record directories, local-only draft/raw/cache boundaries, generated-artifact ignores, and a shared `skill-impact/` history. Completion criterion: `.department-wiki.json` exists and `validate` returns `ok=true`.

### Pull

Use `pull` to update an existing clone. It requires a clean worktree, fetches and fast-forwards only, then rebuilds local artifacts. Never auto-stash, force reset, or resolve conflicts. Completion criterion: pull reports success and generated index/graph build without validation errors.

### Capture

Use `capture` to create a complete local draft from the department template. Fill unknown facts as `unknown`; never guess model, hardware, framework, topology, benchmark, or validation data. Drafts remain ignored until a human moves the finished record into `records/`. Completion criterion: the draft contains context, evidence, applicability, and owner fields appropriate to its type.

### Validate

Run `validate` before any publish or review. Treat errors as blockers. The scanner is a minimum control, not proof that content is safe. Completion criterion: `ok=true`, then a domain reviewer confirms claims and redaction.

### Publish

Publish only one validated record at a time. The command rejects unrelated worktree changes, creates a contribution branch, commits the record, and pushes only when `--push` is explicit. Do not create or merge a PR unless the user or department policy explicitly requests it. Completion criterion: the branch contains only the intended record change and remote push is read back when requested.

### Compile And Query

`build` generates a deterministic local index, graph data, and health report from explicit record relationships. Query the generated index first, then read the most relevant records and their evidence. Do not treat co-occurrence as causality or a graph edge as validation.

### Pattern To Skill

A Pattern may motivate a Skill candidate, but knowledge and executable procedures have separate acceptance rules:

1. Link the candidate to supporting and counterexample records.
2. Prepare fixed, auto-gradable held-out tasks not used to author the candidate.
3. Run baseline and candidate under the same model, tools, environment, task IDs, and budgets.
4. Save per-task boolean outcomes as JSON arrays: `[{"task_id":"...","passed":true}]`.
5. Run `gate`; it uses strict score improvement as a first mechanical filter and records paired outcomes plus an exact-binomial diagnostic.
6. Do not tune repeatedly against the same held-out set. Formal promotion requires separate validation and release-only test tasks, repeated runs, a minimum useful effect, and zero regressions on critical tasks.
7. A passed mechanical gate remains a candidate until human review covers security, precision, cost, latency, regressions, applicability, and licensing.
8. Preserve rejected outcomes so later proposals do not repeat failed approaches.

The MVP never edits the official Skill automatically and never runs destructive Git rollback.

## Hard Rules

- The Skill repository and knowledge repository are separate.
- The knowledge repository must be private.
- `restricted` content belongs in a separately access-controlled repository.
- Never publish raw customer logs, credentials, private addresses, personal paths, model weights, or unrestricted profiler output.
- Never upgrade `observed` to `verified` without sufficient repeated evidence.
- Never let generated pages become evidence for their own claims.
- Never auto-push drafts, auto-merge, or auto-resolve knowledge conflicts.
- Never expose the current local Workbench as a department service; it has no department SSO/RBAC model.

## Common Pitfalls

- Sharing `.wiki-cache.json`, generated graph layouts, or a common Obsidian vault.
- Treating source confidence as engineering validation.
- Comparing results from different models, quantization, hardware, versions, workloads, or benchmark settings.
- Building a visually rich graph before enforcing evidence and lifecycle rules.
- Accepting a Skill from one stochastic run or a higher mean without per-task paired evidence.
- Copying WikiSkill's `git reset --hard` rollback into a shared department repository.

## Verification Checklist

- [ ] Knowledge repository is private and separate from the installed Skill.
- [ ] Record ID, filename, type, status, visibility, owner, and schema version are valid.
- [ ] Engineering context and applicability are explicit.
- [ ] Evidence IDs resolve and include source hashes and locators.
- [ ] Sensitive-content scan has no blocker and domain review is complete.
- [ ] Links and explicit relations resolve.
- [ ] Generated artifacts rebuild deterministically.
- [ ] Publish branch contains only the intended record.
- [ ] Skill candidates use identical held-out task IDs and preserve rejected outcomes.
