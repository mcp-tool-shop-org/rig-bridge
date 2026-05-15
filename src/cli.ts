#!/usr/bin/env node
// rig-bridge — cross-rig sync tool for paired dev machines.
//
// v1.0.0 ships 8 commands:
//   - init / new / send / close — the canonical envelope-write pipeline (Stages A-C)
//   - status / thread / sync / relay — the read + sync + human-relay surface (Phase 7)
//
// Path B-2: this CLI does NOT touch the swarm-control-plane SQLite DB.
// Git is the wire, git is the persistent store. v1.1 adds CP integration.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInit } from "./commands/init.js";
import { runNew } from "./commands/new.js";
import { runSend } from "./commands/send.js";
import { runClose } from "./commands/close.js";
import { runStatus } from "./commands/status.js";
import { runThread } from "./commands/thread.js";
import { runSync } from "./commands/sync.js";
import { runRelay } from "./commands/relay.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function loadPackageVersion(): string {
  const pkgPath = join(__dirname, "..", "package.json");
  let raw: string;
  try {
    raw = readFileSync(pkgPath, "utf8");
  } catch (e) {
    throw new Error(
      `could not read package.json at ${pkgPath} — ${errMessage(e)}. ` +
        `hint: the CLI expects package.json one level above the entry point; ` +
        `check the install layout if you packaged it manually.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `package.json is not valid JSON: ${errMessage(e)}. ` +
        `hint: re-install rig-bridge to restore a clean package.json.`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || !("version" in parsed)) {
    throw new Error(
      `package.json is missing the "version" field. ` +
        `hint: re-install rig-bridge to restore a clean package.json.`,
    );
  }
  const version = (parsed as Record<string, unknown>).version;
  if (typeof version !== "string") {
    throw new Error(
      `package.json "version" must be a string (got ${typeof version}). ` +
        `hint: re-install rig-bridge to restore a clean package.json.`,
    );
  }
  return version;
}

/**
 * B-CLI-003 (HIGH, Stage C humanization): startup trace.
 *
 * When the CLI fails before any command runs (e.g. parseArgs throws, or
 * a typo before --help is parsed), the operator's stderr has no record
 * of WHICH rig-bridge binary was running. In environments where the
 * operator has multiple installs (npm global, npx, local clone), the
 * version + node version + platform line is the difference between a
 * 30-second triage and a 30-minute "wait, which one is on PATH?".
 *
 * Gated on DEBUG_RIG_BRIDGE so the noise stays opt-in. Truthy values
 * include "1", "true", "yes" — anything non-empty other than literal
 * "0", "false", "no", "off" passes.
 *
 * Reads version via a try/catch wrapper so a broken package.json does
 * not block the trace itself (we still want to know which binary tried
 * to run). The trace is emitted BEFORE parseArgs so even argv parsing
 * failures get a record.
 */
function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  if (v === "" || v === "0" || v === "false" || v === "no" || v === "off") {
    return false;
  }
  return true;
}

function emitStartupTrace(argv: string[]): void {
  if (!isTruthyEnv(process.env.DEBUG_RIG_BRIDGE)) return;
  let version = "unknown";
  try {
    version = loadPackageVersion();
  } catch {
    // Swallow: the trace is best-effort. The real loadPackageVersion call
    // below for --version/-v will surface the actual error to the operator.
  }
  const command = argv[0] ?? "(no command)";
  process.stderr.write(
    `rig-bridge: v${version} ${command} (node ${process.version}, platform ${process.platform})\n`,
  );
}

const HELP = `rig-bridge — cross-rig sync tool for paired dev machines

Usage: rig-bridge <command> [options]

Commands:
  init [--rig-id <id>] [--display-name <name>] [--force]
        initialize local clone, install commit-message hook, write
        .bridge/config.yaml. cwd MUST be a git repo.

  new <thread-id> [--force]
        scaffold <thread-id>/REQUEST.md from template

  send <type> --thread <id> --to <rig-id>[,<rig-id>...] [--to <rig-id>]...
        [--status "<marker> <prose>"] [--tldr "<one-line>"]
        [--body-file <path>] [--ref <commit-sha>]... [--no-push]
        write a typed envelope, validate, hash body, commit + push.
        <type> ∈ REQUEST | HANDOFF | RESPONSE | ACK | RESOLUTION |
                STATE | RESULT | RECOVERY | VERIFY | DECISIONS

  close <thread-id> --status <cancelled|completed> [--note "<prose>"]
        [--no-push]
        write RESOLUTION.md, commit + push.

  status                   List open threads (use --json for parseable output, --wide for full columns)
  thread <thread-id>       Render envelope transcript for one thread
  sync                     Pull new envelopes from remote; refuse non-FF (use --auto to fast-forward)
  relay <type> --thread <id>   Record a human-relayed DECISIONS / RESPONSE turn (rig-id MUST end in -relay)

Options:
  --version, -v                 print version
  --help, -h                    print this help
  --json                        emit pinned JSON output (schema_version "1.0")
  --wide                        status: show full columns (FROM/TO/BODY_HASH)
  --auto                        sync: auto fast-forward when safe (L1)
  --no-color                    suppress ANSI color (also honors NO_COLOR env)

Environment:
  DEBUG_RIG_BRIDGE=1            emit one-line startup trace to stderr
                                (version, command, node, platform) — helps
                                disambiguate which rig-bridge binary is on
                                PATH when multiple installs coexist.
  NO_COLOR                      presence (any value) suppresses ANSI color.
                                Per-stream TTY check still applies; --no-color
                                overrides on a per-invocation basis.

Reference:
  ARCHITECTURE.md               D2a-with-control-plane-bridge-glue
  docs/envelope-spec.md         envelope spec (Phase 0 deliverable)
  docs/cli-contract.md          --json / --wide / --auto / --no-color contract
  docs/control-plane-integration.md  forward design (v1.1)
`;

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
  multi: Record<string, string[]>;
}

const MULTI_FLAGS = new Set(["--to", "--ref"]);

// Boolean flags MUST be on the allowlist; otherwise `--force <typo>` silently
// disables `--force` because the next token gets consumed as a string value,
// and downstream `=== true` checks fail. Mirrors the boolean flags accepted
// by command handlers in src/commands/*.ts:
//   --force     — init, new (overwrite-existing semantics)
//   --no-push   — send, close (skip git push step)
//   --json      — status, thread, sync, relay (L15: schema_version "1.0" pinned)
//   --wide      — status (L11: opt-in column-disclosure tier)
//   --auto      — sync (L1: auto fast-forward when no divergence detected)
//   --no-color  — all (NO_COLOR env honored too; per-stream isatty check)
// When adding a new boolean flag to a command handler, also add it here.
const BOOLEAN_FLAGS = new Set([
  "--force",
  "--no-push",
  "--json",
  "--wide",
  "--auto",
  "--no-color",
]);

/**
 * Parse a post-command argv slice into positional / single-value flag /
 * multi-value flag buckets.
 *
 * Boolean-flag allowlist (F-CMD-001 class fix): flags in `BOOLEAN_FLAGS` are
 * always set to `true` and never consume the next token, even if a non-flag
 * token follows. This prevents `rig-bridge init --force somevalue` from
 * being parsed as `{ --force: "somevalue" }` — a string value would fail
 * the downstream `parsed.flags["--force"] === true` check and silently
 * disable the `--force` safety override. Non-allowlist flags retain the
 * "consume next token as value" behavior.
 *
 * Other current quirks (documented in cli.test.ts, deferred to Stage B):
 * `--flag=value` is not split; comma-separated multi values are not split;
 * repeated single-value flags last-write-wins; unknown flags are accepted.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { positional: [], flags: {}, multi: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      const isBoolean = next === undefined || next.startsWith("--");
      if (MULTI_FLAGS.has(a)) {
        if (isBoolean) {
          throw new Error(`flag ${a} requires a value`);
        }
        if (!out.multi[a]) out.multi[a] = [];
        out.multi[a].push(next);
        i++;
      } else if (BOOLEAN_FLAGS.has(a)) {
        // Allowlisted boolean — always true, never consume next token.
        out.flags[a] = true;
      } else if (isBoolean) {
        out.flags[a] = true;
      } else {
        out.flags[a] = next;
        i++;
      }
    } else {
      out.positional.push(a);
    }
  }
  return out;
}

/**
 * B-CLI-001 (HIGH, Stage C humanization): sentinel error for clean exit.
 *
 * `fail()` writes a message to stderr and signals an exit-1 condition.
 * Pre-fix, `fail()` called `process.exit(1)` synchronously, which on
 * some platforms tore the process down before pending stderr writes
 * drained (truncated error output) and before `finally` blocks in
 * async-rooted call paths ran (skipped cleanup).
 *
 * Post-fix, `fail()` sets `process.exitCode = 1` and throws this
 * sentinel. The outermost `main().catch()` recognizes the sentinel as
 * "already reported, do not re-print" and returns normally — Node's
 * natural exit handler then drains the event loop and uses
 * `process.exitCode` as the final exit status.
 *
 * Non-sentinel errors caught at the top level (programmer errors,
 * unanticipated throws) DO get re-printed via `fail()` so the operator
 * still sees something useful.
 */
class BridgeReportedError extends Error {
  constructor() {
    super("rig-bridge: error already reported to stderr");
    this.name = "BridgeReportedError";
  }
}

function fail(msg: string): never {
  process.stderr.write(`rig-bridge: ${msg}\n`);
  process.exitCode = 1;
  throw new BridgeReportedError();
}

/**
 * B-CLI-002 (HIGH, Stage C humanization): SIGINT / SIGTERM handlers.
 *
 * Pre-fix: pressing Ctrl-C mid-`send` killed the process with no
 * stderr output. If an envelope file had been written but not yet
 * committed, it became an orphan and the operator had no idea — the
 * next `send` would either fail on an unexpected git state or commit
 * the orphan alongside the new envelope.
 *
 * Post-fix: install handlers near the top of main(). On signal:
 *   1. Write one line of operator-facing guidance to stderr — exactly
 *      what to type next to check for orphans.
 *   2. Set process.exitCode to the canonical signal exit (130 for
 *      SIGINT = 128 + SIGINT(2); 143 for SIGTERM = 128 + SIGTERM(15)).
 *   3. Give in-flight work a brief grace period (500ms) to wrap up,
 *      then force-exit with the same code. If a child process (git)
 *      is running, OS-default SIGINT propagation handles it — git
 *      typically aborts cleanly. We do not try to be cleverer.
 *
 * Idempotency: a module-level flag prevents a second SIGINT (e.g. an
 * impatient operator double-tapping Ctrl-C) from re-printing the
 * guidance OR re-starting the grace timer. The second SIGINT is
 * treated as "I really mean it" and force-exits immediately.
 */
let signalHandlersInstalled = false;
let signalAlreadyReceived = false;

function installSignalHandlers(cwd: string): void {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;

  const handle = (signal: "SIGINT" | "SIGTERM") => {
    const exitCode = signal === "SIGINT" ? 130 : 143;
    if (signalAlreadyReceived) {
      // Second signal — operator wants out NOW. Bail.
      process.stderr.write(
        `rig-bridge: received second ${signal}, exiting immediately.\n`,
      );
      process.exit(exitCode);
    }
    signalAlreadyReceived = true;
    process.stderr.write(
      `rig-bridge: interrupted (${signal}). ` +
        `To check for orphaned envelopes: cd ${cwd}; git status\n`,
    );
    process.exitCode = exitCode;
    // Grace period for in-flight work (typically a child git process) to
    // wrap up. If nothing is pending, the event loop is already empty and
    // the process will exit naturally before this timer fires.
    const timer = setTimeout(() => {
      process.exit(exitCode);
    }, 500);
    // Don't keep the event loop alive solely on this timer — if the
    // command finishes cleanly inside the grace window we want a normal
    // exit, not a 500ms artificial pause.
    timer.unref();
  };

  process.on("SIGINT", () => handle("SIGINT"));
  process.on("SIGTERM", () => handle("SIGTERM"));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // Startup trace MUST come before parseArgs so even argv-parse failures
  // produce a trace line (operator can correlate "which binary was that?"
  // with the error that follows).
  emitStartupTrace(argv);

  // Signal handlers MUST be installed before any work that might write
  // files (the send and close command handlers write envelopes before
  // committing). cwd is captured at handler-install time so a later
  // chdir does not change the message — the operator's `cd` target
  // matches where rig-bridge was actually running.
  const cwd = process.cwd();
  installSignalHandlers(cwd);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write(`${loadPackageVersion()}\n`);
    return;
  }

  const cmd = argv[0];
  const rest = argv.slice(1);
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(rest);
  } catch (e) {
    fail(errMessage(e));
  }

  try {
    switch (cmd) {
      case "init": {
        const rigId = parsed.flags["--rig-id"];
        if (typeof rigId !== "string") {
          fail("init: --rig-id <id> is required");
        }
        const displayName = parsed.flags["--display-name"];
        runInit({
          cwd,
          rigId,
          displayName: typeof displayName === "string" ? displayName : undefined,
          force: parsed.flags["--force"] === true,
        });
        return;
      }
      case "new": {
        const threadId = parsed.positional[0];
        if (!threadId) fail("new: <thread-id> is required");
        runNew({
          cwd,
          threadId,
          force: parsed.flags["--force"] === true,
        });
        return;
      }
      case "send": {
        const type = parsed.positional[0];
        if (!type) fail("send: <type> is required");
        const threadFlag = parsed.flags["--thread"];
        if (typeof threadFlag !== "string") {
          fail("send: --thread <id> is required");
        }
        const to = parsed.multi["--to"] ?? [];
        const refs = parsed.multi["--ref"] ?? [];
        const status = parsed.flags["--status"];
        const tldr = parsed.flags["--tldr"];
        const bodyFile = parsed.flags["--body-file"];
        runSend({
          cwd,
          type,
          threadId: threadFlag,
          to,
          status: typeof status === "string" ? status : undefined,
          tldr: typeof tldr === "string" ? tldr : undefined,
          bodyFile: typeof bodyFile === "string" ? bodyFile : undefined,
          references: refs,
          noPush: parsed.flags["--no-push"] === true,
        });
        return;
      }
      case "close": {
        const threadId = parsed.positional[0];
        if (!threadId) fail("close: <thread-id> is required");
        const status = parsed.flags["--status"];
        if (typeof status !== "string") {
          fail("close: --status <cancelled|completed> is required");
        }
        const note = parsed.flags["--note"];
        runClose({
          cwd,
          threadId,
          status,
          note: typeof note === "string" ? note : undefined,
          noPush: parsed.flags["--no-push"] === true,
        });
        return;
      }
      case "status": {
        // L10/L11/L14/L15: stdout is data; stderr is narrative.
        // --wide opts into the second disclosure tier (FROM/TO/BODY_HASH).
        // --json emits the schema_version "1.0" pinned object shape.
        runStatus({
          cwd,
          json: parsed.flags["--json"] === true,
          wide: parsed.flags["--wide"] === true,
          noColor: parsed.flags["--no-color"] === true,
        });
        return;
      }
      case "thread": {
        // L12: small-multiples transcript; chronological asc; identical
        // frontmatter-header per envelope. <thread-id> is a required
        // positional so a typo surfaces immediately rather than rendering
        // an empty transcript.
        const threadId = parsed.positional[0];
        if (!threadId) fail("thread: <thread-id> is required");
        runThread({
          cwd,
          threadId,
          json: parsed.flags["--json"] === true,
          noColor: parsed.flags["--no-color"] === true,
        });
        return;
      }
      case "sync": {
        // L1/L4: auto-resolve only the fast-forward case; surface
        // everything else at the sync boundary. --auto opts into the
        // auto-FF behavior; the default is "report only, do not mutate
        // local refs."
        runSync({
          cwd,
          auto: parsed.flags["--auto"] === true,
          json: parsed.flags["--json"] === true,
          noColor: parsed.flags["--no-color"] === true,
        });
        return;
      }
      case "relay": {
        // L5/L6/L7/L8/L9: relay records a human-mediated DECISIONS or
        // RESPONSE turn. The relay command's rig-id MUST end in `-relay`
        // and a signing key MUST be configured; the command handler
        // enforces both. <type> is positional[0] and --thread is required.
        const type = parsed.positional[0];
        if (!type) fail("relay: <type> is required");
        const threadFlag = parsed.flags["--thread"];
        if (typeof threadFlag !== "string") {
          fail("relay: --thread <id> is required");
        }
        const status = parsed.flags["--status"];
        const tldr = parsed.flags["--tldr"];
        const bodyFile = parsed.flags["--body-file"];
        const inReplyTo = parsed.flags["--in-reply-to"];
        const to = parsed.multi["--to"] ?? [];
        const refs = parsed.multi["--ref"] ?? [];
        runRelay({
          cwd,
          type,
          threadId: threadFlag,
          to,
          status: typeof status === "string" ? status : undefined,
          tldr: typeof tldr === "string" ? tldr : undefined,
          bodyFile: typeof bodyFile === "string" ? bodyFile : undefined,
          inReplyTo: typeof inReplyTo === "string" ? inReplyTo : undefined,
          references: refs,
          noPush: parsed.flags["--no-push"] === true,
          json: parsed.flags["--json"] === true,
          noColor: parsed.flags["--no-color"] === true,
        });
        return;
      }
      default:
        fail(`unknown command "${cmd}". Run \`rig-bridge --help\`.`);
    }
  } catch (e) {
    // BridgeReportedError signals "fail() already wrote to stderr and set
    // process.exitCode" — re-throw so the outer .catch can decide what to
    // do. Other thrown errors are unanticipated and need their message
    // surfaced.
    if (e instanceof BridgeReportedError) throw e;
    fail(errMessage(e));
  }
}

// Outermost catch: BridgeReportedError means fail() already wrote the
// message and set process.exitCode — we just return so Node's natural
// exit can drain pending writes. For any other error (a bug, an uncaught
// throw from a command handler), report it via fail() so the operator
// at least sees what happened.
main().catch((e) => {
  if (e instanceof BridgeReportedError) {
    return;
  }
  // fail() throws BridgeReportedError, which is intentionally not
  // re-thrown here — we just let the function return and Node exit
  // naturally with process.exitCode = 1.
  try {
    fail(errMessage(e));
  } catch {
    // Swallow the sentinel; exitCode is already set.
  }
});
