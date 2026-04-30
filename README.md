# rig-bridge

> **Status:** Phase 6 (Feature Execution Wave 1) landed. v1.0.0 transport surface: 4 of 8 CLI commands implemented (init / new / send / close). Phase 7 ships the remaining 4 (status / thread / sync / relay) plus engine library extraction.

Cross-rig sync tool for paired dev rigs — git-native typed-envelope cross-agent handoffs.

## What's here today

**v1.0.0 transport (Phase 6 landed):**

The first 4 CLI commands plus the engine helpers behind them. v1.0.0 ships the git transport on its own — control-plane integration is deferred to v1.1 (Path B-2; see [docs/v1.1-roadmap.md](docs/v1.1-roadmap.md)).

- `rig-bridge init` — initialize the local clone, install the commit-message hook, and write `.bridge/config.yaml` with this rig's canonical id
- `rig-bridge new <thread-id>` — scaffold `<thread-id>/REQUEST.md` from the envelope template, frontmatter pre-filled
- `rig-bridge send <type> --thread <id>` — write a typed envelope, validate against the schema, compute body_hash, derive status_class from the marker, then `git commit && git push`
- `rig-bridge close <thread-id> --status <cancelled|completed>` — write `RESOLUTION.md`, commit, push

Engine helpers (in `src/engine/`):

- `envelope.ts` — YAML frontmatter parse/render
- `schema-validator.ts` — Ajv-backed validation against `schemas/bridge-message.schema.json`
- `body-hash.ts` — SHA-256 over the §4.1-normalized body (BOM strip, CRLF→LF, trailing-whitespace trim, exactly-one terminal newline)
- `status.ts` — marker → status_class derivation per §4.2 (`▶ active`, `⏸ pending`, `🎯 targeted`, `✅ completed`, `❌ cancelled`)
- `rig-id.ts` — canonical kebab-case rig id validation at CLI ingress
- `git.ts` — git wrapper with submodule, size, and OS-junk guards
- `config.ts` — `.bridge/config.yaml` reader/writer

**Phase 0 deliverables (still authoritative):**

- `docs/envelope-spec.md` — canonical envelope spec rig-bridge owns (transport-agnostic frontmatter + body contract)
- `schemas/bridge-message.schema.json` — JSON Schema 2020-12 for envelope frontmatter (validation source of truth)
- `docs/control-plane-integration.md` — writes-through design against `swarm-control-plane`'s SQLite (forward-design; v1.1 surface)
- `docs/v1.1-roadmap.md` — what v1.1 picks up: control-plane writes, the remaining 4 commands' richer behaviors, and the parked review-surface questions
- `ARCHITECTURE.md` — D2a-with-control-plane-bridge-glue decision + Schema Cross-Reference

## What it will be

A CLI + engine library that lets two (or more) Claude instances on different rigs coordinate via a shared git repo, using a typed-envelope protocol that survived first contact in a 16-commit organic session between a Mac and a Windows GPU rig on 2026-04-29.

v1.0.0 ships these 4 commands as the transport. Phase 7 adds 4 more (`status`, `thread`, `sync`, `relay`). v1.1 adds control-plane integration so the envelope writes through to `swarm-control-plane`'s SQLite as the durable truth layer — see [docs/v1.1-roadmap.md](docs/v1.1-roadmap.md).

The protocol owns its own envelope (transport-agnostic). Git is the cross-rig wire; in v1.1 control-plane becomes the durable state.

## License

MIT — see [LICENSE](LICENSE).
