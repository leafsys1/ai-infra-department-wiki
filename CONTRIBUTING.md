# Contributing To The AI Infra Department Wiki Skill

## Repository Boundaries

- The public fork is for generic Skill code and documentation only.
- Department records belong in a separate private knowledge repository.
- Do not commit customer data, credentials, private addresses, raw logs, model weights, or local absolute paths.

## Development

```bash
node --test tests/js/department-skill-package.test.js tests/js/team-wiki.test.js tests/js/skill-gate.test.js
bash install.sh --dry-run --platform hermes
npm run quality-and-tests
```

The repository uses Node's built-in test runner for the Skill additions. Do not add a runtime dependency for the MVP.

## Change Rules

- Add a failing behavior test before a new workflow or gate rule.
- Keep the self-contained `skills/ai-infra-department-wiki/` package and root compatibility files synchronized.
- Generated knowledge artifacts are local and must not be used as source records.
- Skill candidates require fixed held-out tasks, paired outcomes, and a human review before promotion.
- Do not force-push or rewrite shared history.
- Use a feature branch. The default delivery is a pushed branch; PR creation and merge require explicit authorization.

## Commit Categories

Use conventional prefixes: `feat`, `fix`, `test`, `docs`, `ci`, `refactor`.
