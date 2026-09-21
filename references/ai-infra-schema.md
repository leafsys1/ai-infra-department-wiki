# AI Infra Department Knowledge Schema

The department mode stores reviewed engineering knowledge as records, not as a shared personal vault.

## Record Layers

- `case`: one inference, training, communication, deployment, or incident investigation.
- `evidence`: desensitized evidence with source hash and exact locator.
- `decision`: a conclusion and its supporting/counter evidence.
- `pattern`: a transferable problem, root cause, action, and applicability boundary.
- `runbook`: an executable operational procedure with expected output and rollback.
- `environment`: reusable hardware/software/topology context.

## Required Engineering Boundary

A case must identify workload, model family/version, framework/version, accelerator, validation repetitions, and evidence before it can be `verified` or `replicated`. Unknown facts must be written as `unknown`; the agent must not infer them.

`EXTRACTED` or `INFERRED` describes source provenance. It does not mean an engineering claim is verified. Verification status is governed by the record `status`, validation fields, evidence, and review.

## Lifecycle

`draft -> proposed -> observed -> verified -> replicated`

A record may instead become `rejected` or `deprecated`. Reviewed history is append-oriented: use `supports`, `refutes`, `supersedes`, and `superseded_by` rather than silently rewriting earlier conclusions.

## Visibility

- `shareable`: approved for external derivation after final review.
- `internal`: department-only.
- `restricted`: keep in a separate access-controlled repository.
- `local-only`: never publish and never send to an external model automatically.

Git does not provide per-directory confidentiality. A frontmatter label does not make restricted data safe in a broadly readable repository.
