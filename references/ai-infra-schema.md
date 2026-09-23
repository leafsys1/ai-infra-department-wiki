# AI Infra Department Knowledge Schema

The department mode stores reviewed engineering knowledge as records, not as a shared personal vault.

## Record Layers

- `case`: one inference, training, communication, deployment, or incident investigation.
- `evidence`: desensitized evidence with source hash and exact locator.
- `decision`: a conclusion and its supporting/counter evidence.
- `pattern`: a transferable problem, root cause, action, and applicability boundary.
- `runbook`: an executable operational procedure with expected output and rollback.
- `environment`: reusable hardware/software/topology context.

Each type has a directory under `records/` (`records/cases/<area>/` for cases) and a template under
`templates/department/`. The filename must equal the record `id`.

## Machine-Readable Contract

`scripts/schemas/record.schema.json`, `relation.schema.json` and `skill-gate.schema.json` are **enforced**, not
documentation: `validate` loads them and fails a record that violates them, and a gate report is
checked against the gate schema. The hand-written validator keeps the stable diagnostic codes for the
fields it has always covered; anything the schemas add — a new required field, a length or item count,
an item pattern, an unexpected property — is reported as a `schema` error.

Consequence for contributors: extending the contract means editing the schema, and every repository
picks the change up through `upgrade-tools` rather than through each colleague's Skill version.

## Required Engineering Boundary

A case must identify workload, model family/version, framework/version, accelerator, validation
repetitions, and evidence before it can be `verified` or `replicated`. Unknown facts must be written as
`unknown`; the agent must not infer them. A `verified` case with `visibility: local-only` is refused: a
conclusion nobody can read is not a department conclusion.

Evidence carries `source_sha256` (64 hex characters), a `locator` precise enough to find the row or
section again, and — once verified — `verified_by` and `verified_at`.

`EXTRACTED` or `INFERRED` describes source provenance. It does not mean an engineering claim is
verified. Verification status is governed by the record `status`, validation fields, evidence, and
review.

## Searchable Fields

The retrieval index reads these without opening the record, so fill them in: `summary`, `areas`,
`tags`, and the case `context` block (workload, model family, model version, framework, framework
version, accelerator model, precision), plus `owners`. `summary` is one sentence — the takeaway a
reader uses to decide whether to open the record. An empty `areas`/`tags` list makes a record
findable only by title, and an empty `summary` makes the dashboard card render a body excerpt
(heading soup) instead of a conclusion.

## Lifecycle

`draft -> proposed -> observed -> verified -> replicated`

A record may instead become `rejected` or `deprecated`. Reviewed history is append-oriented: use
`supports`, `refutes`, `supersedes`, and `superseded_by` rather than silently rewriting earlier
conclusions.

## Relations

Allowed relation types are fixed by the schema: `validated_by`, `supports`, `refutes`, `applies_to`,
`observed_in`, `caused_by`, `mitigated_by`, `implemented_by`, `supersedes`, `contradicts`. Every
target must resolve to an existing record id — CI fails a dangling reference, because a broken link is
a finding rather than a formatting issue.

## Visibility

- `shareable`: approved for external derivation after final review.
- `internal`: department-only.
- `restricted`: keep in a separate access-controlled repository.
- `local-only`: never publish and never send to an external model automatically.

Git does not provide per-directory confidentiality. A frontmatter label does not make restricted data
safe in a broadly readable repository.

## Generated Artifacts

`generated/` holds the index, catalog, overview and graph. It is gitignored, rebuilt by `build` and on
every `sync`, and is never an authority for a review decision or a claim. See
`retrieval-and-sync.md` for the index contract.
