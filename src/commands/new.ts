// `rig-bridge new <thread-id>` — scaffold <thread-id>/REQUEST.md.
//
// Validates thread-id matches envelope-spec §2.1's pattern, creates the
// thread directory, and writes a REQUEST.md template with frontmatter
// pre-filled from the config (`from`, today's date, type=REQUEST).
// Errors if the file already exists, unless --force.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../engine/git.js";
import { readConfig } from "../engine/config.js";
import { renderEnvelope } from "../engine/envelope.js";

// envelope-spec §2.1: thread-id is a kebab-case slug. Allow single-char
// thread ids (e.g. 'a') as a boundary case.
const THREAD_ID_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

export interface NewArgs {
  cwd: string;
  threadId: string;
  force?: boolean;
  /** stdout writer (injected for tests) */
  stdout?: (line: string) => void;
}

export interface NewResult {
  filePath: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function runNew(args: NewArgs): NewResult {
  const stdout = args.stdout ?? ((s: string) => process.stdout.write(s));

  if (!THREAD_ID_PATTERN.test(args.threadId)) {
    throw new Error(
      `thread-id "${args.threadId}" is not a valid kebab-case slug ` +
        `(envelope-spec §2.1)`,
    );
  }

  const root = repoRoot(args.cwd);
  const cfg = readConfig(root);

  const threadDir = join(root, args.threadId);
  const filePath = join(threadDir, "REQUEST.md");

  if (existsSync(filePath) && !args.force) {
    throw new Error(`${filePath} already exists — pass --force to overwrite`);
  }

  mkdirSync(threadDir, { recursive: true });

  const frontmatter: Record<string, unknown> = {
    from: cfg.rig_id,
    to: "(set --to recipient when sending)",
    date: todayIso(),
    status: `▶ ${args.threadId} opened`,
    type: "REQUEST",
    thread: args.threadId,
  };
  if (cfg.display_name) frontmatter.display_name = cfg.display_name;

  const body = `# ${args.threadId} — REQUEST\n\n` +
    `<!-- Authored on ${cfg.rig_id}. Edit before \`rig-bridge send\`. -->\n\n` +
    `## What I'm asking\n\n` +
    `(describe the asker spec — what you want the peer to do)\n\n` +
    `## Context\n\n` +
    `(any prior turns, paths, or assumptions)\n\n` +
    `Standing by.\n`;

  const text = renderEnvelope({ frontmatter, body });
  writeFileSync(filePath, text, "utf8");

  stdout(`rig-bridge: scaffolded ${filePath}\n`);
  return { filePath };
}
