# Knowledge Review Policy

## Review Questions

1. Is the environment and version boundary complete?
2. Is every important claim tied to evidence with an exact locator?
3. Were intentional variables separated from uncontrolled factors?
4. Does the status match the amount of validation?
5. Are counterexamples and failure conditions recorded?
6. Has sensitive information been removed rather than merely relabeled?
7. Does an existing record already cover the same mechanism?

## Ownership

Use repository branch protection and CODEOWNERS for inference, training, communication, deployment, patterns, runbooks, schemas, and tools. `main` should reject direct pushes, force pushes, unresolved review threads, and failing knowledge gates.

## Deletion And Correction

Prefer deprecation and supersession to deletion. Removing reviewed history requires an owner decision and an auditable reason. Credentials accidentally committed must be revoked; deleting the current file is not sufficient because Git history persists.
