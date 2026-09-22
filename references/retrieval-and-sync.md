# Retrieval And Sync

Knowledge that cannot be found is not knowledge. This document defines what the retrieval layer
promises, so an agent can rely on it instead of reading every record.

## Index Contract

`build` writes four artifacts under `generated/` (local-only, never committed, never an authority):

| File | Purpose |
|---|---|
| `catalog.json` | Machine-readable index: one entry per record with id, type, title, status, visibility, owners, areas, tags, evidence ids, relation targets, dates, engineering context, and a token set. |
| `index.md` | The same entries as a browsable list, each line carrying status, area, owner, model, accelerator and update date, so grepping the index answers "is there anything about X?" without opening records. |
| `overview.md` | Corpus aggregates by type, status, area, owner, model family, accelerator and tag. |
| `graph-data.json` | Nodes and explicit relation edges. |

Generated files are excluded from Git on purpose: they are derived, they are rebuilt on every pull,
and a stale committed index would be read as fact. Sources are the records.

Determinism is a test, not a hope: identical records produce byte-identical artifacts, because every
collection is sorted and no timestamp is embedded (`health-report.json` writes `generated_at: null`).

## Query Semantics

`team-wiki query <repo> [terms...] [filters]`

- Terms are **ANDed** by default; `--any` switches to OR. A wiki query that returns everything is
  worse than no query.
- Matching is field-weighted: id (40), title (24), tags (18), model family (16), areas (14),
  accelerator (14), owners (8), framework (9), workload/precision/evidence/relation targets (5–7),
  then a low-weight fallback into the record body (3).
- Tokens are ASCII words (keeping `deepseek-v4`, `910b2c`, `tp8`) plus overlapping bigrams for CJK
  runs, which is what makes Chinese queries work without a segmenter.
- Every hit reports **why** it matched (`title:prefill, tags:throughput`), so a reviewer can tell a
  real hit from an accident of substring matching.
- Filters: `--type --status --visibility --area --owner --tag --model --framework --accelerator
  --since <YYYY-MM-DD> --limit <n>`.
- A term found only in the prose still matches, at lower weight and labelled `text:<token>`.

Exit code is 0 even with zero hits; "no matching record" is a result, not an error.

## Reading Neighbours

`team-wiki related <repo> <id>` returns both directions of the graph — outgoing references and
incoming ones ("what cites this?"). A dangling reference is reported as such rather than hidden,
because a broken link is a finding.

`team-wiki show <repo> <id>` resolves an id to its path and prints the record, so an agent never has
to guess the directory layout.

## Sync: What Arrived Since Last Time

`team-wiki sync <repo>` fast-forwards the clone, rebuilds artifacts, and reports what is **new to
you**: on the first sync from this clone it lists the whole corpus, afterwards it lists the record
files that changed since the HEAD you last synced (tracked in the gitignored `.wiki-cache.json`
marker). Working from the Git diff rather than the `updated` field means a correction to an old
record also shows up, even though it kept its original date.

It then prints the corpus summary: record count, verified ratio, pending review, newest update. That
one command answers both "what is new for me?" and "how much does the department know?".

`sync` never stashes, never merges, never resolves conflicts. A dirty worktree is refused.

## Freshness And Staleness

There is no TTL and no expiry: a record states the version boundary it was measured in, and a later
environment is expected to `supersede` it. What the tooling does provide:

- `overview` reports newest/oldest updates so a corpus quietly going stale is visible.
- `query --since` and `sync` surface recent work.
- `supersedes` / `superseded_by` record replacement explicitly, so a reader can see that a conclusion
  was replaced instead of finding two contradictory records with no ordering.

## What Retrieval Does Not Do

- No embeddings, no vector store, no model call: retrieval runs offline in CI and on a laptop.
- No ranking by popularity. Score reflects term match, then recency, then id — never who wrote it.
- `generated/` is never an authority for a review decision. Review the record.
