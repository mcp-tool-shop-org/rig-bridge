# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-05-15

### Added

- **4 new v1.0.0 CLI commands** — Phase 7 closes the v1.0.0 transport surface (8 of 8 commands shipped):
  - `rig-bridge status` — list open threads with status/type/dirty state; `--json` + `--wide` opt-ins (architectural locks L10, L11)
  - `rig-bridge thread <id>` — render the full envelope transcript for a thread (small-multiples layout, chronological asc, auto-paged on TTY) (L12, L13)
  - `rig-bridge sync` — fast-forward pull with divergence surfacing (refuses non-FF without `--auto`; Fossil-style named divergence at the sync boundary) (L1, L2, L3, L4)
  - `rig-bridge relay <type> --thread <id> --in-reply-to <hash>` — human-attested DECISIONS/RESPONSE/ACK turn (requires `-relay` rig-id suffix + git signing key; emits attestation block with `attested_by` + `attested_at` + ULID `nonce`) (L5, L6, L7, L8, L9)
- **5 new engine helpers** (foundation for v1.1 control-plane integration):
  - `listThreads` — enumerate open threads from the working tree
  - `findPeerRigs` — discover canonical peer rig-ids from envelope history
  - `gitDiffSinceLastSync` — surface new files since the last successful pull
  - `verifyHash` — recompute and compare body_hash for `in_reply_to` chain integrity
  - `validateEnvelopeFile` — parse + schema-validate an envelope file in one call
- **Stable CLI contract** documented in [`docs/cli-contract.md`](docs/cli-contract.md):
  - stdout/stderr split (stdout = data, stderr = narrative) — L14
  - `--json` opt-in for every command with top-level `"schema_version": "1.0"` (kubectl-style explicit version) — L15
  - Documented per-command stdout shapes (text + JSON), exit codes (0/1/2/130/143), environment variables (`DEBUG_RIG_BRIDGE`, `NO_COLOR`, `RIG_BRIDGE_NO_PAGER`, `PAGER`)
- **Cross-rig E2E tests** + **subprocess CLI tests** — the load-bearing scenarios for a cross-rig sync tool now have direct test coverage.

### Changed

- **README** — "What's here today" updated to reflect 8 of 8 commands shipped; status line moved from "Phase 6 landed" to "Phase 7 landed, v1.0.0 transport surface complete"; new "CLI contract" section with example usage links to [`docs/cli-contract.md`](docs/cli-contract.md).
- **`close.ts`** — refactored to use the new `findPeerRigs` engine helper (replaces the inline `inferPeerRig` implementation; behavior preserved, helper is now shared with `sync` and `relay`).

### Architecture grounded in (study-swarm 2026-05-15)

The 4 new commands' architectural locks (L1-L16) trace to 32 cited findings across four design questions:

- **Sync conflict semantics (L1-L4):** Horvitz 1999 (mixed-initiative principles); Iqbal & Horvitz 2007 (task-boundary surfacing, ~10min vs ~20-25min recovery); Owhadi-Kareshk 2019 (1-in-5 OSS merges conflict, 26× bug rate); Tao 2021 (Microsoft program merge); Kleppmann 2022 (Peritext CRDT trade-offs); Sun 1998 (OT intention preservation); Fossil Sync Protocol (named-fork surfacing).
- **Relay attestation (L5-L9):** Sigstore gitsign 2024 (OIDC + Rekor); DIDComm v2.1 (authcrypt + DID document); IETF Cross-Device Flows draft 2024 (consumption ↔ authorization channel unauthenticated by default); Signal safety-numbers (human-verification requirement); Apple iMessage CKV 2023 (transparency-log inclusion proofs); infodas + Glasswall 2023/2024 (cross-domain solution doctrine).
- **Status/transcript render (L10-L13):** Miller 1956 / Cowan 2001 (working memory ≈ 4 chunks); Nielsen 2006 (progressive disclosure 2-tier limit); Hick-Hyman (decision time log(N), restored by sort); Tufte (small multiples, data-ink ratio); Long et al. 2024 (dashboard-overload at 9+ modules).
- **Composability (L14-L16):** [clig.dev](https://clig.dev/) (stdout/stderr discipline, `--json` opt-in contract); kubectl conventions (explicit `schema_version`); [no-color.org](https://no-color.org/) (NO_COLOR presence-only); NDJSON spec; gh CLI manual (field projection).

Full research grounding: `phase7-research-grounding.md` in the swarm artifacts.

## [0.1.0-phase-6] - 2026-04-30

### Added

- **CLI commands (4 of 8 v1.0.0 surface):**
  - `rig-bridge init` — initialize a local bridge clone, install commit-message hook, write `.bridge/config.yaml` with the canonical rig id
  - `rig-bridge new <thread-id>` — scaffold `<thread-id>/REQUEST.md` from the envelope template
  - `rig-bridge send <type> --thread <id>` — write a typed envelope, validate, body_hash, derive status_class, `git commit && git push`
  - `rig-bridge close <thread-id> --status <cancelled|completed>` — write `RESOLUTION.md`, commit, push
- **Engine helpers (in `src/engine/`):**
  - YAML frontmatter parse/render (`envelope.ts`)
  - Ajv-backed schema validation against `schemas/bridge-message.schema.json` (`schema-validator.ts`)
  - SHA-256 `body_hash` over the §4.1-normalized body — BOM strip, CRLF→LF, trailing-whitespace trim, exactly-one terminal newline (`body-hash.ts`)
  - Marker → `status_class` derivation per `docs/control-plane-integration.md` §4.2: `▶ active`, `⏸ pending`, `🎯 targeted`, `✅ completed`, `❌ cancelled` (`status.ts`)
  - Canonical kebab-case rig-id validation at CLI ingress, not just at the schema layer (`rig-id.ts`)
  - Git wrapper with submodule guard (refuses gitlinks — the `681c054` regression case from the original 14-commit corpus), size warn-on-stderr at 25 MB, and OS-junk strip (`.DS_Store`, `._*`, `Thumbs.db`) (`git.ts`)
  - `.bridge/config.yaml` reader/writer (`config.ts`)
- Vitest test coverage for each command and each engine helper plus a round-trip smoke test (init → new → send → close).

### Changed

- **README** — replaced the "what it will be" framing with concrete v1.0.0 transport surface; status line now reflects Phase 6 landed.

### Deferred

- **Path B-2 — control-plane integration deferred to v1.1.** v1.0.0 ships the git transport without writing through to `swarm-control-plane`'s SQLite. The marker→status_class derivation and §4.1 body-hash normalization are implemented as helpers and exercised by tests, but no `bridge_messages` / `bridge_message_events` writes occur. See `docs/v1.1-roadmap.md`.
- **3 v1.1 review-surface questions** — `tldr` 280-char enforcement vs warn vs skip, multi-recipient `--to` flag shape, `display_name` Unicode rendering. See the wave-3 backend `requires_decision` block (`/Volumes/T9-Shared/AI/dogfood-lab/testing-os/swarms/swarm-1777510208-621a/wave-3/backend.json`) for the provisional choices and the case for the alternatives.
- Remaining 4 v1.0.0 commands (`status`, `thread`, `sync`, `relay`) ship in Phase 7 with the engine library extraction.
