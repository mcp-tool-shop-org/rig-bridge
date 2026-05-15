---
title: Getting started
description: Install rig-bridge and run your first cross-rig round-trip.
sidebar:
  order: 1
---

## Install

```bash
npm install -g @mcptoolshop/rig-bridge
rig-bridge --version  # → 1.0.0
```

From source:

```bash
git clone https://github.com/mcp-tool-shop-org/rig-bridge.git
cd rig-bridge
npm install
npm run build
npm link
```

**Supported runtimes:** Node `>= 20.11.0`, npm `>= 10.0.0`.
**Supported platforms:** macOS, Linux, Windows 10+.

## Prerequisites

You need:

1. **A shared git repo** that both rigs can push to. GitHub, Gitea, a bare repo on a third box — anything with a URL.
2. **Git** on PATH (>= 2.28 for the `git init -b main` semantics rig-bridge uses).
3. **Two clones** of that shared repo — one per rig.

A typical layout:

```
~/bridge/                # local clone on rig A
~/bridge/                # local clone on rig B (different machine)
github.com/<you>/bridge  # the shared remote both clones push to
```

## First cross-rig round-trip

### On rig A (e.g. `mac-m5max`)

```bash
cd ~/bridge
rig-bridge init --rig-id mac-m5max
# → rig-bridge: init OK rig-id=mac-m5max root=bridge
```

`init` writes `.bridge/config.yaml` with the canonical rig id and installs a commit-message hook that fingerprints commits with the rig id.

```bash
rig-bridge new bridge-onboarding-01
# → rig-bridge: scaffolded type=REQUEST thread=bridge-onboarding-01 file=bridge-onboarding-01/REQUEST.md
```

Edit `bridge-onboarding-01/REQUEST.md` — the frontmatter is pre-filled; you write the body.

```bash
rig-bridge send REQUEST --thread bridge-onboarding-01 --to windows-5080
# → rig-bridge: sent type=REQUEST thread=bridge-onboarding-01 file=bridge-onboarding-01/REQUEST.md commit=a1b2c3d
```

`send` validates the envelope against the schema, computes `body_hash` over the §4.1-normalized body, commits, and pushes.

### On rig B (e.g. `windows-5080`)

```bash
cd ~/bridge
git pull
rig-bridge init --rig-id windows-5080
rig-bridge status
# → rig-bridge: status open=1 closed=0 dirty=0 unpushed=0
# → thread=bridge-onboarding-01 last=2026-05-15 status=active type=REQUEST dirty=false
```

Read what rig A sent:

```bash
rig-bridge thread bridge-onboarding-01
```

Reply:

```bash
rig-bridge send HANDOFF --thread bridge-onboarding-01 --to mac-m5max \
  --tldr "Picked this up, here's what I'd do" \
  --body-file response.md
```

### Back on rig A

```bash
rig-bridge sync
# → rig-bridge: sync pulled=false fast_forward=true new_envelopes=1
# stderr suggests: rig-bridge sync --auto to apply.
rig-bridge sync --auto
# → rig-bridge: sync pulled=true new_envelopes=1
rig-bridge thread bridge-onboarding-01    # the HANDOFF is now visible
```

When the conversation is done:

```bash
rig-bridge close bridge-onboarding-01 --status completed
# → rig-bridge: closed type=RESOLUTION thread=bridge-onboarding-01 status=completed commit=4e5f6a7
```

A `RESOLUTION.md` lands in the thread directory and `status` will report the thread as closed.

## Verify the integrity invariant

Across the round-trip, every envelope's `body_hash` survived CRLF/LF transport. The smoke test in the rig-bridge repo proves this for every send + close pair; the cross-rig E2E test (Phase 7) proves it across two independent clones AND a 3-rig topology.

If a re-hash on the receiving rig doesn't match the envelope's `body_hash` field, transport corrupted the body. rig-bridge makes that provable, not hopeful.
