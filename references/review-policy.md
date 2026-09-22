# Knowledge Review Policy

## Review Questions

1. Is the environment and version boundary complete?
2. Is every important claim tied to evidence with an exact locator?
3. Were intentional variables separated from uncontrolled factors?
4. Does the status match the amount of validation?
5. Are counterexamples and failure conditions recorded?
6. Has sensitive information been removed rather than merely relabeled?
7. Does an existing record already cover the same mechanism?
8. Is the conclusion reproducible by someone who was not there?

A record that answers 1–7 but not 8 is a note, not knowledge.

## What The Tooling Has Already Checked

Do not re-litigate these in review; they either passed CI or the pull request is red:

- schema shape, required fields, id/filename/type/directory agreement,
- the required engineering context of a `verified` case (workload, model family and version,
  framework and version, accelerator),
- at least two repetitions and a `conclusion_level` before `verified`,
- evidence existence with a 64-hex source hash and a locator, plus `verified_by`/`verified_at`,
- resolvable `evidence`, `relations`, `supersedes`, `superseded_by` targets,
- the redaction policy in strict mode (blockers and warnings both fail).

Review the things no scanner can: whether the evidence actually supports the conclusion, whether the
controlled variables were really controlled, whether the applicability boundary is honest, and whether
this should have been a `supports` relation on an existing record instead of a new one.

## Ownership

Use repository branch protection and CODEOWNERS for inference, training, communication, deployment,
patterns, runbooks, schemas, and tools. The default branch should reject direct pushes, force pushes,
unresolved review threads, and failing knowledge gates. `init` writes a CODEOWNERS skeleton and CI
workflow; branch protection itself is a one-time repository setting (see
`knowledge-repo-governance.md`).

## Deletion And Correction

Prefer deprecation and supersession to deletion. Removing reviewed history requires an owner decision
and an auditable reason. Credentials accidentally committed must be revoked; deleting the current file
is not sufficient because Git history persists.

## Reviewing A Skill Candidate

A Skill candidate is gated on held-out tasks, and the gate reports what the task set could detect:

- A candidate is accepted only when it strictly improves, the improvement is at least the configured
  minimum effect, and the paired evidence clears the significance floor.
- Below the floor the verdict is `rejected_not_enough_resolution`, **not** "no benefit". The report
  states how many discordant pairs were observed, how many the task set would have required, and the
  smallest delta it could ever have resolved (the MDE). "We could not tell" and "there is no effect"
  are different statements and must not be conflated. An MDE above 1 means the task set cannot resolve
  any improvement at all — the task pack is too small to be worth running, and that is a finding about
  the pack, not about the candidate.
- Any regression on a designated critical task rejects the candidate regardless of the average.
- Rejected proposals are retained with their full per-task outcome in `skill-impact/`, because a
  rejected proposal is evidence about the domain.
