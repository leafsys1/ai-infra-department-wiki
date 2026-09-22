# Security And Redaction

## Never Publish

- Private keys, passwords, API keys, bearer tokens, or certificate material.
- Customer names, project codenames, accounts, private hostnames, addresses, or ports.
- Personal home paths and employee-specific data directories.
- Unrestricted raw logs, profiler captures, model weights, or customer documents.

Store large or restricted evidence in an approved access-controlled system. The knowledge record
contains only a minimal excerpt, `source_sha256`, exact `locator`, and controlled pointer.

## Model Provider Boundary

Local files may still be transmitted to the configured model provider during analysis.

- `shareable`: approved providers.
- `internal`: enterprise-approved account or private endpoint.
- `restricted`: local model or explicitly approved private endpoint only.
- `local-only`: no automatic remote-model processing.

The Skill must not read, copy, or record provider credentials.

## Two Severities

`validate` reports findings at two levels, and the difference matters when a rule fires:

| Severity | Behaviour | Use for |
|---|---|---|
| `block` | `validate` fails, `publish` refuses, CI fails. | Material that must never enter the repository. |
| `warn` | Reported and recorded; `validate --strict` fails and CI runs strict, so it also blocks a merge unless it is explicitly allowed. | Things that are usually fine but a human must see once. |

An `allow` entry matches the offending **text** (not the rule name). It is the auditable way to say
"this specific string is fine" — for example a published benchmark host.

## Built-in Rules

Every department gets these, because they are dangerous everywhere:

| Rule | Severity | Catches |
|---|---|---|
| `private_key` | block | PEM private key headers |
| `github_token` | block | `ghp_…` / `github_pat_…` |
| `api_key` | block | `sk-…` |
| `credential_assignment` | block | `password: …`, `token = …`, `api_key: …` with a long value |
| `personal_home` | block | A user's absolute home directory root (POSIX home or macOS user root) |
| `private_ipv4` | block | 10/8, 192.168/16, 172.16–31/12 literals |
| `public_ipv4` | warn | Any other IPv4 literal |
| `host_tag` | warn | Host tags like `S900K3-1240` |

Bare numeric host ids (`60006`) are deliberately **not** a built-in rule: in this domain a five or six
digit number is as likely to be `16384` or `65536` as a machine name, and a rule that cries wolf gets
switched off. List your own units in the policy file, where the decision is explicit and shared.

## The Department Policy File

`.department-redaction.json` lives in the knowledge repository, is committed, and is loaded on every
validation — the rules travel with the records, so a new colleague inherits them automatically.

```
{
  "schema_version": 1,
  "block": [{ "name": "customer_codename", "pattern": "acme|project-x", "flags": "i" }],
  "warn":  [{ "name": "lab_unit", "pattern": "(?<![\\w.-])(?:60006|60007)(?![\\w.-])" }],
  "allow": [{ "name": "public_benchmark_host", "pattern": "203\\.0\\.113\\.7" }],
  "disable_builtin": []
}
```

- `block` / `warn` entries take `name`, `pattern`, optional `flags`.
- `allow` entries take `name` and `pattern`, or a bare pattern string, and are matched against the
  text a rule flagged.
- `disable_builtin` lists built-in rule names to switch off. Prefer `allow` — disabling a rule
  removes the signal for the whole corpus.
- `examples` is ignored by the tool and exists so the file documents the rules teams usually need.

A malformed policy file is a hard error rather than a silent downgrade: quietly weakening redaction
is worse than refusing to validate.

## Scanner Semantics

The built-in scanner is intentionally conservative and blocks common credentials, personal paths,
and private IPv4 addresses. It is a floor, not a complete DLP system. It reads frontmatter and body
as one document, because a leak does not care which section it sits in.

What it cannot do: recognise a customer name nobody listed, judge whether an excerpt is sensitive in
context, or see the raw data behind a `locator`. Those remain domain-review responsibilities, and the
review checklist asks about them explicitly.

## If Something Leaks

Revoking the credential is the first action, not editing the file: Git history keeps the old
revision. Then treat the removal as a history rewrite with an owner decision and an auditable reason,
and record the incident as a `case` so the rule that missed it can be added.
