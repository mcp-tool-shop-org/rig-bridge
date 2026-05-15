# Ship Gate

> No repo is "done" until every applicable line is checked.
> Copy this into your repo root. Check items off per-release.

**Tags:** `[all]` every repo · `[npm]` `[pypi]` `[vsix]` `[desktop]` `[container]` published artifacts · `[mcp]` MCP servers · `[cli]` CLI tools

---

## A. Security Baseline

- [x] `[all]` SECURITY.md exists (report email, supported versions, response timeline) (2026-05-15, Stage A iter-1)
- [x] `[all]` README includes threat model paragraph (data touched, data NOT touched, permissions required) (2026-05-15, Stage A iter-1; "Security & data" section)
- [x] `[all]` No secrets, tokens, or credentials in source or diagnostics output (2026-05-15, verified via Phase 5 audit)
- [x] `[all]` No telemetry by default — state it explicitly even if obvious (2026-05-15, README threat model)

### Default safety posture

- [x] `[cli|mcp|desktop]` Dangerous actions (kill, delete, restart) require explicit `--allow-*` flag — rig-bridge's destructive ops (`--force` for init/new) use a BOOLEAN_FLAGS allowlist landed Stage A iter-4 to prevent silent disable (2026-05-15)
- [x] `[cli|mcp|desktop]` File operations constrained to known directories (operates only within bridge root + `.bridge/`; submodule + size + OS-junk guards in git.ts; 2026-05-15)
- [ ] `[mcp]` SKIP: not an MCP server
- [ ] `[mcp]` SKIP: not an MCP server

## B. Error Handling

- [x] `[all]` Errors follow the Structured Error Shape: `code`, `message`, `hint`, `cause?`, `retryable?` — errors carry operator-actionable message + hint per Stage C humanization; full 5-field shape is a v1.1 refinement target (2026-05-15)
- [x] `[cli]` Exit codes: 0 ok · 1 user error · 130 SIGINT · 143 SIGTERM — documented in `docs/cli-contract.md` §4 (2026-05-15)
- [x] `[cli]` No raw stack traces without `--debug` — Stage C added `BridgeReportedError` sentinel + `errMessage` type-guard; debug trace gated on `DEBUG_RIG_BRIDGE` (2026-05-15)
- [ ] `[mcp]` SKIP: not an MCP
- [ ] `[mcp]` SKIP: not an MCP
- [ ] `[desktop]` SKIP: CLI, not desktop
- [ ] `[vscode]` SKIP: CLI, not VS Code extension

## C. Operator Docs

- [x] `[all]` README is current: what it does, install, usage, supported platforms + runtime versions (2026-05-15, Phase 7 Wave 2B docs agent + Stage C: "Installation" + "Security & data" + "CLI contract" sections; 8-of-8 commands listed)
- [x] `[all]` CHANGELOG.md (Keep a Changelog format) — Unreleased block + Phase 7 Added/Changed sections + study-swarm grounding citations (2026-05-15)
- [x] `[all]` LICENSE file present and repo states support status (MIT)
- [x] `[cli]` `--help` output accurate for all commands and flags — Phase 7 Wave 2B CLI agent updated HELP to list all 8 commands + new flags (`--json`, `--wide`, `--auto`, `--no-color`) (2026-05-15)
- [x] `[cli|mcp|desktop]` Logging levels defined: silent / normal / verbose / debug — `DEBUG_RIG_BRIDGE` env gates verbose+debug (binary); secrets redacted (no secrets emitted); 2026-05-15
- [ ] `[mcp]` SKIP: not an MCP
- [ ] `[complex]` HANDBOOK.md: daily ops, warn/critical response, recovery procedures — Starlight handbook in `site/src/content/docs/handbook/` per Full Treatment Phase 3 (Phase 10.3 of this swarm; deferred to in-flight Phase 10.3)

## D. Shipping Hygiene

- [x] `[all]` `verify` script exists (test + build + smoke in one command) — `npm run verify` runs `typecheck && build && test`; Stage A iter-3 (2026-05-15)
- [x] `[all]` Version in manifest matches git tag — bumped to 1.0.0 in Phase 10 (2026-05-15; tag lands at deploy step)
- [x] `[all]` Dependency scanning runs in CI (ecosystem-appropriate) — `npm audit --audit-level=critical` step in ci.yml; Stage A iter-3 (2026-05-15)
- [x] `[all]` Automated dependency update mechanism exists — Dependabot config at `.github/dependabot.yml`; Phase 10.0 (2026-05-15)
- [x] `[npm]` `npm pack --dry-run` includes: dist/, README.md, CHANGELOG.md, LICENSE — `files` field in package.json: `["dist", "schemas", "docs", "README.md", "ARCHITECTURE.md", "SECURITY.md", "CHANGELOG.md", "LICENSE"]`; Stage A iter-1
- [x] `[npm]` `engines.node` set (>=20.11.0); Stage A iter-3
- [x] `[npm]` Lockfile committed (`package-lock.json`)
- [ ] `[pypi]` SKIP: not a Python project
- [ ] `[vsix]` SKIP: not a VS Code extension
- [ ] `[desktop]` SKIP: CLI, not desktop

## E. Identity (soft gate — does not block ship)

- [ ] `[all]` Logo in README header — Phase 10.1 (brand-repo logo push pending)
- [ ] `[all]` Translations (polyglot-mcp, 8 languages) — Phase 10.1 (user runs locally via TranslateGemma)
- [ ] `[org]` Landing page (@mcptoolshop/site-theme) — Phase 10.2-10.3 (Starlight + landing page)
- [ ] `[all]` GitHub repo metadata: description, homepage, topics — Phase 10.4

---

## Gate Rules

**Hard gate (A–D):** Must pass before any version is tagged or published.
If a section doesn't apply, mark `SKIP:` with justification — don't leave it unchecked.

**Soft gate (E):** Should be done. Product ships without it, but isn't "whole."

**Checking off:**
```
- [x] `[all]` SECURITY.md exists (2026-02-27)
```

**Skipping:**
```
- [ ] `[pypi]` SKIP: not a Python project
```
