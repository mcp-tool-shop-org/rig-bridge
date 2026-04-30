# Envelope Spec — `bridge-message` v1.0.0

> **Status:** Phase 0 deliverable. Canonical envelope spec for `rig-bridge`. Owns its own shape; transport-agnostic; generic over rigs / sessions / payload kinds. The companion JSON Schema is at `schemas/bridge-message.schema.json`.

## 1. Scope and intent

`rig-bridge` carries structured messages between two coordinating agents (typically two Claude sessions on different rigs) over an append-only transport (git-as-queue is the v1 implementation; the envelope itself does not bind a transport).

> **Terminology:** "rig-bridge" is this cross-machine tool. "bridge-domain" is the single-machine ownership class in `swarm-control-plane` (a coordinator-approved cross-domain bypass). The two share a word but live at different layers — see `docs/control-plane-integration.md` §1.2. Throughout this spec, **the bridge** = the rig-bridge git clone on a given rig; **the bridge repo** = the GitHub repo that hosts the cross-rig wire.

The envelope's job is to make a message file in the rig-bridge **machine-addressable** — a peer can scan a directory and answer:

- whose turn is it?
- which thread is this?
- what is the prior turn this answers?
- what kind of message is this?
- is the thread open or closed?

…without parsing the body. The body remains freeform markdown for v1.0.0.

This spec is derived from the 14-commit organic protocol that emerged across `star-freight-canon-001/`, `state-2026-04-29/`, and `swarm-rig-bridge-001/` during the 2026-04-29 cross-rig session. Every rule below maps to a pattern observed in that corpus.

## 2. File location and naming

### 2.1 Per-thread directory

A bridge thread lives in a single directory at the root of the bridge repo:

```
<bridge-repo>/<thread-id>/
```

`<thread-id>` is a kebab-case slug, scoped enough to be unique inside the bridge:

- `star-freight-canon-001` (topical + sequence)
- `state-2026-04-29` (topical + date)
- `swarm-rig-bridge-001` (topical + sequence)

### 2.2 Per-message file

Each message is one markdown file inside its thread directory:

```
<thread-id>/<TYPE>.md
<thread-id>/<RIG>-<TYPE>.md
<thread-id>/<TOPIC>-<TYPE>.md
```

`<TYPE>` is one of the values in §4.1 (uppercase). `<RIG>` is a rig identifier in uppercase short form (e.g. `MAC`, `5080`). `<TOPIC>` is an optional kebab-case slug for messages that bind to a sub-topic of the thread (e.g. `BACKUP-SCAN-RESULT`, `RECOVERY-FOUND`).

The bare `<TYPE>.md` form is preferred when the thread has only one author per type (e.g. `REQUEST.md`, `RESOLUTION.md`, `HANDOFF.md`).

### 2.3 Sequential turns within a thread

When the same author sends multiple messages of the same type in the same thread, append a numeric suffix starting at `-2`:

```
MAC-RESPONSE.md       # first response from Mac
MAC-RESPONSE-2.md     # second response from Mac
5080-ACK.md
5080-ACK-2.md
5080-ACK-2-REPOINTED.md   # qualifier suffix on the same numeric turn
```

Qualifier suffixes (`-RECOVERY-FINAL`, `-REPOINTED`, `-FINAL`) attach **after** the numeric suffix and describe the message's role in the sequence. They MUST be uppercase kebab-case.

The filename is convention only. The envelope's `thread` and `references[]` fields are the load-bearing identifiers; do not parse filenames to derive thread state.

## 3. Frontmatter

Every message MUST begin with a YAML frontmatter block delimited by `---` lines, immediately followed by the markdown body. The frontmatter is the envelope; the schema in `schemas/bridge-message.schema.json` validates this block alone.

### 3.1 Required fields

| Field | Type | Notes |
|---|---|---|
| `from` | string | Canonical rig identifier of the sender (kebab-case slug). See §3.4. |
| `to` | string \| string[] | One or more canonical rig identifiers. Multi-recipient is allowed (observed in corpus: peer + human relay). |
| `date` | string (ISO 8601) | Date or full timestamp. `YYYY-MM-DD` is acceptable for low-resolution dating; `YYYY-MM-DDTHH:MM:SSZ` is preferred when sub-day ordering matters. |
| `status` | string | A status verb-phrase. See §3.5. |
| `type` | enum | One of the §4.1 values. |
| `thread` | string | The `<thread-id>` (matches the parent directory). |

### 3.2 Recommended fields

| Field | Type | Notes |
|---|---|---|
| `tldr` | string | One-sentence summary. Strongly recommended for messages whose body exceeds ~30 lines. |
| `references` | string[] | Commit SHAs of prior turns this message answers, corrects, or builds on. See §3.6. |
| `display_name` | string | Optional human-readable rig name (≤80 chars). Used by prose body. The envelope's `from` is authoritative for routing. See §3.4. |

### 3.3 Disallowed fields

The schema sets `additionalProperties: false`. Unknown keys cause validation failure. Bodies carry freeform content; the envelope does not.

### 3.4 Rig identifiers

A rig identifier names a participant in a thread. v1.0.0 splits the concept in two:

- **`from` / `to` carry a canonical machine identifier.** Lowercase kebab-case slug, starting with a letter (regex: `^[a-z][a-z0-9-]*$`). This is what the control-plane indexes and what tooling joins on. The schema enforces shape; membership is open so adding a rig later does not require a schema bump.
- **`display_name` (optional) carries the human-readable form.** Used by prose body greetings, sign-offs, and operator-facing tooling. Capped at 80 chars. The envelope's `from` is authoritative for routing — `display_name` is metadata only.

#### Founding rigs — canonical id ↔ display name

| Canonical id | Display name | Notes |
|---|---|---|
| `mac-m5max` | `Mac Claude` | Mac M5 Max agent |
| `windows-5080` | `5080 Claude` | Windows GPU rig agent |
| `mike-relay` | `Mike (relay)` | Human author when input is relayed in-band; `-relay` suffix flags the message as second-hand |
| `<rig>` | `<Rig> Claude` | General form for additional rigs (forward-compat; v1.0.0 is two-rig — see §6) |

#### Why split id from display name

The 14-commit corpus addressed rigs by display name (`Mac Claude`, `5080 Claude`) — comfortable for humans, but case- and whitespace-sensitive in a way that makes DB indexes brittle and shell quoting awkward. The split fixes both: the canonical id is shell- and DB-clean, the display name preserves the human shape for body prose.

#### Pre-v1.0.0 corpus compatibility

v1.0.0 is forward-only. Pre-v1.0.0 corpus messages used display names in `from` / `to` and **will not validate** against this schema. The historical artifact remains in the scratch repo (`mcp-tool-shop-org/rig-bridge-scratch`) as the source corpus; it is not migrated to v1.0.0 frontmatter. This matches the precedent set by §7 item 8 (no `version` field in v1.0.0 envelopes; v1.1 introduces it before any v2 design lands).

### 3.5 Status verb-phrases

`status` is **not** a closed enum. It is a verb-phrase that begins with one of five lifecycle markers (emoji glyph), followed by free prose:

| Marker | Meaning | Corpus example |
|---|---|---|
| `▶` | Active / in progress / ready to dispatch | `▶ Phase 0 (Envelope Design Wave) ready` |
| `⏸` | Pending / blocked / awaiting peer | (used inline in queue items: `⏸ Mike picks 5080 root path`) |
| `🎯` | Targeted finding / decisive moment | `🎯 The hunch in 5080-CLONE-RESULT.md §1 paid off` |
| `✅` | Completed / acknowledged / verified | `✅ HANDOFF received. 5080 side partially staged.` |
| `❌` | Cancelled / cannot fulfill / blocked terminally | `❌ Cancelled. Canon doesn't exist anywhere.` |

The marker MUST be the first non-whitespace character of `status`. The schema enforces this with a `pattern`. The trailing prose is free.

Rationale for keeping it free-form: the corpus shows authors compressing nuance into the status line (e.g. `✅ Cutover complete. Old-repo archive unblocked.` carries both the local result and the remote consequence). A closed enum would lose that.

A status with no marker is a schema violation. If your message's lifecycle stance doesn't fit one of the five, default to `▶` (active) for forward motion or `⏸` (pending) for awaiting input.

### 3.6 References

`references[]` is an array of commit SHAs (full or short, ≥7 hex characters) identifying prior turns this message answers, corrects, or extends.

References are **the bridge between the envelope and the SQLite control-plane**: when a message lands in git, the SHA in `references[]` becomes a foreign key the control-plane can join on. Authors should reference:

- The immediate prior turn (the message they're answering)
- Any earlier turn whose claims they're correcting or extending
- The thread's opening REQUEST when relevant

Out-of-thread references (a SHA from a different bridge thread) are allowed; the receiver decides whether to chase them.

## 4. Type system

### 4.1 The ten types

Listed in canonical lifecycle order — matches the `messageType` enum in `schemas/bridge-message.schema.json` and the §1.3 enumeration in `docs/control-plane-integration.md`:

| Type | Role | Filename pattern |
|---|---|---|
| `REQUEST` | Asker spec — what the sender wants from the peer. Opens a thread. | `REQUEST.md` |
| `HANDOFF` | Reply with payload, OR counter-proposal that re-shapes the request. | `HANDOFF.md` |
| `RESPONSE` | Targeted reply that addresses prior turn's content. | `<RIG>-RESPONSE[-N].md` |
| `ACK` | Acknowledgement — confirms receipt + alignment without new asks. | `<RIG>-ACK[-N][-QUAL].md` |
| `RESOLUTION` | Terminal close-out for the thread. See §5. | `RESOLUTION.md` |
| `STATE` | Inventory snapshot — context, not action. Often paired with REQUEST. | `STATE.md` |
| `RESULT` | Output of a delegated action (clone batch, scan, build). | `<TOPIC>-RESULT.md` |
| `RECOVERY` | Unexpected positive finding that changes the loss/gain footprint. | `RECOVERY-<TAG>.md` or `<TOPIC>-FOUND.md` |
| `VERIFY` | Independent peer verification of a claim. | `<RIG>-VERIFY-<TAG>.md` |
| `DECISIONS` | Human input relayed in-band (typically Mike's calls on open questions). | `MIKE-DECISIONS.md` or `DECISIONS.md` |

### 4.2 Type semantics

- `REQUEST` opens. `RESOLUTION` closes. Everything between is the conversation.
- `HANDOFF` is special: it carries the *substantive payload* the thread exists for (a delivery, an inversion proposal, a phase-0 dispatch). Rich threads usually have one HANDOFF; some have several when the payload re-shapes mid-thread.
- `RESPONSE` and `ACK` differ by intent: a RESPONSE introduces new content (corrections, plans, asks); an ACK confirms alignment without new asks.
- `STATE` is a snapshot the peer can read for context but isn't expected to act on directly. The actionable companion is usually a paired REQUEST.
- `RESULT` and `RECOVERY` both report outcomes; `RECOVERY` is reserved for findings that change the assumed picture (loss → recovery, dead-end → live path).
- `VERIFY` is a peer-validation message — the second rig confirming the first's claim from independent evidence.
- `DECISIONS` is the documented human-as-out-of-band-decider escalation pattern. It's in-band recorded so the thread captures the decision point on the timeline.

### 4.3 Type vs. status

`type` and `status` are orthogonal. A `RESOLUTION` message can carry status `❌ Cancelled` or `✅ Completed`. A `RESPONSE` can carry `▶ Plan endorsed with corrections` or `🎯 Decisions on open questions`. The receiver reads both.

## 5. Resolution patterns

The thread closes with a `RESOLUTION.md` (or in some threads, paired `<RIG>-ACK-FINAL.md` from both sides). Four resolution shapes were observed:

| Pattern | Status marker | Filename | Body shape |
|---|---|---|---|
| **CANCELLED** | `❌` | `RESOLUTION.md` | One-paragraph reason the premise was wrong + standing-by note. Example: `star-freight-canon-001/RESOLUTION.md` (canon didn't exist anywhere). |
| **COMPLETED** | `✅` | Paired `<RIG>-ACK-FINAL.md` on both sides, OR a single `RESOLUTION.md` if one author closes. | Final loss/gain footprint, what survived, what the bridge accomplished, standing-by. Example: `state-2026-04-29/5080-ACK-RECOVERY-FINAL.md`. |
| **DEFERRED** | `⏸` | Items parked in a body section titled "Open questions" or in a `⏸`-tagged queue list. Thread stays open. | Listed items with one-line rationale each, plus the trigger condition for resuming. |
| **ESCALATED** | `🎯` | `MIKE-DECISIONS.md` (or `<HUMAN>-DECISIONS.md`) | Numbered decisions on the open questions, plus status of related items. The escalation is in-band: the human's call lands in the thread, it doesn't bypass it. |

A thread with no terminal `RESOLUTION` or paired `-FINAL` ACKs is considered open. Tools MAY warn on threads idle past N days (out of scope for v1.0.0).

## 6. Body conventions (recommended, not schema-enforced)

The body is freeform markdown for v1.0.0. The schema does not validate it. The following conventions emerged in the corpus and are documented here so future authors can reach for them without re-deriving:

### 6.1 Header echo

The first markdown heading should restate the message's role in plain English (e.g. `# 5080-ACK-2 — repoint executed (Option A)`). This pairs the envelope with a human-readable headline.

### 6.2 Tables for inventory

Use markdown tables when the message conveys structured inventory: drives, repos, file manifests, loss/gain footprints, queue items. The corpus uses tables in every STATE, RESULT, and RECOVERY message.

### 6.3 "Corrections to <prior>" block

When a message answers a prior turn whose claims it must retract, include a body section titled "Corrections to <prior-message-name>" or "Corrections to <prior-doc>" with a per-claim list of what was wrong, what's right, and (where useful) the evidence.

Mistakes get **retracted, not silently overwritten**. The corpus enforces this by convention: see `MAC-RESPONSE.md` "Corrections to STATE.md and REQUEST.md" and `MAC-VERIFY-RECOVERY.md` "What this session got wrong".

### 6.4 "Standing by" sign-off

End messages that close the sender's lane (no further action queued from this side) with a one-line `Standing by.` (or `Standing by on this end.`). This is the convention that says *I have nothing more until the peer speaks*. Adopting it relieves the peer of guessing whether the sender is mid-edit.

Messages that explicitly continue a sequence (e.g. an opening REQUEST awaiting a HANDOFF) do not need the sign-off; the type carries the expectation.

### 6.5 Author attribution

The body MAY end with an em-dashed author line (`— Mac Claude`, `— 5080 Claude`, `— Mike (relayed)`). The envelope's `from` is authoritative; the body line is a human cue.

## 7. Out of scope for v1.0.0

The following are **deliberately not specified** so future readers don't try to extend the v1.0.0 envelope before friction shows up:

1. **Multi-rig (3+) topology.** Symmetric two-rig is the v1 model. The schema's open-membership rig-id slug pattern and `to`-as-array shape leave forward room (a third rig is just a third slug), but routing logic for 3+ is out of scope.
2. **Conflict resolution beyond git's append-only semantics.** v1 leans entirely on git for ordering. Concurrent commits resolve via standard rebase / merge; the envelope doesn't carry vector clocks or causality metadata.
3. **Auto-merge of `RunHandoff` messages from `multi-claude`.** For v1, `multi-claude`'s `RunHandoff` is the *envelope schema reference shape*, not an active integration. No adapter ships in v1.0.0.
4. **`RunHandoff → rig-bridge envelope` adapter.** Future work. The Schema Cross-Reference table in §9 is the derivation target for that adapter when it lands.
5. **Body schema validation.** Body is freeform markdown for v1.0.0. A v2 may introduce per-`type` body schemas (e.g. `HANDOFF.body.payload[]`); v1 does not.
6. **Cloud-hosted central queue.** Git remains the transport. The envelope is transport-agnostic so a future implementation could swap, but the v1 implementation is git.
7. **Encryption / signing beyond what GitHub provides.** The repo's GitHub permissions are the auth model for v1.
8. **Envelope versioning.** v1.0.0 deliberately omits a `version` field in the envelope frontmatter. Trade-off: a future v2 with breaking envelope-shape changes cannot be branched-on by readers — the schema bump is technically breaking. Acceptable in v1 because consumers are controlled (Mac + 5080 in the founding deployment), but **v1.1 should introduce `version: "1.1"` (default-optional, default-stamped on send) before any v2 design lands.** Logged as a known-future-decision (Mike, 2026-04-29 Phase 0 review acceptance) so the next reviewer doesn't rediscover this trade-off.

## 8. Worked example (validates against the schema)

The outer fence below uses four backticks so the nested triple-backtick code block inside the message body renders correctly on GitHub.

````markdown
---
from: windows-5080
to:
  - mac-m5max
  - mike-relay
display_name: 5080 Claude
date: 2026-04-29
status: ✅ Cutover complete. Old-repo archive unblocked.
type: ACK
thread: swarm-rig-bridge-001
references:
  - 9a3c4f2
tldr: E:\bridge\ repointed to scratch remote (Option A). f79731b dropped as expected. 5080 ready for Phase 0.
---

# 5080-ACK-2-REPOINTED — repoint executed (Option A)

Mike picked A. Repoint done.

## What ran

```bash
cd /e/bridge
git remote set-url origin https://github.com/mcp-tool-shop-org/rig-bridge-scratch.git
git fetch origin
git reset --hard origin/main   # f79731b dropped, expected
```

Standing by.

— 5080 Claude
````

This corresponds directly to `swarm-rig-bridge-001/5080-ACK-2-REPOINTED.md` in the source corpus, re-rendered into v1.0.0 frontmatter form. The corpus message used the display name `5080 Claude` in `from:`; v1.0.0 requires the canonical id `windows-5080` and surfaces the display name in the optional `display_name` field. The body heading echoes the filename including the `-REPOINTED` qualifier (per §2.3) so the message's role in the sequence is visible to readers who jump straight to the body.

## 9. Schema Cross-Reference (refined from the ARCHITECTURE.md seed table)

For each `RunHandoff` field cluster, this table records the v1.0.0 envelope's design decision: adopt name, adopt semantic, both, or neither — with a one-line reason. The future `RunHandoff → rig-bridge` adapter uses this as its derivation target.

| `RunHandoff` field cluster | rig-bridge envelope | Decision | Reason |
|---|---|---|---|
| `runId` | `thread` | adopt semantic, rename | `thread` is friendlier to humans authoring messages by hand; `runId` is multi-claude-internal vocabulary |
| `featureId`, `featureTitle` | (out of envelope) | neither | These belong to multi-claude's feature graph; rig-bridge threads aren't features. Future adapter sets `thread = featureId-runId-...` |
| `verdict` (HandoffVerdict) | `status` (verb-phrase + emoji) | adopt semantic, diverge on shape | corpus showed authors compressing nuance into status prose; a closed verdict enum would lose it |
| `reviewReadiness` | (folded into `status`) | neither | rig-bridge has no reviewer role distinct from peer; status conveys readiness implicitly |
| `summary` | `tldr` | adopt semantic, rename | `tldr` is the term the corpus actually used |
| `attemptedGoal` | (body §) | neither | belongs in REQUEST body, not envelope |
| `outcomeStatus` (RunOutcomeStatus) | `status` | adopt semantic, diverge on shape | same merge as verdict — single field with five-marker convention |
| `acceptable`, `acceptabilityReason` | (out of envelope) | neither | multi-claude review-flow concept; rig-bridge peer assesses inline |
| `contributions[]`, `totalContributions`, `landedContributions`, `failedContributions`, `recoveredContributions` | (out of scope v1.0.0) | neither | multi-claude operator-loop concept; future adapter only |
| `hasChangeEvidence`, `totalFilesChanged` | (out of scope v1.0.0) | neither | future adapter only |
| `interventions` (InterventionDigest) | (out of scope v1.0.0) | neither | future adapter only |
| `outstandingIssues[]`, `reviewBlockingIssues` | body §"Open questions" | adopt semantic only | corpus pattern is a body section, not envelope-level |
| `followUps[]` | body §"Standing by" + DEFERRED queue | adopt semantic only | same; body convention, not envelope |
| `evidenceRefs[]` | `references[]` (commit SHAs) | adopt semantic, diverge on shape | rig-bridge evidence is git commits, not multi-claude evidence records |
| `generatedAt` | `date` | adopt semantic, rename | `date` is shorter, ISO 8601 string carries timestamp resolution when needed |
| `elapsedMs` | (out of envelope) | neither | rig-bridge messages aren't run-scoped; not meaningful |
| (no `RunHandoff` equivalent) | `from`, `to` | introduce | rig-bridge specific — cross-rig addressing is the whole point |
| (no `RunHandoff` equivalent) | `type` (10-value enum) | introduce | message-class is rig-bridge's primary structuring axis |

**Net:** rig-bridge's envelope adopts ~5 `RunHandoff` semantics (renamed + reshaped to fit a markdown-frontmatter authoring flow), defers 9 to body conventions or future-adapter scope, and introduces 3 fields that have no `RunHandoff` analogue (`from`, `to`, `type`).

## 10. References

- Companion schema: `schemas/bridge-message.schema.json`
- Architectural decision (D2a-with-control-plane-bridge-glue): `ARCHITECTURE.md` §"D2 — schema ownership"
- Source corpus: `mcp-tool-shop-org/rig-bridge-scratch` — directories `star-freight-canon-001/`, `state-2026-04-29/`, `swarm-rig-bridge-001/`. The scratch repo holds the 14-commit pre-v1.0.0 corpus that this spec was derived from; the original archived repo (`mcp-tool-shop-org/rig-bridge`, archived) accumulated the broader 16-commit session that included scaffold turns not part of the envelope-design corpus — see `ARCHITECTURE.md` for the count reconciliation.
- Reference shape (read-only): `multi-claude/src/types/handoff.ts:176-224` — `RunHandoff` interface
