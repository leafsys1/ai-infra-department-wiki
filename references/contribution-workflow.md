# Department Contribution Workflow

## Separate Skill And Knowledge Repositories

The Skill repository defines how agents work. The private knowledge repository stores reviewed
records. Never clone the knowledge repository inside the installed Skill directory: the two have
different audiences, different review rules and different lifetimes.

## Sync

`node .department-tools/scripts/team-wiki.js sync <knowledge-repo>` fast-forwards the clone, rebuilds
local artifacts, and lists the record files that changed since your previous HEAD, followed by the
corpus summary. Run it before starting work so you build on what exists instead of re-deriving it.

`pull` is the same fast-forward without the change report. Both require a clean worktree and never
stash, reset, or resolve conflicts.

## Capture

`capture` creates a draft in the ignored local `drafts/` directory from the department template.
Fill unknown facts as `unknown`; never guess model, hardware, framework, topology, benchmark, or
validation data. A draft stays out of `records/` until a human moves the finished record there —
nothing under `drafts/` is visible to anyone else.

## Validate

Run `validate` before moving a record into `records/` and again before publishing. It enforces the
schemas, the required engineering boundary for a `verified` case, evidence hashes and locators,
resolvable cross-references, and the redaction policy. `--strict` promotes warnings to failures, which
is what CI uses.

A clean mechanical check is not a review: the scanner cannot recognise a customer name nobody listed.

## Compile And Query

`build` regenerates the local index, catalog, overview and graph. Query the index before writing a new
record, so a second record about the same mechanism becomes a `supports` relation instead of a
duplicate.

## Publish A Record Set

```
publish <repo> <record...> [--push] [--dry-run] [--only] [--allow-warnings] [--message "<text>"]
```

A contribution is a **record set**, not a single file. Publishing one file at a time could not express
the most ordinary contribution there is — a case plus the evidence it cites — and the guard rejected
the second file as unrelated, which pushed contributors into committing to the default branch by hand.
Now:

- The set is the records you name **plus** the records they reference (evidence, relations,
  supersedes) that are not already on the base branch. `--only` disables that expansion.
- Anything changed outside the set is refused, so an unrelated in-flight edit is never swept into the
  branch. This is the same guarantee as before, now stated in terms of the set.
- Records that are `draft`, `rejected`, or `local-only` are refused outright.
- The committed tree — not the working tree — is materialised in a temporary worktree and revalidated.
  If the branch would not validate on its own, the commit is rolled back and the branch deleted, so a
  pushed branch is never knowingly broken.
- Push is explicit (`--push`) and the remote commit is read back and compared with the local commit;
  a mismatch fails loudly.
- The command prints the pull-request compare link. It never creates, approves or merges a PR, and
  never force-pushes.

`--dry-run` prints the branch name, the resolved record set, the reason each record is included, and
the commit message, without touching Git. Use it when a contribution spans several records.

## Review And Merge

Open the pull request the command prints. CI runs `validate --strict`, `build` and `overview`. Review
against `review-policy.md`, then merge. Prefer squash merges so the default branch reads as a
sequence of reviewed records.

## Correction

Prefer deprecation and supersession to deletion. Removing reviewed history requires an owner decision
and an auditable reason. A credential that was committed must be revoked: deleting the file leaves the
Git history intact.
