# WikiSkill Paper Comparison And Integration

## Different Problems

Karpathy-style `llm-wiki` compiles external sources and conversations into a persistent, cross-linked knowledge base. Its primary outcome is better retrieval, synthesis, and navigation.

Google Research WikiSkill compiles an agent's graded execution experience into patterns, proposes executable Skill changes, and accepts them only when held-out validation strictly improves. Its primary outcome is evidence-gated procedural Skill evolution.

They are complementary, not competing implementations.

## Verified Reference Implementation

The reviewed `ashutoshsinghpr7/wikiskill` repository is a third-party reproduction, not a Google Research release. It implements:

- immutable task traces;
- successful/failed trajectory comparison;
- a persistent pattern wiki;
- an atomic create/patch/no-action Skill proposal;
- isolated agent profiles and fresh task sandboxes;
- train/validation task separation;
- strict `candidate_score > best_score` acceptance;
- Skill rollback with retained wiki and rejected proposal history;
- paired repeated-run comparison with an exact-binomial statistic.

Its own published live runs currently report rejected or no-action proposals, not a positive accepted Skill. The mechanism is implemented and tested; automatic improvement is not guaranteed.

The reproduction also differs materially from the paper: it has train/validation but no final test split, discovers Skills through backend-specific directories instead of direct full injection, does not enforce the paper's per-trace hard character cap, and its raw trace layer can be overwritten or reset. Repeated validation can therefore overfit the held-out set. Treat its results as engineering evidence for the loop, not a reproduction of the paper's five-benchmark experimental claims.

## Merged Into Department Mode Now

1. Preserve successful and failed engineering cases, not only successful recipes.
2. Promote repeated Case findings into Pattern records with applicability boundaries.
3. Keep every proposal ID and its full per-task gate outcome in `skill-impact/`; store candidate content or diff in the reviewed change itself.
4. Require identical held-out tasks for baseline and candidate.
5. Use strict score improvement only as the first mechanical filter; record per-task paired outcomes and an exact-binomial diagnostic.
6. Keep candidate generation separate from acceptance.

## Deliberately Not Merged

- No automatic `git reset --hard` in the department repository.
- No automatic modification or publication of the official department Skill.
- No raw reasoning trace upload to the shared knowledge repository.
- No claim that a single higher mean proves improvement.
- No unattended evolution until the department has representative, auto-gradable held-out task packs and resource/safety isolation.

## Future Upgrade

Create domain-specific task packs for deployment validation, log diagnosis, benchmark interpretation, desensitization, and documentation quality. Separate train, validation, and final test tasks. Candidate Skills should run in isolated workspaces against fixed task versions. Require repeated A/B runs, a minimum useful effect, zero regressions on critical tasks, and accuracy, cost, latency, security, and applicability checks before a human reviewer promotes the candidate. The final test set is release-only and must not guide proposal iteration.

Do not copy the reproduction's execution boundary into production: it can execute candidate Python graders, copy credentials into isolated profiles, lacks a robust cross-process lock, and has path-validation and ignored-Git-error risks. Department evolution should generate a candidate branch or PR only, use no production credentials, validate every path, serialize state atomically, and fail loudly on every Git operation.
