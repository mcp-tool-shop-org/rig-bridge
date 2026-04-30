# rig-bridge

> **Status:** post-Phase-0 (envelope spec + schema + control-plane integration design landed). Phase 1 audit complete; Phase 3 amend in progress. The full README ships in Phase 10 (Full Treatment) of the dogfood swarm.

Cross-rig sync tool for paired dev rigs — git-native typed-envelope cross-agent handoffs.

## What it will be

A CLI + engine library that lets two (or more) Claude instances on different rigs coordinate via a shared git repo, using a typed-envelope protocol that survived first contact in a 16-commit organic session between a Mac and a Windows GPU rig on 2026-04-29.

The protocol owns its own envelope (transport-agnostic) and writes through `swarm-control-plane`'s SQLite as the truth layer. Git is the cross-rig wire.

## What's here today

**Phase 0 deliverables (landed):**

- `docs/envelope-spec.md` — canonical envelope spec rig-bridge owns (transport-agnostic frontmatter + body contract)
- `schemas/bridge-message.schema.json` — JSON Schema 2020-12 for envelope frontmatter (validation source of truth)
- `docs/control-plane-integration.md` — writes-through design against `swarm-control-plane`'s SQLite

**Scaffold structure (Phase 6+ fills these in):**

- `package.json` — npm package skeleton (`@mcptoolshop/rig-bridge`)
- `src/cli.ts` — stub entrypoint (`--version`, `--help` only)
- `ARCHITECTURE.md` — D2a-with-control-plane-bridge-glue decision + Schema Cross-Reference seed for Phase 0
- `SHIP_GATE.md` — 31-item shipcheck (will be filled phase-by-phase)
- `.github/workflows/ci.yml` — paths-gated skeleton

The actual surface (8 commands: `init`, `new`, `send`, `close`, `status`, `thread`, `sync`, `relay`) ships in Phases 6–8.

## License

MIT — see [LICENSE](LICENSE).
