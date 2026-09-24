# AI Infra 部门知识库

Private repository of reviewed, desensitized AI Infra knowledge records. This is the shared half of the department wiki; the personal `llm-wiki` vault stays local.

## Record types

| Type | Directory | Use it for |
|---|---|---|
| case | `records/cases/<area>/` | One measured engineering finding: goal, baseline, changed variable, controlled variables, results, conclusion, applicability. |
| evidence | `records/evidence/` | The pointer to raw data: source hash, exact locator, who verified it and when. Records reference evidence, never the other way round. |
| decision | `records/decisions/` | A choice with alternatives and consequences. |
| pattern | `records/patterns/` | A mechanism that repeated across cases, with its applicability boundary and counterexamples. |
| runbook | `records/runbooks/` | The steps to repeat an operational procedure. |
| environment | `records/environments/` | A named hardware/software configuration other records cite. |

## Areas under `records/cases/`

`inference/`, `training/`, `communication/`, `deployment/`, `incidents/`.

Do not put a plain markdown file under `records/`: everything matching `records/**/*.md` is parsed as a record and will fail validation without frontmatter.

## Record status conventions

The lifecycle is `draft -> proposed -> observed -> verified -> replicated`. Two conventions keep the
status honest when records are imported from an existing corpus rather than produced in this repository:

- **A case is `observed` until somebody re-runs it here.** Quoting an archived experiment faithfully —
  even with the numbers traced back to its source — is not a re-run. Only raise a case to `verified`
  after its workload, framework version, accelerator, repetitions and conclusion level are known *and*
  the finding has been reproduced or reviewed in the department.
- **Evidence can be `verified` while its case stays `observed`.** An evidence record claims only that
  the excerpt faithfully represents the source: its `source_sha256` matches the frozen artifact and the
  numbers quoted in the case appear in that artifact. That binding is mechanical and can be checked;
  it says nothing about whether the engineering conclusion holds.

Frozen excerpts under `artifacts/<date>-<slug>/` are immutable: when the source grows or a check is
re-run, add a new artifact and a new evidence record rather than editing the old one.

## Start here

```
node .department-tools/scripts/team-wiki.js overview .        # the corpus at a glance
node .department-tools/scripts/team-wiki.js query . <terms>   # find a record
node .department-tools/scripts/team-wiki.js --help
```

See `CONTRIBUTING.md` for the review rules and the pull-request flow.
