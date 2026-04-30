# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

### Fixed

### Changed

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
