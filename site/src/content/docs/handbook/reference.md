---
title: Reference
description: Envelope shape, CLI contract, exit codes, environment variables.
sidebar:
  order: 3
---

This page summarizes the public contracts. For the full canonical specifications, see [`docs/envelope-spec.md`](https://github.com/mcp-tool-shop-org/rig-bridge/blob/main/docs/envelope-spec.md) and [`docs/cli-contract.md`](https://github.com/mcp-tool-shop-org/rig-bridge/blob/main/docs/cli-contract.md) in the repo.

## Envelope frontmatter

Every rig-bridge envelope is YAML frontmatter + a markdown body. Frontmatter is validated against [`schemas/bridge-message.schema.json`](https://github.com/mcp-tool-shop-org/rig-bridge/blob/main/schemas/bridge-message.schema.json) (JSON Schema 2020-12).

```yaml
---
from: mac-m5max              # canonical kebab-case rig id (REQUIRED)
to: windows-5080             # string OR array of rig-ids (REQUIRED)
date: 2026-05-15             # ISO 8601 date or full timestamp (REQUIRED)
status: "▶ Working on X"      # marker + free prose (REQUIRED). Markers: ▶ ⏸ 🎯 ✅ ❌
type: HANDOFF                # REQUEST | HANDOFF | RESPONSE | ACK | RESOLUTION
                             # STATE | RESULT | RECOVERY | VERIFY | DECISIONS  (REQUIRED)
thread: bridge-onboarding-01  # kebab-case thread id (REQUIRED)
display_name: "Mac Claude"   # optional, max 80 chars
tldr: "first contact"        # optional, soft 280-char cap
references:                  # optional, commit SHAs of prior turns
  - a1b2c3d
body_hash: <sha256-hex>      # auto-populated by send/close; required for relay
# Relay-only fields:
attested_by: <signing-key-id>
attested_at: 2026-05-15T10:30:00Z
nonce: <ULID-like>
in_reply_to: <prior-body-hash>
---

<markdown body>
```

### §4.1 body normalization

`body_hash` is SHA-256 over the body after these four rules, applied in order:

1. **CRLF/CR → LF** — line endings normalized to LF.
2. **Trim trailing whitespace per line** — spaces and tabs at end of any line removed.
3. **Exactly one terminal newline** — body ends with exactly one `\n`.
4. **BOM strip** — leading `﻿` removed.

The normalization is implemented once in `src/engine/body-hash.ts` and consumed everywhere (`parseEnvelope`, `renderEnvelope`, `bodyHash`).

### §4.2 status_class derivation

| Marker | status_class |
|--------|--------------|
| ▶ | `active` |
| ⏸ | `pending` |
| 🎯 | `targeted` |
| ✅ | `completed` |
| ❌ | `cancelled` |

The control-plane (v1.1) derives a closed-enum `status_class` from the marker; the envelope itself carries open verb-prose status.

## CLI contract

### stdout = data, stderr = narrative

- **stdout** carries one machine-parseable line (or one JSON object with `--json`) per command.
- **stderr** carries human narrative: progress, hints, error context, the DEBUG trace when `DEBUG_RIG_BRIDGE` is truthy.
- Color (ANSI) appears only when isatty(stdout) AND `NO_COLOR` is unset AND `--no-color` is not passed AND `--json` is not used.

### `--json` stability contract

Every JSON object includes `schema_version: "1.0"` (kubectl-style explicit version). Field additions are backward-compatible; field removals or type changes require a `schema_version` bump.

| Command | stdout (text) | stdout (--json top-level fields) |
|---------|---------------|----------------------------------|
| `init` | `rig-bridge: init OK rig-id=<id> root=<repo>` | `schema_version, op, rig_id, root, display_name?` |
| `new` | `rig-bridge: scaffolded type=REQUEST thread=<id> file=<path>` | `schema_version, op, thread_id, file_path` |
| `send` | `rig-bridge: sent type=<T> thread=<id> file=<path> commit=<sha7>` | `schema_version, op, type, thread_id, file_path, commit_sha, body_hash` |
| `close` | `rig-bridge: closed type=RESOLUTION thread=<id> status=<class> commit=<sha7>` | `schema_version, op, thread_id, status, commit_sha, body_hash` |
| `status` | header + N `thread=<id> ...` rows | `schema_version, threads[], dirty_files[], unpushed_commits[]` |
| `thread` | per-envelope blocks | `schema_version, thread_id, envelope_count, envelopes[]` |
| `sync` | `rig-bridge: sync pulled=<b> fast_forward=<b> new_envelopes=<N>` | `schema_version, pulled, fast_forward_eligible, diverged, new_envelopes, divergence_report?` |
| `relay` | `rig-bridge: relayed type=<T> thread=<id> file=<path> attested_by=<key> nonce=<n> commit=<sha7>` | `schema_version, op, type, thread_id, file_path, commit_sha, attestation{ attested_by, attested_at, nonce }` |

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success. |
| `1` | User error — invalid flag, missing required input, invalid rig-id, missing signing key on relay, etc. |
| `2` | Reserved for runtime errors (sparse use today; will tighten in v1.1). |
| `130` | SIGINT (`Ctrl-C`). Stderr emits `rig-bridge: interrupted (SIGINT). To check for orphaned envelopes: cd <root>; git status`. |
| `143` | SIGTERM. |

## Environment variables

| Variable | Effect |
|----------|--------|
| `DEBUG_RIG_BRIDGE` | Truthy (`1`, `true`, `yes`, `on`) emits a startup trace + diagnostic logs to stderr. Falsy (`0`, `false`, `no`, `off`, empty) silent. |
| `NO_COLOR` | Presence (any value) suppresses ANSI color in all output. |
| `RIG_BRIDGE_NO_PAGER` | Truthy (`1`) disables auto-paging in `status` and `thread`. |
| `PAGER` | Pager command (default `less -FIRX`-style). Honored by `status` and `thread`. |

## Versioning

This contract applies to `@mcptoolshop/rig-bridge` v1.0.0+.

- **Breaking changes** to stdout shape, exit codes, or `--json` schema bump the **major** version.
- **Additive changes** (new commands, new flags, new optional JSON fields) are **minor**-version compatible.
- The `schema_version` field on JSON output is the pinned contract — bumping it signals consumers to re-check their parsers.
