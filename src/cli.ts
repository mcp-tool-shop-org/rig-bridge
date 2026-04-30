#!/usr/bin/env node
// rig-bridge — cross-rig sync tool for paired dev machines.
//
// v1.0.0 ships 4 commands: init, new, send, close. The other 4 commands
// referenced in the help text (status, thread, sync, relay) ship in
// Phase 7 of the dogfood swarm.
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf8"),
) as { version: string };

const HELP = `rig-bridge — cross-rig sync tool for paired dev machines

Usage: rig-bridge <command> [options]

v1.0.0 commands:
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

Options:
  --version, -v                 print version
  --help, -h                    print this help

Phase 7+ commands (not in v1.0.0):
  status                        list open threads
  thread <id>                   render full transcript
  sync                          pull-rebase then push
  relay <decisions...>          record human decisions in-band

Reference:
  ARCHITECTURE.md               D2a-with-control-plane-bridge-glue
  docs/envelope-spec.md         envelope spec (Phase 0 deliverable)
  docs/control-plane-integration.md  forward design (v1.1)
`;

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
  multi: Record<string, string[]>;
}

const MULTI_FLAGS = new Set(["--to", "--ref"]);

function parseArgs(argv: string[]): ParsedArgs {
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

function fail(msg: string): never {
  process.stderr.write(`rig-bridge: ${msg}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write(`${pkg.version}\n`);
    return;
  }

  const cmd = argv[0];
  const rest = argv.slice(1);
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(rest);
  } catch (e) {
    fail((e as Error).message);
  }

  const cwd = process.cwd();

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
      default:
        fail(`unknown command "${cmd}". Run \`rig-bridge --help\`.`);
    }
  } catch (e) {
    fail((e as Error).message);
  }
}

main().catch((e) => {
  fail((e as Error).message);
});
