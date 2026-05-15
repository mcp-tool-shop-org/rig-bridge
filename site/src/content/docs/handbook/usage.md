---
title: Usage
description: The eight rig-bridge commands and how they compose.
sidebar:
  order: 2
---

`rig-bridge` ships eight commands grouped by intent: **authoring**, **inspection**, **sync + attestation**. Each command emits a stable `key=value` line on stdout (or a JSON object with `--json`) and human-readable narrative on stderr. See [Reference](../reference/) for the full CLI contract.

## Authoring commands

These mutate the bridge — they write files, commit, and (unless `--no-push`) push.

### `rig-bridge init`

```bash
rig-bridge init --rig-id mac-m5max [--display-name "Mac Claude"] [--force]
```

Initializes the local bridge clone:

- Writes `.bridge/config.yaml` with the canonical rig id (validated as kebab-case; uppercase input auto-lowered with a hint).
- Installs a `.git/hooks/commit-msg` hook that fingerprints commits with the rig id.
- The `.bridge/config.yaml` file is rig-local; add it to `.gitignore`.

### `rig-bridge new <thread-id>`

```bash
rig-bridge new bridge-onboarding-01 [--force]
```

Scaffolds `<thread-id>/REQUEST.md` from the envelope template. The frontmatter is pre-filled with your rig id and the date; you write the body. `--force` overwrites an existing REQUEST.md (no auto-bump in v1.0.0).

### `rig-bridge send <type> --thread <id>`

```bash
rig-bridge send HANDOFF --thread bridge-onboarding-01 \
  --to windows-5080 \
  --tldr "first contact" \
  --body-file response.md \
  [--ref <commit-sha>]... \
  [--status "▶ Working on X"] \
  [--no-push]
```

Writes a typed envelope, validates against the schema, computes `body_hash`, derives `status_class` from the marker (▶ active / ⏸ pending / 🎯 targeted / ✅ completed / ❌ cancelled), commits, and pushes. Types: `REQUEST` / `HANDOFF` / `RESPONSE` / `ACK` / `RESOLUTION` / `STATE` / `RESULT` / `RECOVERY` / `VERIFY` / `DECISIONS`.

If commit fails, the envelope file is removed (orphan cleanup). If push fails, the commit lands locally with a stderr recovery hint: `cd <repo>; git pull --rebase; git push`.

### `rig-bridge close <thread-id> --status <cancelled|completed>`

```bash
rig-bridge close bridge-onboarding-01 --status completed [--note "wave landed"]
```

Writes a terminal `RESOLUTION.md` with the matching status marker (✅ completed or ❌ cancelled). After close, the thread no longer appears as open in `rig-bridge status`.

## Inspection commands

These are read-only and emit machine-parseable data on stdout.

### `rig-bridge status`

```bash
rig-bridge status [--wide] [--json] [--no-color]
```

Lists all threads sorted by recency descending. Default 5 columns: `thread`, `last`, `status`, `type`, `dirty`. `--wide` adds `from`, `to`, `closed`, `envelope_count`. `--json` emits a single object with `schema_version: "1.0"` (pinned contract; see [Reference](../reference/)).

Color (state markers) is applied only when stdout is a TTY AND `NO_COLOR` is unset AND `--no-color` is not passed AND `--json` is not used.

### `rig-bridge thread <thread-id>`

```bash
rig-bridge thread bridge-onboarding-01 [--json]
```

Renders the full envelope transcript chronologically (small-multiples pattern: identical frontmatter-header + body block per envelope). Auto-pages via `$PAGER` (default `less -FIRX`) when output exceeds terminal height. `RIG_BRIDGE_NO_PAGER=1` disables paging.

## Sync + attestation commands

### `rig-bridge sync`

```bash
rig-bridge sync [--auto] [--json]
```

Reads the remote without auto-pulling. If the remote has only **new files** in known thread directories (fast-forward eligible per architectural lock L1), reports them. With `--auto`, applies the pull.

If the remote has modified existing envelopes, or both sides have diverged commits, sync **refuses** — append-only is the contract. The operator decides whether to `git pull --rebase` manually.

> Silent merge is the documented worst case in cross-rig sync (Owhadi-Kareshk 2019; Tao 2021). `rig-bridge sync` defaults to surfacing, not merging.

### `rig-bridge relay <type> --thread <id>`

```bash
rig-bridge relay DECISIONS --thread bridge-onboarding-01 \
  --in-reply-to <body-hash-of-prior-turn> \
  --body-file decision.md
```

Records a **human-attested** DECISIONS / RESPONSE / ACK turn. Refuses to run unless:

- The current rig id ends in `-relay` (e.g. `mike-relay`).
- `git config user.name` AND `user.email` are set (commit authored by the human, not the bridge).
- `git config user.signingkey` is set (commit must be signable; soft-fail is silent insecurity).
- `--in-reply-to <body-hash>` is provided and matches `^[0-9a-f]{64}$` (replay-prevention).

The envelope frontmatter carries an attestation block:

```yaml
attested_by: <signing-key-id>
attested_at: <ISO-8601 UTC>
nonce: <ULID-like>
in_reply_to: <body-hash-of-prior-turn>
```

The filename uses `RELAY-<nonce-prefix>.md` so relay turns don't collide with normal ordinal sequencing.

## Composing commands

stdout = data; stderr = narrative. Scripts can pipe:

```bash
# Find dirty open threads
rig-bridge status --json | jq '.threads[] | select(.dirty == true)'

# Auto-sync if FF-eligible, else show divergence
rig-bridge sync --json | jq -e '.fast_forward_eligible' >/dev/null \
  && rig-bridge sync --auto \
  || rig-bridge sync   # text output explains the divergence

# Verify body_hash invariant for every open thread
rig-bridge status --json | jq -r '.threads[].thread_id' | while read t; do
  rig-bridge thread "$t" --json | jq -r '.envelopes[].body_hash'
done
```
