# Control-Plane Integration

> **Status: Design forward — implementation deferred to v1.1.**
> v1.0.0 ships the git transport (envelope validation, body_hash, marker→status_class derivation, canonical rig-id ingress, the 4 CLI commands `init`/`new`/`send`/`close`) WITHOUT control-plane integration. The 14-commit corpus that motivated rig-bridge had zero swarm-control-plane integration; v1.0.0 ships exactly the thing that proved its own need.
>
> v1.0.0 does NOT contain code that touches `bridge_messages` or `bridge_message_events`. Those tables are not yet migrated into `@dogfood-lab/dogfood-swarm`'s SCHEMA_VERSION 4. The integration is a v1.1 feature delta, triggered when testing-os next ships a schema bump (coupling-driven, not calendar-driven). See `docs/v1.1-roadmap.md`.
>
> This document remains in the repo as the canonical forward design. Every decision below is locked in; only the implementation is staged.

> **Phase 0 design provenance:** Envelope Design Wave (2026-04-29). Companion to `docs/envelope-spec.md` and `schemas/bridge-message.schema.json`. Records the writes-through path between rig-bridge (cross-rig git transport) and `swarm-control-plane` (the SQLite truth layer in `@dogfood-lab/dogfood-swarm`).

## 1. Architectural framing

### 1.1 Why writes-through, not parallel

`rig-bridge` is a transport. `swarm-control-plane` is a database. Putting two truth stores in series is a recipe for drift; putting one as a cache in front of the other guarantees it. The corrected D2 stance (D2a-with-control-plane-bridge-glue, ARCHITECTURE.md §"D2") resolves this by inverting the relationship the original handoff doc proposed:

- **Git is the wire.** Append-only, signed-by-default (GitHub TLS), branch-per-thread, cheap to mirror across rigs. It is the *only* cross-machine substrate v1.0.0 trusts.
- **Control-plane SQLite is the durable state.** Findings already deduplicate by fingerprint there; agent runs are already journaled there; wave receipts already export from there. There is no second truth to keep coherent.
- **rig-bridge is the courier.** It moves envelope-bearing messages between rigs through git, and on each rig it writes a row to control-plane recording *that this message arrived* (or departed). The whole message file (envelope frontmatter + freeform body) stays in the rig-bridge git clone — control-plane stores envelope fields + addressing metadata + a `body_hash` pointer, not the body itself. Per `docs/envelope-spec.md` §3, "the envelope" is the YAML frontmatter block; the message file is envelope + body.

The seam is at `bridge send` and `bridge sync`. Above the seam is the operator's mental model (envelopes flowing between rigs). Below the seam is git push/pull plus a SQLite INSERT.

### 1.2 What control-plane already provides (do not rebuild)

From `packages/dogfood-swarm/db/schema.js` (SCHEMA_VERSION 4) and `lib/domains.js`:

- `runs` — a swarm run keyed by repo + commit + branch + status enum
- `waves` — phase + wave_number, with a `domain_snapshot_id` pinning the ownership map
- `domains` — frozen ownership classes (`owned` / `shared` / `bridge`)
- `agent_runs` — per-wave, per-domain dispatch state (with worktree fields)
- `agent_state_events` — append-only state-machine log
- `findings` — fingerprint-deduplicated across waves, with v4 vantage-point columns
- `verification_receipts` — build-verification artifacts per wave
- `wave_receipts` — durable export pointers (json + md path + content hash)
- `kv` — schema_version + arbitrary key/value

The single-machine `bridge` *ownership class* (the third value of `ownership_class` enum, alongside `owned` and `shared`) was always a coordinator-approved cross-domain bypass. **rig-bridge as a transport is a different concept** — same word, different layer. The doc keeps both senses by calling them "bridge-domain" (single-machine) and "rig-bridge" (cross-machine) when ambiguous.

### 1.3 What rig-bridge adds

- **Cross-rig addressing.** `from_rig` / `to_rig` canonical kebab-case rig identifiers (`mac-m5max`, `windows-5080`); see `docs/envelope-spec.md` §3.4. Control-plane has no such concept today.
- **Thread continuity across rigs.** A `thread` slug groups envelopes that belong to the same conversation, with `references[]` pointing at prior commit SHAs.
- **Envelope typology.** Message-class enum (`REQUEST` / `HANDOFF` / `RESPONSE` / `ACK` / `RESOLUTION` / `STATE` / `RESULT` / `RECOVERY` / `VERIFY` / `DECISIONS`) — observed in the 14-commit corpus.
- **Push-side and pull-side observability.** Both rigs see "what's been sent" and "what's arrived" as control-plane rows, queryable with the same `swarm` CLI conventions.

### 1.4 Where the seam is

```
operator
   │
   ▼
bridge send / bridge sync   ◀── CLI, owned by rig-bridge
   │
   ├─► git push / git pull        ◀── transport (already battle-tested)
   │
   └─► control-plane SQLite write ◀── one INSERT per envelope, this doc's subject
```

Anything *above* the CLI line is rig-bridge's product surface. Anything *below* the dashed line is a swarm-control-plane writer. The two halves talk through `@dogfood-lab/dogfood-swarm` workspace exports (per testing-os CLAUDE.md rule §4 — no relative imports across the package boundary).

## 2. The writes-through path

### 2.1 `bridge send` — concrete sequence

When a rig-bridge user runs `bridge send HANDOFF --thread swarm-rig-bridge-001 --to windows-5080` on Mac:

1. **Compose envelope.** rig-bridge templates a markdown file at `~/bridge/swarm-rig-bridge-001/HANDOFF.md` from the type (`HANDOFF`), thread, sender, target, and operator-supplied tldr. Body is editor-opened or piped in.
2. **Validate.** Run `schemas/bridge-message.schema.json` (Ajv) against the parsed frontmatter. Bail before any side effect on schema fail.
3. **Git stage + commit.** `git add ~/bridge/swarm-rig-bridge-001/HANDOFF.md` then `git commit -m "HANDOFF: <tldr>"`. Capture the resulting commit SHA.
4. **Git push.** `git push origin main`. Capture the post-push HEAD SHA (should equal commit SHA on a non-fast-forward case; if not, fall through to §5.1).
5. **Control-plane write.** Open the same `control-plane.db` the swarm CLI uses (`SWARM_DB` env or default `<testing-os>/swarms/control-plane.db`), inside a single `db.transaction(...)`:
   - INSERT into `bridge_messages` (new table — see §2.2)
   - INSERT into `bridge_message_events` (append-only, event_type `sent`)
6. **Return success.** Print the commit SHA + control-plane row id to stdout.

### 2.2 New SQL surface — `bridge_messages` + `bridge_message_events`

The existing tables don't fit. `agent_runs` is wave-scoped and presupposes a swarm run; cross-rig handoffs predate any swarm run and outlive them. `findings` is fingerprint-deduplicated and severity-typed — the wrong shape. `wave_receipts` is one-per-wave, not one-per-message.

Two new tables, mirroring the existing patterns (entity + append-only event log, like `findings` + `finding_events` or `domains` + `domain_events`):

```sql
-- ───────────────────────────────────────────
-- v5: rig-bridge cross-rig envelope index.
-- One row per envelope sent or received on this rig. The body lives in
-- the rig-bridge git clone at <bridge_root>/<thread>/<filename>; this row
-- captures addressing, type, lifecycle/status (split per §4 cross-walk),
-- and the commit SHA that landed it.
-- ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bridge_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  thread          TEXT    NOT NULL,
  filename        TEXT    NOT NULL,        -- e.g. "HANDOFF.md", "5080-ACK-2.md"
  message_type    TEXT    NOT NULL,        -- enum: REQUEST/HANDOFF/RESPONSE/ACK/RESOLUTION/STATE/RESULT/RECOVERY/VERIFY/DECISIONS
  from_rig        TEXT    NOT NULL,        -- canonical kebab-case slug, e.g. "mac-m5max"
  to_rig          TEXT    NOT NULL,        -- canonical kebab-case slug, e.g. "windows-5080"
  lifecycle_state TEXT    NOT NULL,        -- transport state machine: drafted/sent/received/acked/resolved/superseded (CP-side truth, distinct from envelope status)
  status_class    TEXT    NOT NULL,        -- closed enum derived from envelope status marker: active/pending/targeted/completed/cancelled
  status_text     TEXT    NOT NULL,        -- full envelope verb-prose, byte-faithful (e.g. "✅ Cutover complete. Old-repo archive unblocked.")
  tldr            TEXT,                    -- one-line summary from envelope frontmatter
  envelope_date   TEXT    NOT NULL,        -- ISO 8601 from envelope `date:` field
  commit_sha      TEXT    NOT NULL,        -- commit that landed this envelope
  parent_refs     TEXT,                    -- JSON array of prior commit SHAs (envelope `references`)
  run_id          TEXT    REFERENCES runs(id),  -- nullable: swarm run if envelope is swarm-scoped
  body_hash       TEXT    NOT NULL,        -- sha256, normalized — see §4.1 for the normative rule (computed on every send; NOT NULL because the §4.1 rule applies unconditionally)
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(commit_sha, filename)
);

-- ───────────────────────────────────────────
-- v5: append-only lifecycle events for envelopes.
-- Mirrors findings/finding_events shape.
-- ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bridge_message_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  INTEGER NOT NULL REFERENCES bridge_messages(id),
  event_type  TEXT    NOT NULL,    -- enum: drafted/sent/received/acked/resolved/superseded
  rig         TEXT    NOT NULL,    -- which rig recorded this event
  notes       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bridge_msg_thread       ON bridge_messages(thread);
CREATE INDEX IF NOT EXISTS idx_bridge_msg_run          ON bridge_messages(run_id);
CREATE INDEX IF NOT EXISTS idx_bridge_msg_status_class ON bridge_messages(status_class);
CREATE INDEX IF NOT EXISTS idx_bridge_msg_lifecycle    ON bridge_messages(lifecycle_state);
CREATE INDEX IF NOT EXISTS idx_bridge_msg_ev           ON bridge_message_events(message_id);
```

This bumps `SCHEMA_VERSION` to `5`. Per `connection.js`, the existing `applyMigrations` mechanism handles the additive `CREATE TABLE IF NOT EXISTS` cleanly — the v5 migration is just the two CREATE TABLE statements appended to `SCHEMA_SQL`, no `ALTER TABLE` needed because both tables are new.

### 2.3 `bridge sync` — concrete sequence

When the receiving rig (5080) runs `bridge sync` (or it's invoked by the pre-wave hook in §3):

1. **Git fetch.** `git fetch origin main` against the bridge clone.
2. **Diff against last-seen.** Read `MAX(commit_sha)` per-thread from `bridge_messages WHERE to_rig = '<this rig>'`. Walk `git log <last-seen>..origin/main` for new commits.
3. **Parse new envelopes.** For each new commit, identify added `<thread>/<file>.md` paths, parse frontmatter, validate against `bridge-message.schema.json`.
4. **Fast-forward.** `git merge --ff-only origin/main`. (If this fails, abort sync — operator handles divergence; v1.0.0 does not auto-merge.)
5. **Control-plane write.** For each parsed envelope, INSERT a `bridge_messages` row with `lifecycle_state='received'` (plus `status_class` + `status_text` derived from the envelope `status` per §4.2) and an event-log row `(event_type='received', rig='<this rig>')`.
6. **Print arrivals.** Emit a one-line summary per new envelope (`thread`, type, from-rig, tldr) to stdout, plus exit 0.

### 2.4 Library surface (proposed exports from `@dogfood-lab/dogfood-swarm`)

To keep rig-bridge from reaching into the package's internals (testing-os CLAUDE.md §4), `dogfood-swarm` adds a subpath export:

```js
// @dogfood-lab/dogfood-swarm/bridge
export function recordSent(db, envelope, commitSha) { /* INSERT bridge_messages + event */ }
export function recordReceived(db, envelope, commitSha) { /* idem, lifecycle_state=received */ }
export function recordAcked(db, messageId, ackingCommitSha) { /* event-only */ }
export function listMessages(db, { thread, run_id, lifecycle_state, status_class } = {}) { /* SELECT */ }
export function lastSeenCommit(db, { thread, to_rig }) { /* MAX(commit_sha) */ }
```

rig-bridge imports these as `import { recordSent } from '@dogfood-lab/dogfood-swarm/bridge'`. No relative paths cross the workspace boundary.

## 3. Cross-rig wave coordination — pre-wave hook

### 3.1 The risk

PROTOCOL.md's risk-2 mitigation is: before any swarm wave dispatch, the bridge clone must be up to date and clean. If rig A is mid-conversation with rig B and rig A starts a wave dispatch without pulling, rig A may be operating on stale instructions. Symmetrically, if rig A's bridge has uncommitted local changes, those changes get silently overwritten on the next pull.

### 3.2 Three options considered

| Option | Owner | Pros | Cons |
|---|---|---|---|
| (a) `bridge sync --check` invoked by swarm CLI | rig-bridge | Single source of truth for what "fresh + clean" means; swarm CLI stays unaware of git semantics | Adds a runtime dep from `dogfood-swarm` to `rig-bridge` |
| (b) Built into swarm CLI directly (shell out to `git`) | swarm CLI | Zero new deps; keeps the gate inside the package that needs it | Duplicates git logic; swarm CLI grows knowledge it shouldn't have |
| (c) Manual operator step in PROTOCOL.md | human | No code changes; cheapest to ship | Easy to forget; 100% of the value is preventing forgotten steps |

### 3.3 Verdict — option (a), with the dependency direction inverted

**Recommend:** `bridge sync --check` is rig-bridge's responsibility, but **swarm CLI does not import rig-bridge**. Instead, the swarm `dispatch` command grows an optional `--bridge-precheck` flag (default off in v1.0.0, default on once rig-bridge is shipping) which shells out to `bridge sync --check` if it's on `$PATH`, and refuses to dispatch if it's missing-and-required.

Reasoning:

- **Direction.** `dogfood-swarm` is the lower layer (testing-os monorepo flagship); `rig-bridge` is the consumer. Lower layers must not import upward — option (a)'s direct import would violate that. Shelling out to a CLI is the canonical inversion.
- **Discoverability.** Operators learn about cross-rig precheck through `swarm dispatch --help`, not by remembering to type two commands. That is the whole point of the gate.
- **Local-only swarms.** A swarm run that doesn't touch a bridge-shared repo (most of them, today) opts out by simply not setting `--bridge-precheck`. Zero overhead for the local case.
- **Fail-shut, not fail-open.** If `--bridge-precheck` is on and `bridge sync --check` is missing or returns non-zero (uncommitted changes, behind remote, push needed), `swarm dispatch` exits non-zero before any wave row is created. Easier to explain than half-dispatched waves.

### 3.4 What `bridge sync --check` does

Read-only analog of `bridge sync` (§2.3 steps 1–4 *minus* the merge):

```
$ bridge sync --check
checking ~/bridge clone…
  ✓ remote reachable
  ✓ working tree clean
  ✓ at origin/main (no unpulled commits)
  ✓ last-seen control-plane row matches HEAD
ok
$ echo $?
0
```

Failure exits non-zero with a one-line cause + a one-line remedy. No prompts, no retries, no merging.

## 4. Schema cross-walk — envelope frontmatter to control-plane columns

Envelope fields per `docs/envelope-spec.md` (the canonical envelope definition; derived from the 14-commit corpus and the Schema Cross-Reference seed in `ARCHITECTURE.md`):

| Envelope field   | Control-plane location | Notes |
|------------------|------------------------|-------|
| `from`           | `bridge_messages.from_rig` | canonical kebab-case rig identifier (e.g. `mac-m5max`); see `docs/envelope-spec.md` §3.4 |
| `to`             | `bridge_messages.to_rig` | same shape; multi-recipient envelopes (`to: [...]`) land as one row per recipient at the courier seam |
| `date`           | `bridge_messages.envelope_date` | ISO 8601; distinct from `created_at` (which is the row insert time) |
| `status` (envelope, open verb-prose) | **two columns**: `bridge_messages.status_class` + `bridge_messages.status_text` | The envelope's `status` is open verb-prose authored by humans (e.g. `✅ Cutover complete. Old-repo archive unblocked.`). The CP needs queryability without losing fidelity, so it splits the field: `status_class` is a closed enum derived from the leading marker emoji (`▶` → `active`, `⏸` → `pending`, `🎯` → `targeted`, `✅` → `completed`, `❌` → `cancelled`); `status_text` preserves the full verb-prose byte-faithfully. The envelope itself is **unchanged** for authors — the schema's `^(▶\|⏸\|🎯\|✅\|❌)\s.+$` pattern still applies. See §4.2 for the derivation rule. |
| `display_name`   | (not stored as its own column for v1.0.0) | optional human-readable rig name; embed in body if visibility matters. Out of scope for control-plane in v1.0.0; deferred to v1.1 if a join becomes useful |
| `tldr`           | `bridge_messages.tldr` | string, soft cap 280 chars (validator only — column is plain TEXT) |
| `type`           | `bridge_messages.message_type` | enum from §1.3 |
| `thread`         | `bridge_messages.thread` | indexed; identifies the conversation |
| `references`     | `bridge_messages.parent_refs` | JSON array of commit SHAs, mirrors the `findings.cross_ref` JSON-in-TEXT precedent |
| (envelope body)  | **not stored in CP** | body lives in the rig-bridge git clone; CP stores `body_hash` for drift detection only |
| (commit SHA)     | `bridge_messages.commit_sha` | not in envelope frontmatter — added by transport layer at send-time |
| (filename)       | `bridge_messages.filename` | derived from envelope type + ordinal in thread |
| (run linkage)    | `bridge_messages.run_id` | nullable — populated when an envelope is created inside an active swarm run; FK back to `runs(id)` |
| (transport lifecycle) | `bridge_messages.lifecycle_state` + `bridge_message_events` | `lifecycle_state` is the CP-side state-machine column (closed enum: `drafted`/`sent`/`received`/`acked`/`resolved`/`superseded`). `bridge_message_events` is the append-only log of state transitions. **Do not confuse this with the envelope's `status` field** — `status` is what the human author wrote, `lifecycle_state` is what the transport observed. |

Every field in the envelope spec has a home. Body is deliberately out — control-plane is an index, not an archive. Git is the archive.

### 4.1 `body_hash` — normative spec (algorithm + normalization)

The `bridge_messages.body_hash` column is computed and stored on every `bridge send`. It enables drift detection on `bridge replay` (§5.3) without storing the body itself.

**Algorithm:** `SHA-256` (lowercase hex, 64 chars). Not negotiable in v1.0.0 — pinning early avoids a future migration path. If a v2 adds a stronger algorithm, it ships behind a separate column (`body_hash_v2`) so existing rows stay valid.

**Input scope:** the envelope BODY only — everything after the second `---` frontmatter delimiter, up to but not including any trailing single newline. The frontmatter itself is NOT hashed (those fields live in their own columns and are individually queryable).

**Normalization rule (mandatory, applied before hashing):**

1. **Line endings.** Normalize all `\r\n` and lone `\r` to `\n`. Mac and 5080 produce CRLF/LF drift on round-trip through git's `core.autocrlf` and editor defaults; without this rule, byte-identical authored content hashes differently per rig and `body_hash` becomes a false-positive drift signal.
2. **Trailing whitespace on lines.** Stripped per line. Editors silently inject this; it's not part of the message's intent.
3. **Trailing newlines on the file.** All trailing newlines are stripped, then **exactly one** terminal `\n` is appended. This means an empty body and a body with one or more trailing blank lines all hash identically — the rule is "exactly one terminal newline, always," not "preserve whatever was there." This deliberately erases per-rig editor drift in trailing blank lines (Mac and 5080 editors disagree on this routinely; the disagreement is not part of the message's intent).
4. **Encoding.** UTF-8, no BOM. If a BOM is present at body start, strip before hashing.
5. **No other normalization.** Markdown content (heading levels, list bullet style, fenced-code language tags, internal whitespace inside lines) is preserved as authored — those ARE part of the message's intent and drift in them IS real drift to detect.

> **Note.** Rule 3 means the empty body (`""`) and a body that is just `"\n"` hash identically. This is intentional — both represent "no body content authored," and per-rig editors disagree on which they emit. Authors who need to assert "this message has no body" carry that intent in the envelope (typically via `tldr` or by message type alone), not in the body's whitespace.

**Reference implementation (informative):**
```ts
function normalizeBody(raw: string): string {
  const noBom = raw.startsWith("﻿") ? raw.slice(1) : raw;
  const lf = noBom.replace(/\r\n?/g, "\n");
  const lines = lf.split("\n").map(line => line.replace(/[ \t]+$/, ""));
  const joined = lines.join("\n");
  return joined.replace(/\n+$/, "") + "\n";
}

import { createHash } from "node:crypto";
export function bodyHash(raw: string): string {
  return createHash("sha256").update(normalizeBody(raw), "utf8").digest("hex");
}
```

**Test vectors** (computed against the reference impl) MUST ship as part of `@dogfood-lab/dogfood-swarm` test fixtures so a Rust or Python re-implementation can verify byte-for-byte parity. The Phase 1 test agent owns adding these.

**Why pin this now (Mike, 2026-04-29):** "Cheap to spec now, painful to retrofit. Mac and 5080 can produce CRLF/LF drift on the same body otherwise, and the hash becomes a false-positive drift signal." Directly addresses the corpus's "What hurt #2" — stale-truth between rig-bridge messages and per-rig MEMORY.md.

### 4.2 `status` derivation rule (envelope marker → `status_class`)

The CP `status_class` column is computed from the envelope's `status` field at write time. The derivation is purely the leading marker glyph; the trailing prose lands in `status_text` unchanged.

| Envelope marker | `status_class` value |
|---|---|
| `▶` | `active` |
| `⏸` | `pending` |
| `🎯` | `targeted` |
| `✅` | `completed` |
| `❌` | `cancelled` |

The schema's `status` pattern (`^(▶|⏸|🎯|✅|❌)\s.+$`) guarantees exactly one of these markers is present, so the derivation is total. Validators that fail the pattern fail the schema first; the CP write never sees them.

This split is the resolution to the apparent conflict between the envelope-spec (open verb-prose) and the §1.3 enumeration (closed lifecycle): both are correct, on different layers. The envelope serves humans — closed enums lose the nuance the corpus showed authors compressing into the prose (e.g. `✅ Cutover complete. Old-repo archive unblocked.` carries both the local result and the remote consequence). The CP serves queries — `WHERE status_class = 'cancelled'` needs to be cheap. `status_class` indexes; `status_text` preserves.

The transport's own state-machine column (`lifecycle_state`) is independent of both. It records what the courier observed (`drafted` → `sent` → `received` → `acked` → `resolved` / `superseded`), not what the human wrote. A message can be `lifecycle_state='resolved'` while `status_class='cancelled'` (the thread closed via a cancellation envelope) — the two rows tell different stories and both are queryable.

## 5. Failure modes + recovery

### 5.1 Push succeeds, SQLite write fails (or vice versa)

**Cause:** crash, disk full, db lock contention exceeding the 5s `busy_timeout`, or operator Ctrl-C between the two operations.

**Detection:** on next `bridge send` or `bridge sync` invocation, run a reconcile pass: walk the bridge git log for commits touching `<thread>/*.md` files, check whether each commit_sha is present in `bridge_messages`. Missing rows are reconcile candidates.

**Recovery:**
- **Push-then-SQLite-fail:** the envelope is on git but not in CP. The next `bridge sync` (or an explicit `bridge reconcile`) replays steps 5 of §2.3 against the orphan commit. Idempotent because of `UNIQUE(commit_sha, filename)`.
- **SQLite-then-push-fail:** the row is in CP with `lifecycle_state='sent'` but the commit isn't on the remote. Detect by checking `git branch --contains <commit_sha>` for the local branch only. Recovery: re-attempt `git push`. If the local commit was lost (unlikely — git is append-only locally too), the CP row is marked `lifecycle_state='superseded'` with a note in the event log.

The explicit operator command is `bridge reconcile [--thread X]`. v1.0.0 ships it; it's not optional.

### 5.2 Two rigs push simultaneously (concurrent send)

**What git handles:** `git push` second-in is rejected as non-fast-forward. The losing rig pulls, observes the new commit, and is forced to base its commit on the new HEAD before retry. Append-only semantics hold; the two envelopes land as siblings on the same branch.

**What git does NOT handle:** the same envelope filename being created on both rigs (e.g. both rigs write `<thread>/HANDOFF.md` in the same instant). Git would flag this as a merge conflict. v1.0.0 sidesteps the case by **filename ordinality**: rig-bridge derives filenames as `<TYPE>.md`, `<TYPE>-2.md`, `<TYPE>-3.md` (the corpus already shows this — `5080-ACK.md`, `5080-ACK-2.md`, `MAC-RESPONSE.md`, `MAC-RESPONSE-2.md`). On collision, the second writer pulls + bumps its ordinal + re-commits before pushing. This is `bridge send`'s retry loop.

**Control-plane uniqueness:** `UNIQUE(commit_sha, filename)` is sufficient. Two rigs cannot produce the same `(commit_sha, filename)` pair because commit SHAs are content-addressed and the filenames are different (one rig bumped its ordinal). `(thread, filename)` would be too tight — the same `HANDOFF.md` filename can legitimately appear in different threads.

### 5.3 SQLite corruption / deletion — replay from git

**Premise:** control-plane is a derived index. The git history is the truth.

**Replay path:**
1. `bridge replay --thread <X>` (or `--all`) walks `git log` on the bridge clone.
2. For each commit, parse any added envelope files, validate their frontmatter, INSERT a `bridge_messages` row with `lifecycle_state='received'` (or `lifecycle_state='sent'` if `from_rig` matches the local rig identifier), plus `status_class` + `status_text` derived from the envelope `status` per §4.2.
3. INSERT a single `bridge_message_events` row per envelope: `event_type='replayed'`, `notes='reconstructed from git history at <date>'`.
4. Lifecycle history (`acked`, `resolved`) is **lost** — those state transitions only ever lived in CP. Replay recovers existence + addressing, not ack-state. v1.0.0 acceptable; documented loud in `bridge replay --help`.

**The body-hash column** (`bridge_messages.body_hash`) makes drift detection cheap on replay: re-hashing the normalized body (per §4.1) matches the original-write hash, confirming git history is byte-identical to what was originally indexed.

## 6. Deferred to v1.1+

Explicitly out of scope for v1.0.0 (echoes ARCHITECTURE.md §"Out of scope" and adds the integration-specific deferrals):

- **Pre-wave hook auto-installation.** v1.0.0 requires the operator to pass `--bridge-precheck` to `swarm dispatch`. v1.1 may default it on when `bridge` is on `$PATH`.
- **MCP frontend.** rig-bridge's CLI is the only operator surface in v1.0.0. An MCP server wrapping `bridge send` / `bridge sync` is plausible but unbuilt.
- **Multi-rig (3+).** Schema is forward-compatible — `from_rig` / `to_rig` are open-membership kebab-case slugs — but no routing logic, no fan-out, no broadcast envelopes. Two-rig symmetric only.
- **Encryption beyond GitHub default.** Envelope bodies in plaintext at rest in the bridge clone and in transit through GitHub TLS. No PGP, no age, no per-thread keys.
- **Cloud-hosted central queue.** Git remains the wire. No Redis, no SQS, no Postgres LISTEN/NOTIFY backend.
- **Plugin system.** Envelope types are a closed enum in v1.0.0. New types require a schema bump.
- **Per-envelope ack-state replay from git.** §5.3 explicitly drops this. Recovery from CP loss recovers existence, not lifecycle.
- **`RunHandoff → rig-bridge envelope` adapter.** ARCHITECTURE.md flags this as future. Mentioned here only because the schema cross-walk in §4 makes it tractable later — `bridge_messages` columns map cleanly to RunHandoff's outer envelope, and the body would carry the rich `RunHandoff` payload as JSON. Not v1.0.0.

## References

- `ARCHITECTURE.md` — D2 stance + envelope cross-reference seed
- `docs/envelope-spec.md` — canonical envelope spec; this doc mirrors the field set and adds the CP write-through layer
- `schemas/bridge-message.schema.json` — Ajv-validated schema for the envelope frontmatter
- `/Volumes/T9-Shared/AI/dogfood-lab/testing-os/packages/dogfood-swarm/db/schema.js` — control-plane schema source of truth
- `/Volumes/T9-Shared/AI/dogfood-lab/testing-os/packages/dogfood-swarm/lib/domains.js` — bridge-domain (single-machine) ownership class, semantically distinct from rig-bridge transport
- `/Volumes/T9-Shared/AI/dogfood-lab/testing-os/swarms/PROTOCOL.md` — pre-wave hook risk-2 mitigation
- `/Users/michaelfrilot/bridge/{swarm-rig-bridge-001, star-freight-canon-001, state-2026-04-29}/` — 14-commit corpus, observed envelope shapes
