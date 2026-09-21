# Department Contribution Workflow

## Separate Skill And Knowledge Repositories

The Skill repository defines how agents work. The private knowledge repository stores reviewed records. Never clone the knowledge repository inside the installed Skill directory.

## Pull

`node scripts/team-wiki.js pull <knowledge-repo>` requires a clean worktree, fetches and fast-forwards only, then rebuilds local generated artifacts. It never stashes, resolves conflicts, or overwrites local work.

## Capture

Capture creates a draft in the ignored local `drafts/` directory. Complete context, evidence, and applicability before copying the record under `records/`.

## Validate

Validation blocks missing required fields, invalid IDs/status, missing evidence/relation targets, weak verified claims, credentials, personal paths, and private addresses. A clean mechanical check does not replace domain review.

## Publish

Publish requires a clean, valid repository and creates a contribution branch. Push is explicit. The MVP does not create, approve, merge, or delete pull requests automatically.

## Compile

Index, graph data, health reports, and skill-impact reports are generated artifacts. Humans edit source records, not generated files.
