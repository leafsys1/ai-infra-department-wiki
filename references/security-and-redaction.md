# Security And Redaction

## Never Publish

- Private keys, passwords, API keys, bearer tokens, or certificate material.
- Customer names, project codenames, accounts, private hostnames, addresses, or ports.
- Personal home paths and employee-specific data directories.
- Unrestricted raw logs, profiler captures, model weights, or customer documents.

Store large or restricted evidence in an approved access-controlled system. The knowledge record contains only a minimal excerpt, `source_sha256`, exact `locator`, and controlled pointer.

## Model Provider Boundary

Local files may still be transmitted to the configured model provider during analysis.

- `shareable`: approved providers.
- `internal`: enterprise-approved account or private endpoint.
- `restricted`: local model or explicitly approved private endpoint only.
- `local-only`: no automatic remote-model processing.

The Skill must not read, copy, or record provider credentials.

## Scanner Semantics

The built-in scanner is intentionally conservative and blocks common credentials, personal paths, and private IPv4 addresses. It is a floor, not a complete DLP system. Department-specific customer/project terms require a private policy extension outside the public fork.
