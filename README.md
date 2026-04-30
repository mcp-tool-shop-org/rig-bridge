# rig-bridge

> **Status:** pre-swarm scaffold (v0.0.1-pre-swarm). The full README ships in Phase 10 (Full Treatment) of the dogfood swarm. This placeholder exists so the repo is navigable while the swarm builds the tool.

Cross-rig sync tool for paired dev machines — git-native typed-envelope cross-agent handoffs.

## What it will be

A CLI + engine library that lets two (or more) Claude instances on different machines coordinate via a shared git repo, using a typed-envelope protocol that survived first contact in a 16-commit organic session between a Mac and a Windows GPU rig on 2026-04-29.

The protocol owns its own envelope (transport-agnostic) and writes through `swarm-control-plane`'s SQLite as the truth layer. Git is the cross-rig wire.

## What's here today

- `package.json` — npm package skeleton (`@mcptoolshop/rig-bridge`)
- `src/cli.ts` — stub entrypoint (`--version`, `--help` only)
- `ARCHITECTURE.md` — D2a-with-control-plane-bridge-glue decision + Schema Cross-Reference seed for Phase 0
- `SHIP_GATE.md` — 31-item shipcheck (will be filled phase-by-phase)
- `.github/workflows/ci.yml` — paths-gated skeleton

The actual surface (8 commands: `init`, `new`, `send`, `close`, `status`, `thread`, `sync`, `relay`) ships in Phases 6–8.

## License

MIT — see [LICENSE](LICENSE).
