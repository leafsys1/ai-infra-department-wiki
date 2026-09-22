# Knowledge Repository Governance

The Skill repository defines how agents work. The knowledge repository holds what the department
knows. They are separate on purpose: the Skill is public and versioned like software, the knowledge
is private and reviewed like an engineering deliverable.

## One Toolchain For Everyone

`init` vendors the validator, schemas and templates into `.department-tools/` and commits them, with
`.department-tools/TOOLS.json` recording the Skill version and a SHA-256 per file.

Why not just use whatever Skill version each colleague has installed:

- CI can validate a pull request without installing the Skill at all.
- Two colleagues on different Skill versions still validate identically.
- A validator upgrade becomes a reviewable diff (`upgrade-tools --write`) instead of an invisible
  behaviour change on someone's machine.

`upgrade-tools <repo>` reports drift between the pinned copy and the installed Skill: added,
changed and removed files. Without `--write` it changes nothing. It refuses to run from the pinned
copy itself, because a directory cannot meaningfully diff against itself.

## Continuous Integration

`init` writes `.github/workflows/knowledge-validate.yml`, which on every pull request and every push
to the default branch:

1. `validate . --strict` — schema shape, required context, evidence hashes and locators, resolvable
   cross-references, blocked redaction rules, and unresolved warnings.
2. `build .` — the index, catalog, overview and graph must rebuild.
3. `overview .` — the job log carries the corpus summary, so a reviewer sees the scale of what they
   are approving.

CI is deliberately stricter than a local `validate`: it passes `--strict`, so a warning cannot merge
silently. An intentional exception belongs in the policy file as an explicit `allow` entry, where it
is visible and reviewed.

## Branch Protection (manual, one time)

The tooling cannot set this up for you; do it once when the repository lands in the organization:

- Require a pull request before merging the default branch, with at least one approval.
- Require the knowledge validation check to pass.
- Dismiss stale approvals on new commits.
- Require linear history and forbid force pushes, so reviewed history stays auditable.
- Restrict who can push to the default branch; contributors work through `publish` branches.

## Ownership

`init` writes `.github/CODEOWNERS` with a placeholder owner per area
(`records/cases/inference/`, `records/patterns/`, and so on) plus a governance owner for the policy
file, the pinned tooling and the schemas. Replace the placeholders with real team slugs:

- area owners review the substance of a record,
- the governance owner reviews changes to the rules themselves (policy, schemas, toolchain),
- because a redaction or schema change affects every future record, not just one.

## Redaction Policy Is Shared State

`.department-redaction.json` is the department's own rule set, committed so every colleague inherits
it. Blocked matches fail CI; warnings fail CI too. Add your customer codewords, project names and
internal host identifiers there — including the machines in your own lab — so nobody has to remember
them individually.

Prefer codewords and generic nouns in shared records even when a rule allows them: the rule list is a
floor, and an agent that already desensitised the sentence cannot leak it later.

## Contribution Flow

```
pull / sync -> capture -> fill -> validate -> move under records/ -> publish --push -> pull request
```

`publish` creates a contribution branch containing the records you named plus the records they newly
reference, validates the committed tree in a temporary worktree, and refuses to leave a branch that
would not validate on its own. It never creates, approves or merges a pull request; it prints the
compare link for a human to open.

## Onboarding A Colleague

1. Install the Skill (`hermes skills tap add <owner>/<repo>` then `hermes skills install
   <owner>/<repo>/ai-infra-department-wiki`, or `bash install.sh --platform hermes`).
2. Clone the knowledge repository.
3. `node .department-tools/scripts/team-wiki.js sync .` — see what the department knows.
4. `node .department-tools/scripts/team-wiki.js query . <topic>` — find prior work before repeating it.
5. Read `CONTRIBUTING.md` in the repository; it carries the rules CI enforces.
6. Node.js 22+ is required; that is the only external dependency.

## Growth Limits To Watch

- `validate` checks the whole repository, so one broken record blocks everyone's publish until it is
  fixed. That is intentional pressure to keep the corpus valid, and it is why CI runs on every push.
- Publish is opt-in per record set and never batch-publishes unrelated work.
- The corpus is plain Git: at a few thousand records, `query` still runs offline in well under a
  second, but a very large corpus should move the body-scan fallback behind the metadata index rather
  than grow it.
