<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/rig-bridge/readme.png" width="400" alt="rig-bridge" />
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/rig-bridge/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/rig-bridge/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://mcp-tool-shop-org.github.io/rig-bridge/"><img src="https://img.shields.io/badge/landing-page-2563eb" alt="Landing Page" /></a>
</p>

> **Status:** Phase 7 (Feature Execution Wave 2) landed. v1.0.0 transport surface: **8 of 8 CLI commands implemented** (init / new / send / close / status / thread / sync / relay). The transport surface is complete; v1.1 picks up control-plane integration.

Cross-rig sync tool for paired dev rigs — git-native typed-envelope cross-agent handoffs.

## What's here today

**v1.0.0 transport surface complete:**

All 8 v1.0.0 CLI commands plus the engine helpers behind them. v1.0.0 ships the git transport on its own — control-plane integration is deferred to v1.1 (Path B-2; see [docs/v1.1-roadmap.md](docs/v1.1-roadmap.md)).

Authoring commands:

- `rig-bridge init` — initialize the local clone, install the commit-message hook, and write `.bridge/config.yaml` with this rig's canonical id
- `rig-bridge new <thread-id>` — scaffold `<thread-id>/REQUEST.md` from the envelope template, frontmatter pre-filled
- `rig-bridge send <type> --thread <id>` — write a typed envelope, validate against the schema, compute body_hash, derive status_class from the marker, then `git commit && git push`
- `rig-bridge close <thread-id> --status <cancelled|completed>` — write `RESOLUTION.md`, commit, push

Inspection commands:

- `rig-bridge status` — list open threads with last activity, status class, type, and dirty state; `--json` + `--wide` opt-ins
- `rig-bridge thread <id>` — render the full envelope transcript for a thread (small-multiples layout, chronological asc, auto-paged on TTY)

Sync + attestation commands:

- `rig-bridge sync` — fast-forward pull with divergence surfacing (refuses non-FF without `--auto`; surfaces named divergence at the sync boundary per Fossil-style semantics)
- `rig-bridge relay <type> --thread <id> --in-reply-to <hash>` — human-attested DECISIONS/RESPONSE/ACK turn (requires a `-relay` rig-id suffix + git signing key configured; emits an attestation block with `attested_by` + `attested_at` + ULID `nonce`)

Engine helpers (in `src/engine/`):

- `envelope.ts` — YAML frontmatter parse/render
- `schema-validator.ts` — Ajv-backed validation against `schemas/bridge-message.schema.json`
- `body-hash.ts` — SHA-256 over the §4.1-normalized body (BOM strip, CRLF→LF, trailing-whitespace trim, exactly-one terminal newline)
- `status.ts` — marker → status_class derivation per §4.2 (`▶ active`, `⏸ pending`, `🎯 targeted`, `✅ completed`, `❌ cancelled`)
- `rig-id.ts` — canonical kebab-case rig id validation at CLI ingress
- `git.ts` — git wrapper with submodule, size, and OS-junk guards
- `config.ts` — `.bridge/config.yaml` reader/writer
- `list-threads.ts` — enumerate open threads from the working tree (for `status`)
- `peers.ts` — `findPeerRigs` — discover canonical peer rig-ids from envelope history (replaces inline `inferPeerRig`)
- `git-diff.ts` — `gitDiffSinceLastSync` — surface new files since the last successful pull (sync engine)
- `hash-verify.ts` — `verifyHash` — recompute and compare body_hash for `in_reply_to` chain integrity (relay engine)
- `envelope-file.ts` — `validateEnvelopeFile` — parse + schema-validate a file path in one call (shared by `thread`, `sync`, `relay`)

**Phase 0 deliverables (still authoritative):**

- `docs/envelope-spec.md` — canonical envelope spec rig-bridge owns (transport-agnostic frontmatter + body contract)
- `schemas/bridge-message.schema.json` — JSON Schema 2020-12 for envelope frontmatter (validation source of truth)
- `docs/control-plane-integration.md` — writes-through design against `swarm-control-plane`'s SQLite (forward-design; v1.1 surface)
- `docs/v1.1-roadmap.md` — what v1.1 picks up: control-plane writes, the open questions surfaced by the Phase 7 study swarm, and the parked review-surface questions
- `docs/cli-contract.md` — stable CLI surface contract (stdout/stderr, `--json` schema, exit codes, env vars)
- `ARCHITECTURE.md` — D2a-with-control-plane-bridge-glue decision + Schema Cross-Reference

## Installation

### From npm (v1.0.0+)

```bash
npm install -g @mcptoolshop/rig-bridge
```

### From source

```bash
git clone https://github.com/mcp-tool-shop-org/rig-bridge.git
cd rig-bridge
npm install
npm run build
npm link   # adds the rig-bridge command to your PATH
```

### Verify

```bash
rig-bridge --version
```

This should print the version recorded in `package.json`.

### Supported runtimes

- **Node:** `>= 20.11.0` (per `package.json` `engines.node`)
- **npm:** `>= 10.0.0` (bundled with Node `>= 20.11.0`)

### Supported platforms

macOS, Linux, and Windows 10+ — all three are exercised by CI on every push.

## What it will be

A CLI + engine library that lets two (or more) Claude instances on different rigs coordinate via a shared git repo, using a typed-envelope protocol that survived first contact in a 16-commit organic session between a Mac and a Windows GPU rig on 2026-04-29.

v1.0.0 ships all 8 commands as the transport. v1.1 adds control-plane integration so the envelope writes through to `swarm-control-plane`'s SQLite as the durable truth layer — see [docs/v1.1-roadmap.md](docs/v1.1-roadmap.md).

The protocol owns its own envelope (transport-agnostic). Git is the cross-rig wire; in v1.1 control-plane becomes the durable state.

## CLI contract

rig-bridge follows the [clig.dev](https://clig.dev/) doctrine: stdout is data, stderr is narrative, `--json` is the pinned stability contract. See [`docs/cli-contract.md`](docs/cli-contract.md) for the full specification — output discipline, the `--json` schema (`schema_version: "1.0"`), per-command stdout shapes, exit codes, and environment variables.

### Example usage

```bash
# Initialize the local clone on the GPU rig
rig-bridge init

# Open a new thread and send a typed REQUEST envelope
rig-bridge new bridge-onboarding-01
rig-bridge send REQUEST --thread bridge-onboarding-01

# Glance at what's open across all threads
rig-bridge status

# Pull from the peer rig (fast-forward only by default)
rig-bridge sync
```

For scripted consumers, every command accepts `--json`:

```bash
rig-bridge status --json | jq '.threads[] | select(.dirty == true)'
```

## Security & data

- **Data touched:** the local clone of the bridge repo + `.bridge/config.yaml` (rig identifier + optional display_name) + message files (markdown with YAML frontmatter). No database. No telemetry endpoints.
- **Network egress:** only to the configured git remote (GitHub via HTTPS by default). No other network access.
- **Permissions required:** read/write access to the local bridge repo and `.bridge/` directory; git credentials for push (delegated to the operator's existing git config).
- **No telemetry by default** — rig-bridge does not collect, transmit, or persist any usage data. The only data that leaves the local machine is the commits the operator explicitly pushes.
- **Trust model:** rig-bridge trusts GitHub TLS for transport integrity and trusts the local git config for authorship. The `init`, `new`, `send`, `close`, `status`, `thread`, and `sync` commands do not sign commits themselves; operators can layer GPG/SSH commit signing via existing git mechanisms. The `relay` command is the exception — it **requires** a configured git signing key (refuses unsigned by design, per the human-attested gateway model) and records the signer's identity in the envelope's `attested_by` field.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and supported versions.

## License

MIT — see [LICENSE](LICENSE).

---

<p align="center">
  Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
</p>
