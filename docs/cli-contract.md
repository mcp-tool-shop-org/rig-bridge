# rig-bridge CLI Contract

> **Status:** stable for `@mcptoolshop/rig-bridge` v1.0.0+. This document is the canonical pin-point for CI scripts, the v1.1 control-plane writer, and downstream tooling.

This contract specifies what callers can rely on across minor and patch releases. It is intentionally narrower than the full CLI surface — it covers the parts that downstream consumers should be able to script against without breakage.

The 8 v1.0.0 commands are: `init`, `new`, `send`, `close`, `status`, `thread`, `sync`, `relay`.

---

## §1 — Output discipline

Locked architectural lock **L14** from the Phase 7 study swarm (clig.dev canonical doctrine).

- **stdout** = data. Each command emits either a key=value line (one event) or a JSON object (one event, `--json` mode). The default human-readable text format **may evolve between minor versions** — do not parse it. For scripted consumers, use `--json`.
- **stderr** = narrative. Progress chatter, hints, errors with `--debug` traces, and any text intended for the operator's eyes. Always human-friendly. Never machine-targeted.
- **Color** (ANSI escape sequences) is emitted **only** when all three conditions hold:
  1. `isatty(stdout)` is true (output is going to a terminal, not piped or redirected)
  2. `NO_COLOR` environment variable is unset (per [no-color.org](https://no-color.org/))
  3. `--no-color` flag is not present
- Color is **never** emitted in `--json` mode, even on a TTY.

---

## §2 — `--json` stability contract

Locked architectural lock **L15** from the Phase 7 study swarm (kubectl-style explicit version, finding 27).

- `--json` is **opt-in** for every command. The default output is text.
- Every JSON object emitted under `--json` includes a top-level `"schema_version": "1.0"` field.
- **Backward-compatible changes** (minor-version safe):
  - Adding new top-level fields
  - Adding new optional fields to nested objects
  - Adding new commands or flags
- **Breaking changes** (major-version only):
  - Removing fields
  - Changing field types
  - Renaming fields
  - Changing the meaning of an existing value
- Any breaking change bumps `schema_version`. Consumers should check `schema_version === "1.0"` before parsing and tolerate (or warn on) unknown values.

---

## §3 — Per-command stdout shapes

### Text mode (default)

| Command | stdout shape |
|---------|--------------|
| `init` | `rig-bridge: init OK rig-id=<id> root=<repo-name>` |
| `new` | `rig-bridge: scaffolded type=REQUEST thread=<id> file=<thread>/REQUEST.md` |
| `send` | `rig-bridge: sent type=<TYPE> thread=<id> file=<thread>/<file> commit=<sha7>` |
| `close` | `rig-bridge: closed type=RESOLUTION thread=<id> status=<status> commit=<sha7>` |
| `status` | Header line + N data rows: `thread=<id> last=<date> status=<class> type=<type> dirty=<bool>` |
| `thread` | Header line per envelope + frontmatter + body blocks (small-multiples, chronological asc) |
| `sync` (fast-forward) | `rig-bridge: sync pulled=<bool> fast_forward=<bool> new_envelopes=<N>` |
| `sync` (diverged) | `rig-bridge: sync pulled=false diverged=true reason=<short>` |
| `relay` | `rig-bridge: relayed type=<TYPE> thread=<id> file=<thread>/<file> attested_by=<key> nonce=<ulid> commit=<sha7>` |

### JSON mode (`--json`)

All `--json` payloads include `"schema_version": "1.0"` and an `"op"` discriminator. The per-command top-level fields:

| Command | Top-level JSON fields (in addition to `schema_version`, `op`) |
|---------|--------------------------------------------------------------|
| `init` | `rig_id` (string), `root` (string) |
| `new` | `type` (string, always `"REQUEST"`), `thread_id` (string), `file` (string) |
| `send` | `type` (string), `thread_id` (string), `file` (string), `commit` (string, 7-char sha) |
| `close` | `type` (string, always `"RESOLUTION"`), `thread_id` (string), `status` (string), `commit` (string) |
| `status` | `threads` (array of `{thread_id, last, status_class, type, dirty}` objects) |
| `thread` | `thread_id` (string), `envelopes` (array of full envelope objects with frontmatter + body) |
| `sync` | `pulled` (bool), `fast_forward` (bool), `new_envelopes` (number), `diverged` (bool, only when not FF), `reason` (string, only when diverged) |
| `relay` | `type` (string), `thread_id` (string), `file` (string), `attested_by` (string), `nonce` (string, ULID), `commit` (string) |

`schema_version` is the **document-level** version. Field additions within `1.0` are backward-compatible per §2.

---

## §4 — Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | User error (invalid flag, invalid input, missing config, rig-id refused, schema validation failure) |
| `2` | System error (git not on `PATH`, disk full, permission denied — reserved, sparse use today) |
| `130` | SIGINT (Ctrl-C) — standard POSIX `128 + 2` |
| `143` | SIGTERM — standard POSIX `128 + 15` |

The split between `1` (user error) and `2` (system error) follows POSIX convention: shell scripts can branch on this distinction. `1` is by far the most common non-zero exit.

---

## §5 — Environment variables

| Variable | Truthy values | Effect |
|----------|---------------|--------|
| `DEBUG_RIG_BRIDGE` | `1`, `true`, `yes`, `on` (falsy: empty, `0`, `false`, `no`, `off`) | Emit startup trace + diagnostics to stderr |
| `NO_COLOR` | presence-only (any value, including empty, suppresses color) | Suppress ANSI color in all stdout/stderr output |
| `RIG_BRIDGE_NO_PAGER` | `1` | Disable auto-paging for `status` + `thread` |
| `PAGER` | shell command | Pager invocation (default is `less -FIRX`-style behavior). Honored by `status` + `thread` when stdout is a TTY and output exceeds terminal height. |

Auto-paging is **disabled** when:
- `--json` is set
- stdout is not a TTY (piped, redirected, in CI)
- `RIG_BRIDGE_NO_PAGER=1`

---

## §6 — Versioning

This contract applies to `@mcptoolshop/rig-bridge` **v1.0.0 and later**.

- **Breaking changes** to stdout shape, exit codes, JSON schema, or environment variable semantics bump the **major** version.
- **Additive changes** — new commands, new flags, new optional JSON fields, new env vars — are **minor-version** compatible.
- **Bug fixes** that align behavior with this contract (when the implementation has drifted) ship in **patch** releases.

The text-mode output (§3 text rows) is **not** part of the stability contract beyond the keys named in the shape. Field order, exact whitespace, and the leading `rig-bridge:` prefix are stable; new key=value pairs may be appended in minor releases.

---

## Related documents

- [`docs/envelope-spec.md`](envelope-spec.md) — canonical envelope frontmatter + body contract (transport-agnostic)
- [`schemas/bridge-message.schema.json`](../schemas/bridge-message.schema.json) — JSON Schema 2020-12 for envelope frontmatter (validation source of truth)
- [`docs/v1.1-roadmap.md`](v1.1-roadmap.md) — forward plan for control-plane integration and remaining open questions
