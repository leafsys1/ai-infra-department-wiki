# WikiSkill Paper Comparison And Integration

## Different Problems

Karpathy-style `llm-wiki` compiles external sources and conversations into a persistent, cross-linked
knowledge base. Its primary outcome is better retrieval, synthesis, and navigation.

Google Research WikiSkill compiles an agent's graded execution experience into patterns, proposes
executable Skill changes, and accepts them only when held-out validation strictly improves. Its
primary outcome is evidence-gated procedural Skill evolution.

They are complementary, not competing implementations.

## Scope Of The Integration

No code from the reviewed reproduction is vendored here. What is integrated is the **mechanism set**,
reimplemented dependency-free so it can run inside the department CLI:

| WikiSkill mechanism | Here |
|---|---|
| Successful and failed trajectories both feed the wiki | Cases keep failure conditions and counterexamples; rejected Skill proposals are retained |
| Pattern extraction separate from Skill content | `pattern` records vs `skill-impact/<PROPOSAL>.json` |
| One atomic create/patch/no-action proposal | Outside the scope of the knowledge repository; proposals are recorded, not generated |
| Held-out gating with strict improvement | `gate` — same rule, plus an explicit resolution floor (below) |
| Paired repeated-run comparison, exact binomial | `paired_exact_binomial_p` and per-task paired outcomes in the gate report |
| Rejected proposals retained with full history | `skill-impact/` history |
| Rollback of the Skill layer, never the wiki | Not merged: no automatic Skill mutation in a shared repository |

## Verified Reference Implementation

The reviewed `ashutoshsinghpr7/wikiskill` repository is a third-party reproduction, not a Google
Research release. It implements:

- immutable task traces;
- successful/failed trajectory comparison;
- a persistent pattern wiki;
- an atomic create/patch/no-action Skill proposal;
- isolated agent profiles and fresh task sandboxes;
- train/validation task separation;
- strict `candidate_score > best_score` acceptance;
- Skill rollback with retained wiki and rejected proposal history;
- paired repeated-run comparison with an exact-binomial statistic.

Its own published live runs currently report rejected or no-action proposals, not a positive accepted
Skill. The mechanism is implemented and tested; automatic improvement is not guaranteed.

The reproduction also differs materially from the paper: it has train/validation but no final test
split, discovers Skills through backend-specific directories instead of direct full injection, does
not enforce the paper's per-trace hard character cap, and its raw trace layer can be overwritten or
reset. Repeated validation can therefore overfit the held-out set. Treat its results as engineering
evidence for the loop, not a reproduction of the paper's five-benchmark experimental claims.

## Where This Integration Diverges: The Resolution Floor

The paper's rule is `R_val > R_best`. Applied literally to a small held-out set, one flipped task
accepts a candidate — and the paired test reports `p = 1` while doing so. The arithmetic is correct;
the conclusion is not. A gate that cannot distinguish "better" from "noisy" must say so instead of
declaring a win.

So `gate` keeps strict improvement as the first mechanical filter and adds:

- an exact two-sided sign test on the discordant pairs (`alpha`, default 0.05);
- the number of discordant pairs significance requires at this alpha (`ceil(log2(2/alpha))` — six);
- the smallest score delta the task set could ever have resolved, reported as
  `minimum_detectable_effect`;
- an optional minimum effect of interest and an extra bar on discordant pairs;
- critical tasks that must not regress, checked before any average.

Verdicts are therefore: `accepted_strict_improvement`, `rejected_critical_regression`,
`rejected_regression`, `rejected_no_strict_improvement`, and `rejected_not_enough_resolution`. The last
one exists so "we could not tell" is never reported as "there is no benefit".

## Merged Into Department Mode Now

1. Preserve successful and failed engineering cases, not only successful recipes.
2. Promote repeated Case findings into Pattern records with applicability boundaries.
3. Keep every proposal ID and its full per-task gate outcome in `skill-impact/`; store candidate
   content or diff in the reviewed change itself.
4. Require identical held-out tasks for baseline and candidate.
5. Use strict score improvement only as the first mechanical filter; record per-task paired outcomes,
   an exact-binomial diagnostic, required discordance, and the MDE.
6. Keep candidate generation separate from acceptance.
7. Report resolution honestly, so a null result from an underpowered run is labelled as such.

## Deliberately Not Merged

- No automatic `git reset --hard` in the department repository.
- No automatic modification or publication of the official department Skill.
- No raw reasoning trace upload to the shared knowledge repository.
- No claim that a single higher mean proves improvement.
- No unattended evolution until the department has representative, auto-gradable held-out task packs
  and resource/safety isolation.

## Future Upgrade

Create domain-specific task packs for deployment validation, log diagnosis, benchmark interpretation,
desensitization, and documentation quality. Separate train, validation, and final test tasks.
Candidate Skills should run in isolated workspaces against fixed task versions. Require repeated A/B
runs, a minimum useful effect, zero regressions on critical tasks, and accuracy, cost, latency,
security, and applicability checks before a human reviewer promotes the candidate. The final test set
is release-only and must not guide proposal iteration.

Do not copy the reproduction's execution boundary into production: it can execute candidate Python
graders, copy credentials into isolated profiles, lacks a robust cross-process lock, and has
path-validation and ignored-Git-error risks. Department evolution should generate a candidate branch
or PR only, use no production credentials, validate every path, serialize state atomically, and fail
loudly on every Git operation.
