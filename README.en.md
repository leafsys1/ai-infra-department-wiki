# AI Infra Department Knowledge Skill

A collaboration layer for AI infrastructure validation, delivery, and knowledge capture. Turn reusable conclusions from model adaptation, operator migration, serving optimization, NPU reproduction, incident analysis, and customer delivery into evidence-backed, searchable organizational knowledge.

> This repository distributes the Skill, templates, schemas, and pinned tooling. Real department knowledge belongs in a separate knowledge repository reviewed through Git branches and pull requests.

[![license](https://img.shields.io/badge/license-MIT-1f883d?style=flat-square)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22-1f883d?style=flat-square)](https://nodejs.org/)
[![tests](https://img.shields.io/badge/tests-169%20passed-1f883d?style=flat-square)](#quality-gates)
[![Hermes](https://img.shields.io/badge/Hermes-Skill-8250df?style=flat-square)](https://hermes-agent.nousresearch.com/docs)

## Why it exists

Useful AI Infra knowledge is scattered across test logs, model packages, delivery reports, optimization notes, incident reviews, and chat. This Skill turns those materials into one auditable loop:

- **Test outcomes**: objective, inputs, environment, metrics, result, failure cause, and reproduction command
- **Customer delivery**: artifact inventory, dependencies, startup, acceptance criteria, reproduction status, and applicable environments
- **Optimization**: baseline, change, paired result, resolution power, benefit, and rollback condition
- **Incident review**: symptom, minimal reproduction, root cause, fix, regression test, and remaining risk
- **Knowledge records**: Case, Evidence, Decision, Pattern, Runbook, and Environment
- **Human + agent access**: agents use the CLI and structured `catalog.json`; people use the Chinese dashboard for directory, content, citations, and sources
- **QA sibling Skill**: `inference-delivery-qa` audits inference deployments, operator tuning, benchmark data, and customer delivery packages with evidence gates

## Install

```bash
hermes skills install leafsys1/ai-infra-department-wiki/skills/ai-infra-department-wiki
```

Or directly from the default branch:

```bash
hermes skills install https://raw.githubusercontent.com/leafsys1/ai-infra-department-wiki/main/skills/ai-infra-department-wiki/SKILL.md
```

The main entry point after installation is `scripts/team-wiki.js`. The runtime file set is maintained in the `SKILL.md` Support Files manifest and guarded by the installation verification test.

## Knowledge model

| Type | Captures | Must answer |
| --- | --- | --- |
| **Case** | An adaptation, optimization, incident, or delivery task | What changed, what happened, and where it applies |
| **Evidence** | Benchmark, log digest, NPU result, or acceptance artifact | Who verified it, on which environment, with which command |
| **Decision** | Technical route, selection, and tradeoffs | Why this route, what was rejected, when to revisit |
| **Pattern** | A practice reusable across projects | Conditions where it works and where it must not be copied |
| **Runbook** | An executable procedure | Whether a colleague can reproduce or roll back it |
| **Environment** | CANN, driver, image, hardware, and dependency baseline | Which environment the conclusion depends on |

An important conclusion should not be a lone Markdown file. Cases reference Evidence; customer delivery records include artifacts, execution, and acceptance evidence; Patterns become reusable Skills only after a held-out Skill gate.

## Workflow

### Create a repository and pin its tooling

```bash
node scripts/team-wiki.js init ../department-knowledge --name "AI Infra Department"
cd ../department-knowledge
node .department-tools/scripts/team-wiki.js validate . --strict
```

`init` creates records, redaction policy, CI, PR template, CODEOWNERS, and a pinned validator/schema/template toolchain under `.department-tools/`. Keep the real knowledge repository private according to your organization’s security policy.

### Submit a test or delivery outcome

```bash
node .department-tools/scripts/team-wiki.js sync .
node .department-tools/scripts/team-wiki.js capture . case CASE-2026-0007
node .department-tools/scripts/team-wiki.js capture . evidence EVD-2026-0007
# Edit drafts/, move finished records into records/, and add references
node .department-tools/scripts/team-wiki.js validate . --strict
node .department-tools/scripts/team-wiki.js publish . records/cases/inference/CASE-2026-0007.md --push
```

Each delivery or optimization record should state the objective, baseline, change, command, real environment, result, acceptance criteria, evidence location, applicability, and remaining risk. Separate static validation, NPU smoke/full, independent-environment reproduction, and customer acceptance.

### Retrieve and build

```bash
node .department-tools/scripts/team-wiki.js build .
node .department-tools/scripts/team-wiki.js overview .
node .department-tools/scripts/team-wiki.js query . 910B2C throughput --status verified
node .department-tools/scripts/team-wiki.js show . CASE-2026-0001
node .department-tools/scripts/team-wiki.js related . CASE-2026-0001
```

## AI Infra QA and delivery

For model adaptation, operator tuning, NPU reproduction, serving performance, and customer delivery reviews, use the sibling `inference-delivery-qa` Skill in this repository. It provides nine G0-G8 gates, an evidence allowlist, CSV/timing/TPOT consistency checks, a five-dimensional authenticity boundary, frozen-package hashes, and a conservative release state machine.

```bash
python3 skills/inference-delivery-qa/scripts/qa.py init --out <run>/input
python3 skills/inference-delivery-qa/scripts/qa.py audit --root <run>/evidence --input <run>/input/audit-input.json --out <run>/mechanical
```

Ingest QA results through `skills/ai-infra-department-wiki/references/inference-delivery-qa-bridge.md`: the QA package becomes an Evidence set, while the Case stores conclusions and applicability. `HOLD`, `BLOCKED`, and `PENDING_INDEPENDENT_REVIEW` must not become `verified`; customer release requires an independent authorized reviewer to approve the exact frozen package digest.

## Chinese knowledge dashboard

The dashboard ships with the Skill (`skills/ai-infra-department-wiki/assets/dashboard/index.html`), and `build` copies it to the knowledge repository's `generated/dashboard.html`, beside the `catalog.json` it renders. It is a single-file, no-build, no-server GitHub-style reading interface:

- **Overview**: totals, verified ratio, contributors, relations, and an activity heatmap
- **Knowledge directory**: browse Case, Evidence, Decision, Pattern, Runbook, and Environment
- **Reading**: titles, Markdown bodies, status, owners, model, accelerator, tags, and update time
- **Citations and sources**: relation entry points, incoming/outgoing links, and evidence paths
- **Human + agent use**: people search and read in the dashboard; agents use `query/show/related/overview` and `generated/catalog.json`
- **Local-first**: the catalog is read locally in the browser; nothing is uploaded

```bash
# 1. Generate catalog.json and dashboard.html
node .department-tools/scripts/team-wiki.js build <knowledge-repo>

# 2. Open the dashboard (over http(s) it auto-loads ./catalog.json)
xdg-open <knowledge-repo>/generated/dashboard.html
```

Opened straight from `file://`, browsers forbid reading a sibling file: click **导入 catalog.json** and pick `<knowledge-repo>/generated/catalog.json`, or serve the directory (`python3 -m http.server -d <knowledge-repo>/generated`).

## Agent interface

Agents do not depend on page DOM. They use deterministic CLI commands and machine-readable artifacts:

| Goal | Command |
| --- | --- |
| Corpus summary | `overview <repo> --json` |
| Search | `query <repo> <terms...> --json` |
| Read one record | `show <repo> <id>` |
| Follow relations | `related <repo> <id>` |
| Sync changes | `sync <repo>` |
| Validate and build | `validate <repo> --strict`, `build <repo>` |

## Quality gates

```bash
npm run verify:skill-install
node --test tests/js/*.test.js
node workbench/scripts/check-repository-privacy.mjs
```

Customer-delivery knowledge follows a strict evidence bar: never overstate verification scope; do not describe reused local weights as on-site automatic download; do not turn static validator PASS into real NPU PASS; and keep internal host IDs, IPs, retries, and debugging details out of customer-facing material.

## License

MIT
