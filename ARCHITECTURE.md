# rig-bridge — Architecture

> **Status:** pre-swarm scaffold. The Envelope Spec (Phase 0 deliverable) is the next artifact to land. This document records the architectural decisions made during the 2026-04-29 research swarm + Phase 1/2 of the dogfood swarm; details are filled in by Phase 0.

## Origin

`rig-bridge` was a private scratch repo (`mcp-tool-shop/rig-bridge`, archived) accumulated 16 commits forming an emergent cross-rig handoff protocol during a single 2026-04-29 session between a Mac (M5 Max) and a Windows GPU rig (5080). A 4-agent research swarm produced a comprehensive handoff document. The Phase 1/2 dogfood swarm pass refined two decisions before any code landed:

1. **D2 — schema ownership** — flipped from D2c (adopt multi-claude `RunHandoff`) to **D2a-with-control-plane-bridge-glue**.
2. **Wave 1 reframe** — first wave is a design wave (Phase 0), not a schema-adoption wave.

## D2 — schema ownership: D2a-with-control-plane-bridge-glue

**rig-bridge owns its envelope.** The envelope is minimal, transport-agnostic (git-as-queue is one impl, but not the only one), and generic over rigs / sessions / payload kinds.

**multi-claude `RunHandoff` is reference shape only, not parent.** It lives at [multi-claude/src/types/handoff.ts:176-224](https://github.com/mcp-tool-shop-org/multi-claude/blob/main/src/types/handoff.ts#L176-L224) and is tightly coupled to multi-claude's runtime — `RunOutcomeStatus`, `InterventionSummary`, hook-state derivation, audit-trail queries — and is internal-only (not in any public package export). Adopting the type would require vendoring multi-claude's operator loop. Don't import it; survey the field list, then design rig-bridge's envelope from first principles.

**`swarm-control-plane` is the SQLite truth layer.** Control-plane (at `dogfood-lab/testing-os/packages/dogfood-swarm/`, with bridge glue inherited from `dogfood-labs/tools/swarm/lib/domains.js:326-333`) already has a `bridge` domain class for single-machine coordination. rig-bridge becomes the cross-rig **transport** that writes through control-plane SQLite. Git is the cross-rig wire; control-plane is the durable state.

### Schema Cross-Reference (seed for Phase 0 derivation)

The Phase 0 envelope design wave should survey these field clusters from `RunHandoff` and decide, per field, whether rig-bridge's envelope adopts the name, the semantic, both, or neither. Where a divergence is intentional, document the reason here so the future `RunHandoff → rig-bridge envelope` adapter has a derivation target.

| RunHandoff field cluster | rig-bridge envelope candidate | Notes |
|---|---|---|
| `runId`, `featureId`, `featureTitle` | `thread`, `subject` | rig-bridge thread = arbitrary identifier |
| `verdict`, `reviewReadiness` | `status` (enum) | poor-man's enum already observed in 14-commit corpus |
| `summary`, `attemptedGoal`, `outcomeStatus` | `tldr`, body | freeform body for v1.0.0 |
| `contributions[]`, total/landed/failed/recovered | (out of scope v1.0.0) | future adapter only |
| `interventions` (InterventionDigest) | (out of scope v1.0.0) | future adapter only |
| `outstandingIssues[]`, `reviewBlockingIssues` | body section convention | not envelope-level for v1.0.0 |
| `followUps[]` | body section convention | not envelope-level for v1.0.0 |
| `generatedAt`, `elapsedMs` | `date` | ISO 8601 |
| (no equivalent) | `from`, `to` | rig-bridge specific — cross-rig addressing |
| (no equivalent) | `type` | message-class enum (REQUEST / HANDOFF / RESPONSE / ACK / RESOLUTION / STATE / RESULT / RECOVERY / VERIFY / DECISIONS) |
| (no equivalent) | `references[]` | commit SHAs of prior turns |

The Phase 0 deliverable will reconcile this seed table against actual usage in the 14-commit corpus from the original session and produce `docs/envelope-spec.md` + `schemas/bridge-message.schema.json`.

## Wave 1 reframe — Phase 0 Envelope Design Wave

Original handoff implied Wave 1 = "schema spike, adopt RunHandoff." Corrected: **Phase 0 (Envelope Design Wave)** precedes Health Pass Stage A.

Phase 0 deliverables:
- `docs/envelope-spec.md` — minimal envelope spec rig-bridge owns
- `schemas/bridge-message.schema.json` — JSON Schema skeleton
- `docs/control-plane-integration.md` — how rig-bridge writes through `swarm-control-plane` SQLite

Phase 0 surveys: RunHandoff (reference shape only), git-trailers, JSON-Schema conventions, JSONL-event conventions.

## Out of scope for v1.0.0

- Multi-rig (3+) topology — symmetric two-rig is the v1 model
- Conflict resolution beyond git's append-only semantics
- Web UI — defer indefinitely; CLI + Starlight handbook is sufficient
- `RunHandoff → rig-bridge envelope` adapter — future work, the Schema Cross-Reference above is the derivation target
- Cloud-hosted central queue — git remains the transport
- Plugin system — premature
- Encryption beyond what GitHub provides — v1 trusts GitHub

## References

- Source-of-truth handoff doc (with Corrections 2026-04-29 block): the handoff memory file in this workspace
- Phase 0 plan + wave dispatch sequence: `/Users/michaelfrilot/.claude/plans/rig-bridge-dogfood-handoff-2026-04-29-m-sharded-pie.md`
- Swarm protocol: `/Volumes/T9-Shared/AI/dogfood-lab/testing-os/swarms/PROTOCOL.md`
