# AI Infra Department Wiki

A reviewed, searchable collaboration layer for AI infrastructure teams. Capture experiments, incidents, evaluations, deployments, and reusable conclusions as evidence-backed records that stay maintainable over time.

> This repository distributes the tool. Real department knowledge belongs in a separate private knowledge repository, reviewed through Git branches and pull requests.

[中文](README.md) · [Install](#install) · [Workflow](#workflow) · [Dashboard](#dashboard)

![license](https://img.shields.io/badge/license-MIT-1f883d?style=flat-square)
![node](https://img.shields.io/badge/node-%3E%3D22-1f883d?style=flat-square)
![tests](https://img.shields.io/badge/tests-169%20passed-1f883d?style=flat-square)
![Hermes](https://img.shields.io/badge/Hermes-Skill-8250df?style=flat-square)

## What it does

Team knowledge normally gets trapped in chat, logs, temporary documents, and individual memory. This Skill provides a small complete loop:

- **Capture**: Case, Evidence, Decision, Pattern, Runbook, and Environment records
- **Validate**: frontmatter, JSON Schema, relations, secrets, and repository redaction policy
- **Retrieve**: keyword search, CJK bigrams, and metadata filters for type, status, model, accelerator, and tags
- **Collaborate**: every contribution is a branch and PR; records and newly referenced evidence can ship together
- **Sync**: pull first, then query; see what changed since your last sync
- **Evolve**: only promote a Pattern into a reusable Skill after held-out Skill gates

## Install

This is a public tool repository. Install with Hermes:

```bash
hermes skills install leafsys1/ai-infra-department-wiki/skills/ai-infra-department-wiki
```

Or install directly from the default branch:

```bash
hermes skills install https://raw.githubusercontent.com/leafsys1/ai-infra-department-wiki/main/skills/ai-infra-department-wiki/SKILL.md
```

After installation, the CLI lives at `scripts/team-wiki.js` inside the Skill directory.

## Workflow

### 1. Create a knowledge repository

```bash
node scripts/team-wiki.js init ../department-knowledge --name "AI Infra Department"
cd ../department-knowledge
node .department-tools/scripts/team-wiki.js validate . --strict
```

`init` creates record directories, a redaction policy, CI, a PR template, CODEOWNERS, and a pinned toolchain under `.department-tools/`. Keep the real knowledge repository private.

### 2. Contribute a record

```bash
node .department-tools/scripts/team-wiki.js sync .
node .department-tools/scripts/team-wiki.js query . prefill throughput --accelerator 910b2c
node .department-tools/scripts/team-wiki.js capture . case CASE-2026-0007
# Edit drafts/CASE-2026-0007.md, then move it into records/ and add evidence
node .department-tools/scripts/team-wiki.js validate . --strict
node .department-tools/scripts/team-wiki.js publish . records/cases/inference/CASE-2026-0007.md --push
```

A good PR answers: what happened, where the evidence is, which environment it applies to, what the limits are, and who reviewed it.

### 3. Search and browse

```bash
node .department-tools/scripts/team-wiki.js build .
node .department-tools/scripts/team-wiki.js overview .
node .department-tools/scripts/team-wiki.js show . CASE-2026-0001
node .department-tools/scripts/team-wiki.js related . CASE-2026-0001
```

## Dashboard

Open the [Department Knowledge Dashboard](docs/department-dashboard/index.html). It is a single-file, no-build, no-server view inspired by GitHub repository pages:

- browse by knowledge type on the left, with activity, status distribution, and recent updates in the main area
- search, filter by status/type, sort, inspect records, and explore relations locally
- click “Import catalog.json” to load `generated/catalog.json` from a knowledge repository
- no data is uploaded; the page only reads a local JSON file you explicitly choose

You can also open it directly:

```bash
xdg-open docs/department-dashboard/index.html
```

## Record types

| Type | Purpose |
| --- | --- |
| Case | A complete problem, experiment, or migration conclusion |
| Evidence | A reproducible benchmark, log digest, or supporting artifact |
| Decision | A team choice and its tradeoffs |
| Pattern | A practice that transfers to other tasks |
| Runbook | A procedure someone else can execute |
| Environment | Runtime and dependency baseline |

## Quality gates

```bash
npm run verify:skill-install
node --test tests/js/*.test.js
node workbench/scripts/check-repository-privacy.mjs
```

This repository does not carry real department knowledge. Do not commit customer material, internal addresses, credentials, raw logs, or unredacted performance data.

## License

MIT
