#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf8"),
) as { version: string };

const HELP = `rig-bridge — cross-rig sync tool for paired dev machines

Usage: rig-bridge <command> [options]

Status: pre-swarm scaffold (v${pkg.version}). Commands ship in Phases 6–8 of the dogfood swarm.

Planned commands:
  init                       initialize local clone, install hooks, write .bridge/config.yaml
  new <thread-id>            scaffold <thread-id>/REQUEST.md from template
  send <type> --thread <id>  append a typed message (REQUEST/HANDOFF/RESPONSE/ACK/RESOLUTION/STATE/RESULT)
  close <thread-id>          write RESOLUTION.md, commit + push
  status                     list open threads, latest turn, who owes the next move
  thread <id>                render full transcript in order
  sync                       pull-rebase then push, with submodule/size/junk guards
  relay <decisions...>       write MIKE-DECISIONS.md (or whoever the human is) into a thread

Options:
  --version, -v              print version
  --help, -h                 print this help

Reference:
  ARCHITECTURE.md            D2a-with-control-plane-bridge-glue
  docs/envelope-spec.md      (Phase 0 deliverable)
`;

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  process.stdout.write(HELP);
  process.exit(0);
}

if (args[0] === "--version" || args[0] === "-v") {
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}

process.stderr.write(
  `rig-bridge: command "${args[0]}" not yet implemented (pre-swarm scaffold).\n` +
    `Run \`rig-bridge --help\` for the planned surface.\n`,
);
process.exit(2);
