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

## From A Working Session To A Record

The session is where the evidence is; the record is what survives it. One record per **mechanism**,
not per session — a session that fixed three unrelated things produces three records or none.

### Capture when, skip when

Capture a session when it produced something a colleague would otherwise re-derive: a failure mode
with its trigger, a probe that misleads, a decision with its trade-off, an acceptance criterion, an
environment constraint that a conclusion depends on.

Skip it when the session only executed an existing runbook (unless the runbook turned out to be
wrong), when the content is task status ("pushed the branch"), when it is a one-off value (a path, a
port, a credential), or when the session did not actually observe the thing — an assumption is not a
record. **Query before writing** (`query <repo> <terms>`): a second record about the same mechanism
becomes a `supports`/`refutes` relation, not a duplicate.

### Pick the type by what you learned, not by what you did

| What you learned | Type |
| --- | --- |
| Something happened, with a before and an after | `case` (+ the evidence it cites) |
| A measurement or command output you can point at | `evidence` |
| A choice, its reason, and what it gave up | `decision` |
| A rule that held in more than one situation | `pattern` |
| Steps someone else must execute or roll back | `runbook` |
| A constraint the conclusion depends on | `environment` |

### Title and summary carry the record

- **Title** is the conclusion as a claim, not a topic: "同名镜像 tag 不等于同一构建" rather than
  "镜像问题". A reader scanning the list should get the finding, not the subject area.
- **Summary** is one sentence: the takeaway that lets a reader decide whether to open the record. No
  new facts, no number that is not in the body.
- Never leave `summary` empty. The catalog falls back to a body excerpt, so the card renders heading
  soup (`Title Goal Baseline …`) instead of the conclusion — that is the single most common reason a
  knowledge list reads as noise.
- Fill `areas` and `tags`. They drive the facets, the card meta line and search; an empty pair makes
  the record findable only by title.

### Keep the causal chain reconstructible

The template sections are the causal skeleton, and they exist to be filled in this order:

`Baseline` (what was true) → `Changed Variable` (what changed) → `Procedure` (what you ran) →
`Results` (what was observed) → `Conclusion` (what follows) — with `Preconditions` /
`When Not To Apply` / `Applicability And Risks` marking where the claim stops holding.

A reader who did not run the session must be able to reconstruct that chain without it. So:

- State the environment and the command next to every number; a number without its measurement is
  not evidence.
- Write the boundary, not just the win: what would falsify the claim, and when the pattern does not
  apply.
- Keep one mechanism per record. If the record needs "and also", it is two records.
- `unknown` beats a plausible guess, every time.

### Bind evidence to something frozen

An evidence record binds a generated artifact by `source_sha256` + `locator`. Generate that artifact
with a script that refuses to overwrite an existing log, then update the hash in the same change.
Never bind a live query, a dashboard, or a log whose bytes change between runs: the binding breaks
silently and the claim loses its evidence.

### Readability gate, before you publish

Ask of the finished record:

1. Can a colleague state, after one read, what was true before, what changed, what was observed, and
   what to do differently?
2. Do title + summary + areas + tags decide relevance without opening the record?
3. Does every claim either cite evidence in this repository or say plainly that it is not yet
   verified (`observed`, not `verified`)?
4. Does the record say where it stops applying?
5. Is it about one mechanism?

Any "no" is an edit, not a footnote. A mechanically valid record that fails these is still a bad
record — `validate` cannot see the difference.

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
