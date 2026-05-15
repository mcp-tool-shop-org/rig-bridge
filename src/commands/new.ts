// `rig-bridge new <thread-id>` — scaffold <thread-id>/REQUEST.md.
//
// Validates thread-id matches envelope-spec §2.1's pattern, creates the
// thread directory, and writes a REQUEST.md template with frontmatter
// pre-filled from the config (`from`, today's date, type=REQUEST).
// Errors if the file already exists, unless --force.
//
// OUTPUT DISCIPLINE (B-CMD-002 / B-CMD-003, Stage C wave 1):
//   * stdout is the stable, parseable contract — one line of key=value
//     pairs. `file=` is the repo-relative path (thread/FILENAME.md),
//     never an absolute filesystem path.
//   * stderr is the human-readable narrative — full paths and operator
//     guidance.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
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
  /** stdout writer (injected for tests). Parseable contract — one key=value line. */
  stdout?: (line: string) => void;
  /** stderr writer (injected for tests). Human-readable narrative — full paths. */
  stderr?: (line: string) => void;
}

export interface NewResult {
  filePath: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function runNew(args: NewArgs): NewResult {
  const stdout = args.stdout ?? ((s: string) => process.stdout.write(s));
  const stderr = args.stderr ?? ((s: string) => process.stderr.write(s));

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

  // B-CMD-003 split:
  //   stdout: parseable contract line — `type=REQUEST thread=<id>
  //           file=<thread>/REQUEST.md`. Repo-relative `file=` path so a
  //           Phase 7 scanner can `awk '/^rig-bridge: scaffolded /'` and
  //           parse the key=value pairs without dealing with host layout.
  //   stderr: full filesystem path + natural prose for operators.
  const relPath = relative(root, filePath).replace(/\\/g, "/");
  stdout(
    `rig-bridge: scaffolded type=REQUEST thread=${args.threadId} file=${relPath}\n`,
  );
  stderr(`rig-bridge: scaffolded ${filePath}\n`);
  return { filePath };
}
