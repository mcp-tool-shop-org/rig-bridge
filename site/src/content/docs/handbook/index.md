---
title: Welcome
description: rig-bridge — cross-rig sync tool for paired dev machines. Git-native typed-envelope cross-agent handoffs.
sidebar:
  order: 0
---

**rig-bridge** is a CLI + engine library that lets two (or more) dev rigs exchange typed messages through a shared git repo. It started as an emergent 16-commit protocol between a Mac and a Windows GPU rig on 2026-04-29 and shipped as `v1.0.0` with eight commands, schema-validated envelopes, cross-rig drift detection, and a refuse-non-fast-forward sync that never silently merges.

## What rig-bridge is

| | |
|---|---|
| **Transport** | An append-only git repo that both rigs clone. Commits are the wire; envelopes are markdown files with YAML frontmatter. |
| **Envelope** | One YAML frontmatter block (validated against `schemas/bridge-message.schema.json`) plus a markdown body. The frontmatter carries `from`, `to`, `type`, `thread`, `status`, `body_hash`, and—for `relay` turns—an attestation block. |
| **Drift detection** | Every envelope carries a SHA-256 `body_hash` over the §4.1-normalized body (CRLF→LF, trim trailing whitespace, exactly-one terminal newline, BOM strip). Receivers re-hash on read; any drift is provable, not hopeful. |
| **Sync** | Fast-forward auto-resolves; anything else refuses + surfaces. The operator decides — silent merges are the documented worst case in the cross-rig literature. |
| **Relay** | Human-in-the-loop turns are first-class. `rig-bridge relay` requires a `-relay` rig-id suffix AND a configured git signing key. The envelope's `attested_by` + `attested_at` + `nonce` + `in_reply_to` block is the audit trail. |

## Who rig-bridge is for

- Anyone running paired dev rigs (Mac + Windows GPU, two cloud boxes, an air-gapped pair) and tired of pasting context into chat windows.
- Anyone with two LLM agents that need a turn-by-turn protocol with provable integrity.
- Anyone who wants a cross-machine async messaging tool whose contract is *files in a git repo* — no servers, no databases, no telemetry.

## What's next

- **[Getting started](./getting-started/)** — install rig-bridge and run your first cross-rig round-trip.
- **[Usage](./usage/)** — the eight commands and how they compose.
- **[Reference](./reference/)** — envelope shape, CLI contract, exit codes, environment variables.
- **[Architecture](./architecture/)** — design decisions, the Phase 7 study-swarm grounding, the v1.1 control-plane integration roadmap.
