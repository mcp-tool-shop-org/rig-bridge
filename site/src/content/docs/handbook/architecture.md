---
title: Architecture
description: Design decisions, the Phase 7 study-swarm grounding, and the v1.1 control-plane integration roadmap.
sidebar:
  order: 4
---

`rig-bridge` v1.0.0 is the **transport** layer. v1.1 layers durable state via `swarm-control-plane` SQLite write-through. This page records the architectural decisions and the empirical evidence they're grounded in.

## D2a — rig-bridge owns its envelope

The envelope is **minimal, transport-agnostic, and generic over rigs / sessions / payload kinds**. Git-as-queue is one transport; in v1.1 control-plane SQLite becomes the durable state, but the envelope shape stays put.

The Phase 0 design wave considered adopting [multi-claude](https://github.com/mcp-tool-shop-org/multi-claude)'s `RunHandoff` type as the envelope. Decision: **reference shape only, not parent.** `RunHandoff` is internal to multi-claude's runtime (hook-state derivation, audit-trail queries, `RunOutcomeStatus`) and is not in any public export. Adopting it would have vendored multi-claude's operator loop. Instead: survey the fields, design from first principles, document the cross-reference for a future adapter.

See [`ARCHITECTURE.md`](https://github.com/mcp-tool-shop-org/rig-bridge/blob/main/ARCHITECTURE.md) for the full design and the 18-row Schema Cross-Reference.

## Layer split

| Layer | Files | Role |
|-------|-------|------|
| **Schema** | `schemas/bridge-message.schema.json` | The validation source of truth. Envelope frontmatter MUST validate. |
| **Engine** | `src/engine/*.ts` | Pure-ish helpers: envelope parse/render, body_hash, status_class derivation, schema validation, git wrappers, config I/O, thread + peer + diff + verify helpers. Exported via `src/engine/index.ts` for v1.1 control-plane consumers. |
| **Commands** | `src/commands/*.ts` | The 8 v1.0.0 CLI commands. Each composes engine helpers + emits the stable stdout contract. |
| **CLI** | `src/cli.ts` | `parseArgs` + dispatch + signal handlers + startup-trace + `loadPackageVersion`. |

## Phase 7 study swarm — architectural locks

The Phase 7 design wave (study-swarm, 2026-05-15) produced 32 cited findings and 16 architectural locks (L1–L16). The full bibliography and per-finding implications live in [`phase7-research-grounding.md`](https://github.com/mcp-tool-shop-org/rig-bridge/blob/main/docs/architecture/phase7-research-grounding.md). The locks that bind v1.0.0 behavior:

### Sync semantics (L1–L4)

- **L1.** Auto-resolve only fast-forward. Anything else refuses + surfaces. *(Owhadi-Kareshk 2019; Tao 2021)*
- **L2.** Envelopes are append-only with stable IDs. Dedupe by filename; never content-merge two envelopes. *(Kafka idempotent producer; NATS JetStream)*
- **L3.** Preserve causal order via `references[]` SHA chain. Concurrent envelopes = NAMED divergence, not LWW. *(Sun et al. 1998 OT intention preservation; Fossil Sync Protocol)*
- **L4.** Surface everything at the sync boundary — the operator just typed `sync`, the cheapest moment to disclose divergence. *(Iqbal & Horvitz 2007 task-boundary surfacing)*

### Relay attestation (L5–L9)

- **L5.** Relay rig-id MUST end in `-relay`. A relay rig-id is a distinct identity class. *(IETF Cross-Device Flows draft; Signal safety-numbers)*
- **L6.** Commit author MUST be operator's git config (`user.name` / `user.email`), not bridge-default. *(Sigstore gitsign 2024)*
- **L7.** Envelope frontmatter MUST carry `attested_by` + `attested_at` + `nonce`. *(DIDComm v2.1 authcrypt)*
- **L8.** Relay carries `in_reply_to: <body-hash>` of the prior turn — replay prevention. *(Packetlabs replay-attack guide)*
- **L9.** Relay refuses if no signing key is configured. No soft-fail — silent insecurity is the documented worst case. *(Apple iMessage Contact Key Verification)*

### Status + transcript rendering (L10–L13)

- **L10.** `status` default = 4–5 columns. Recency-desc sort. Color reserved for state (red dirty / yellow unpushed / green clean). *(Miller 1956 / Cowan 2001 working memory; Hick-Hyman)*
- **L11.** `--wide` opt-in adds 3 columns. Single disclosure level — no third tier. *(Nielsen 2006 progressive disclosure)*
- **L12.** `thread <id>` uses small-multiples: identical frontmatter-header + body block per envelope. *(Tufte 1983/1990)*
- **L13.** Auto-page via `$PAGER less -FIRX` when output > terminal height AND stdout is TTY. *(clig.dev)*

### CLI composability (L14–L16)

- **L14.** stdout = data, stderr = narrative. Locked in Stage C; extends to all 8 commands. *(clig.dev / POSIX)*
- **L15.** `--json` is opt-in; every object carries `schema_version: "1.0"` (kubectl-style explicit version). Default text may evolve; `--json` shape is pinned. *(kubectl conventions; gh CLI manual)*
- **L16.** `--watch` modes emit NDJSON (one JSON object per line, no outer array, no pretty-print). *(ndjson.org)*

## Open questions

The study swarm surfaced four open questions that v1.0.0 does NOT close empirically:

- **OQ1.** rig-bridge's low-volume async regime (1–10 envelopes/day, 2–4 rigs) is unstudied. v1.0.0 defaults to "always surface non-FF"; v1.1 may relax with empirical evidence.
- **OQ2.** AI racing human relay: rig A's AI keeps acting while operator types `relay` on rig B. Mitigation candidate: a "thread-frozen-pending-relay" state. Defer to v1.0.1 implementation slice.
- **OQ3.** `--output={text,json,ndjson}` triad vs binary `--json` flag. v1.0.0 ships binary `--json`; NDJSON when `--watch` is added.
- **OQ4.** No eye-tracking study specifically measures CLI table scanning. The 5-column cap is extrapolated from dashboard + working-memory studies.

## v1.1 roadmap

The next slice is **control-plane integration** — write-through to `swarm-control-plane`'s SQLite at the moment of `send` / `close` / `sync` / `relay`. The envelope itself stays unchanged; v1.1 adds an additional write target. The trigger condition (testing-os schema bumps with `bridge_messages` + `bridge_message_events` tables landed) is documented in [`docs/v1.1-roadmap.md`](https://github.com/mcp-tool-shop-org/rig-bridge/blob/main/docs/v1.1-roadmap.md).
