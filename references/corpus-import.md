# Importing An Existing Corpus

A department does not start from an empty repository. It starts from a colleague's archived experiment
logs, a tuning round index, a delivery workspace, or a folder of reports. Importing that material is
where a knowledge base either becomes trustworthy or becomes a pile of plausible-looking prose.

## The One Rule

**One record per mechanism, not one record per document.**

A 60-round tuning index is not 60 records and it is not one record either. A round that changed one
mechanism (a weight layout, a scheduling order, a cache key) and produced one verdict becomes one case.
Several rounds that tried the same mechanism family and failed become **one pattern** with several
supporting cases, not N near-duplicate cases.

Before importing, answer for each candidate: *if a colleague reads only this record, can they avoid
repeating the work?* If not, it is a log line, not a record.

## Admission Test

Import a finding only when all of these hold:

| Test | Why it fails otherwise |
|---|---|
| It names a mechanism, not a topic | "镜像问题" is a topic; "同名 tag 不是同一构建" is a mechanism |
| It carries the numbers, with their measurement conditions | A benefit claim without a noise floor cannot be judged |
| Its boundary is stated | A result quoted outside its workload is a future wrong decision |
| A reader can check it | Evidence with an exact locator and a hash, or a controlled pointer |
| It is not already covered | Run `query` first; a second record for one mechanism is noise |

Reject — do not "lightly record" — anything that only restates a runbook step, a task status, a
one-off path or port, or a conclusion nobody observed.

## Evidence Binding For Imported Material

The upstream source usually lives somewhere the reader cannot reach: a private repository, an internal
archive, a colleague's machine. Freeze the smallest thing that lets the reader check the claim:

1. Create `artifacts/<date>-<slug>/excerpt.md` — a **minimal excerpt**, quoted verbatim from the source.
   Deleting is allowed; rewriting, rounding, or converting units is not.
2. Put a header on it: source repository, branch, commit, source path, and the source file's sha256.
3. The evidence record's `source_sha256` is the sha256 of **the excerpt file itself**, and its `locator`
   is `artifacts/<date>-<slug>/excerpt.md#<section>`.
4. The record body's *Controlled Source Location* names the upstream source and states plainly which
   part is frozen here and which part is only a pointer.

Frozen artifacts are immutable. When the source grows or a check is re-run, add a **new** artifact and a
**new** evidence record; never edit the old one.

## Status Conventions

- A case stays `observed` until somebody re-runs it in this repository. Quoting an archived experiment
  faithfully is not a re-run.
- Evidence can be `verified` while its case stays `observed`: the evidence claims only that the excerpt
  faithfully represents the source, which is mechanical and checkable.
- Never promote a record to `verified` to make the dashboard look better. The lifecycle exists so a
  reader can tell "we checked this" from "we read this once".

## Run The Corpus Gate

`team-wiki validate` checks the record contract. It cannot see the two failures that bulk import
actually produces, so run the gate before committing:

```bash
python3 scripts/audit-corpus.py <repo> --strict
```

It checks that every evidence hash still matches its artifact, that every number a case quotes appears
in that case's own excerpt, that records **and artifacts** carry no address/host id/home path (validate
scans records only — artifacts are where imports leak), and that a pattern's prose names the same cases
its relations point at.

## Review Checklist For Imported Records

- [ ] One mechanism per record; the title states the conclusion, not the topic.
- [ ] Numbers appear in the frozen excerpt; the excerpt's header pins the upstream commit.
- [ ] The record says what was **not** covered, in the source's own terms (`UNVERIFIED`, "未覆盖").
- [ ] Status reflects what was re-run here, not how convincing the upstream report was.
- [ ] No internal host id, address, port, home path, container name, or credential — in the record
      **or** in the artifact.
- [ ] `validate --strict` and `audit-corpus.py --strict` both pass.
