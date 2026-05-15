// `rig-bridge send <type> --thread <id> ...` — write + commit + push
// a typed envelope.
//
// Sequence:
//   1. Resolve repo + config.
//   2. Validate type, --to ids, --status marker.
//   3. Validate thread directory exists (created by `bridge new`).
//   4. Decide the destination filename per envelope-spec §2.3 ordinal rule.
//   5. Assemble body (from --body-file, or stdin, or fall back to a stub).
//   6. Render envelope (frontmatter + body), schema-validate, body_hash.
//   7. Write file; safeCommit; safePush (skipped if --no-push).
//   8. Return commit SHA + filepath.
//
// Mike's three guidance points:
//   * §4.2 marker→class derivation runs at envelope-construction time so
//     v1.1's CP write becomes a one-line drop-in (Path B-2).
//   * --to rig ids are validated at ingress before any side effect.
//   * `tldr` over 280 chars warns on stderr and proceeds (decision #1).
//   * `--to` accepts comma-separated values in a single flag *and* repeated
//     --to flags (decision #2 — both forms accepted).
//
// OUTPUT DISCIPLINE (B-CMD-002 / B-CMD-003, Stage C wave 1):
//   * stdout is the stable, parseable contract — one line of key=value
//     pairs (type=, thread=, file=, commit=). `file=` is repo-relative.
//     Phase 7's `status` scanner does `awk '/^rig-bridge: sent /'` and
//     parses key=value reliably without re-reading envelope files.
//   * stderr is the human-readable narrative — natural prose for operators
//     scrolling the terminal, including full paths and recovery hints.

import {
  existsSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { repoRoot, safeCommit, safePush, type SafeCommitResult } from "../engine/git.js";
import { readConfig } from "../engine/config.js";
import { renderEnvelope } from "../engine/envelope.js";
import { validateFrontmatter } from "../engine/schema-validator.js";
import { bodyHash } from "../engine/body-hash.js";
import { markerToStatusClass, type StatusClass } from "../engine/status.js";
import { validateRigId, normalizeRigId } from "../engine/rig-id.js";

// B-ENG-003 cross-cutting fix: case-normalize rig-ids at the --to ingress
// so `--to Windows-5080` becomes `windows-5080` before validation. The
// Engine helper `normalizeRigId` is imported above; it is a pure (trim +
// lowercase) transform. The composition with validateRigId is the
// canonical auto-fix shape mandated by the brief.

export const SUPPORTED_TYPES = [
  "REQUEST",
  "HANDOFF",
  "RESPONSE",
  "ACK",
  "RESOLUTION",
  "STATE",
  "RESULT",
  "RECOVERY",
  "VERIFY",
  "DECISIONS",
] as const;

export type MessageType = (typeof SUPPORTED_TYPES)[number];

const TLDR_SOFT_CAP = 280;

export interface SendArgs {
  cwd: string;
  type: string;
  threadId: string;
  /** One or more recipients. Each entry may itself be comma-separated. */
  to: string[];
  /** Status marker + free-prose. Defaults to `▶ <type> sent`. */
  status?: string;
  /** Path to file holding the body. Mutually exclusive with bodyText. */
  bodyFile?: string;
  /** Direct body text. */
  bodyText?: string;
  /** Optional one-sentence summary. */
  tldr?: string;
  /** Commit SHAs of prior turns. */
  references?: string[];
  /** Skip `git push origin main`. Used by tests + offline workflows. */
  noPush?: boolean;
  /** stdout writer (injected for tests) */
  stdout?: (line: string) => void;
  /** stderr writer (injected for tests) */
  stderr?: (line: string) => void;
}

export interface SendResult {
  filePath: string;
  filename: string;
  commitSha: string;
  bodyHash: string;
  statusClass: StatusClass;
  warnings: string[];
}

function flatten(values: string[]): string[] {
  return values
    .flatMap((v) => v.split(","))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Per envelope-spec §2.3: bare <TYPE>.md preferred when nothing of that
// type exists in the thread; otherwise append -2, -3, ... in order.
function chooseFilename(threadDir: string, type: MessageType): string {
  const bare = `${type}.md`;
  if (!existsSync(join(threadDir, bare))) return bare;
  let n = 2;
  while (n < 1000) {
    const cand = `${type}-${n}.md`;
    if (!existsSync(join(threadDir, cand))) return cand;
    n++;
  }
  throw new Error(`exhausted ordinal range for ${type} in ${threadDir}`);
}

export function runSend(args: SendArgs): SendResult {
  const stdout = args.stdout ?? ((s: string) => process.stdout.write(s));
  const stderr = args.stderr ?? ((s: string) => process.stderr.write(s));

  const type = args.type as MessageType;
  if (!SUPPORTED_TYPES.includes(type)) {
    throw new Error(
      `unknown message type "${args.type}" — must be one of: ${SUPPORTED_TYPES.join(", ")}`,
    );
  }

  // Validate --to rig ids at ingress (Mike's guidance #2).
  // B-ENG-003: normalize first (trim + lowercase) so `--to Windows-5080`
  // is accepted and propagates as `windows-5080` into the envelope.
  const toFlat = flatten(args.to ?? []).map(normalizeRigId);
  if (toFlat.length === 0) {
    throw new Error("`--to <rig-id>` is required (one or more)");
  }
  for (const id of toFlat) {
    const r = validateRigId(id);
    if (!r.ok) {
      throw new Error(`--to: ${r.reason}`);
    }
  }

  const root = repoRoot(args.cwd);
  const cfg = readConfig(root);

  const threadDir = join(root, args.threadId);
  if (!existsSync(threadDir) || !statSync(threadDir).isDirectory()) {
    throw new Error(
      `thread directory not found: ${threadDir}. Run \`rig-bridge new ${args.threadId}\` first.`,
    );
  }

  const filename = chooseFilename(threadDir, type);
  const filePath = join(threadDir, filename);

  const status = args.status ?? `▶ ${type} sent`;
  // Validate the marker derivation up front. If it throws we surface a
  // clear error before any file write.
  const statusClass = markerToStatusClass(status);

  // Body — pick from explicit text, file, or fall back to a stub.
  let body: string;
  if (args.bodyText !== undefined) {
    body = args.bodyText;
  } else if (args.bodyFile !== undefined) {
    if (!existsSync(args.bodyFile)) {
      throw new Error(`--body-file not found: ${args.bodyFile}`);
    }
    body = readFileSync(args.bodyFile, "utf8");
  } else {
    body = `# ${args.threadId} — ${type}\n\n(body authored on ${cfg.rig_id})\n\nStanding by.\n`;
  }

  // Soft cap on tldr (decision #1: warn on stderr, proceed).
  if (args.tldr !== undefined && args.tldr.length > TLDR_SOFT_CAP) {
    stderr(
      `rig-bridge: warning: tldr is ${args.tldr.length} chars (>${TLDR_SOFT_CAP} soft cap)\n`,
    );
  }

  // Assemble frontmatter.
  const frontmatter: Record<string, unknown> = {
    from: cfg.rig_id,
    to: toFlat.length === 1 ? toFlat[0] : toFlat,
    date: new Date().toISOString().slice(0, 10),
    status,
    type,
    thread: args.threadId,
  };
  if (cfg.display_name) frontmatter.display_name = cfg.display_name;
  if (args.tldr !== undefined) frontmatter.tldr = args.tldr;
  if (args.references && args.references.length > 0) {
    frontmatter.references = args.references;
  }

  // body_hash is part of the envelope (Q6 / G-001 close): SHA-256 of the
  // §4.1-normalized body. Compute BEFORE validation so the schema sees the
  // populated field. Receiving rigs re-hash on pull and compare to detect
  // drift — without this field, drift detection has nothing to compare
  // against.
  const hash = bodyHash(body);
  frontmatter.body_hash = hash;

  const validation = validateFrontmatter(frontmatter);
  if (!validation.valid) {
    throw new Error(`envelope frontmatter failed schema validation: ${validation.errorText}`);
  }

  const text = renderEnvelope({ frontmatter, body });
  writeFileSync(filePath, text, "utf8");

  const commitMsg = args.tldr
    ? `${type}: ${args.tldr}`
    : `${type}: ${args.threadId}/${filename}`;

  // F-CMD-008: if commit fails (missing git identity, hook failure, etc.)
  // the freshly-written envelope file is orphaned on disk; a naive retry
  // then dies with "file already exists" until the operator manually deletes
  // it. Clean up the orphan before re-throwing so retry is straightforward.
  // We deliberately surface BOTH the cleanup note and the original error.
  let commitResult: SafeCommitResult;
  try {
    commitResult = safeCommit({
      files: [filePath],
      message: commitMsg,
      cwd: root,
      stderr,
    });
  } catch (e) {
    try {
      unlinkSync(filePath);
    } catch {
      // If cleanup itself fails (permissions, already-removed), proceed
      // with the original throw — surfacing the commit failure matters
      // more than the cleanup error.
    }
    const orig = (e as Error).message ?? String(e);
    throw new Error(
      `rig-bridge: commit failed and the unpushed envelope at ${filePath} was removed so you can retry cleanly. Original error: ${orig}`,
    );
  }

  if (!args.noPush) {
    // F-CMD-010: if push fails (non-fast-forward, network), the commit
    // landed locally but is unpushed. Print a clear operator-recovery
    // message to stderr before re-throwing the original error so callers
    // and tests still see the actual failure.
    try {
      safePush({ cwd: root });
    } catch (e) {
      stderr(
        `rig-bridge: commit landed locally but push failed.\n` +
          `To recover:  cd ${root}; git pull --rebase; git push\n` +
          `Or retry the original send with --no-push to skip the push step.\n`,
      );
      throw e;
    }
  }

  // B-CMD-003 split:
  //   stdout: parseable contract line — type=<TYPE> thread=<id>
  //           file=<thread>/<filename> commit=<sha7>. Phase 7's scanner
  //           does `awk '/^rig-bridge: sent /'` and parses key=value
  //           pairs reliably (no envelope-file re-parsing required to
  //           know what kind of message was sent).
  //   stderr: natural prose for operators reading the terminal.
  const sha7 = commitResult.commitSha.slice(0, 7);
  const relFile = relative(root, filePath).replace(/\\/g, "/");
  stdout(
    `rig-bridge: sent type=${type} thread=${args.threadId} file=${relFile} commit=${sha7}\n`,
  );
  stderr(
    `rig-bridge: sent ${type} in thread ${args.threadId} as ${filename}; committed as ${sha7}\n`,
  );

  return {
    filePath,
    filename,
    commitSha: commitResult.commitSha,
    bodyHash: hash,
    statusClass,
    warnings: commitResult.warnings,
  };
}

// Exported for tests + close.ts (which reuses the ordinal logic for
// RESOLUTION.md selection).
export const _internal = { chooseFilename, flatten };
