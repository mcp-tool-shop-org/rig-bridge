// `rig-bridge close <thread-id> --status <cancelled|completed>` — write
// RESOLUTION.md and commit + push. Same write+commit+push pipeline as
// send.ts; the divergence is the closed-status enum.
//
// Recipient resolution: a RESOLUTION informs the peer the thread is
// closed. Without a thread-state scanner (Phase 7+), we infer the peer
// by scanning prior envelopes in the thread directory and picking the
// most-frequent non-self counterpart. If no prior envelope is parseable,
// fall back to the local rig id (self-addressed terminal marker — a
// degenerate but schema-valid case for an empty thread).
//
// OUTPUT DISCIPLINE (B-CMD-002 / B-CMD-003, Stage C wave 1):
//   * stdout is the stable, parseable contract — one line of key=value
//     pairs (type=RESOLUTION thread=<id> status=<completed|cancelled>
//     commit=<sha7>). Phase 7's scanner does
//     `awk '/^rig-bridge: closed /'` and parses key=value pairs.
//   * stderr is the human-readable narrative — natural prose for
//     operators reading the terminal.

import { existsSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, safeCommit, safePush, type SafeCommitResult } from "../engine/git.js";
import { readConfig } from "../engine/config.js";
import { renderEnvelope } from "../engine/envelope.js";
import { validateFrontmatter } from "../engine/schema-validator.js";
import { bodyHash } from "../engine/body-hash.js";
import { markerToStatusClass, type StatusClass } from "../engine/status.js";
import { findPeerRigs } from "../engine/peer-rigs.js";

// B-ENG-003 cross-cutting fix: case-normalize rig-ids at every ingress.
// In close.ts the ingress site WAS the inline peer-rig inference loop;
// that loop is now the engine helper `findPeerRigs`, which performs the
// same normalize+validate+count discipline (and a wider scan — every
// thread in the bridge, not just the one being closed). The behavior
// preserved here: pick the most-frequent non-self rig from the bridge
// corpus, fall back to selfRigId for a degenerate empty-thread close.

export type CloseStatus = "cancelled" | "completed";

const MARKER_FOR: Record<CloseStatus, string> = {
  cancelled: "❌",
  completed: "✅",
};

export interface CloseArgs {
  cwd: string;
  threadId: string;
  status: string;
  /** Operator-supplied prose tail. */
  note?: string;
  noPush?: boolean;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

export interface CloseResult {
  filePath: string;
  commitSha: string;
  bodyHash: string;
  statusClass: StatusClass;
}

export function runClose(args: CloseArgs): CloseResult {
  const stdout = args.stdout ?? ((s: string) => process.stdout.write(s));
  const stderr = args.stderr ?? ((s: string) => process.stderr.write(s));

  if (args.status !== "cancelled" && args.status !== "completed") {
    throw new Error(
      `--status must be "cancelled" or "completed" (got "${args.status}")`,
    );
  }
  const closeStatus = args.status as CloseStatus;
  const marker = MARKER_FOR[closeStatus];

  const root = repoRoot(args.cwd);
  const cfg = readConfig(root);

  const threadDir = join(root, args.threadId);
  if (!existsSync(threadDir) || !statSync(threadDir).isDirectory()) {
    throw new Error(
      `thread directory not found: ${threadDir}. Cannot close a thread that was never opened.`,
    );
  }

  const filePath = join(threadDir, "RESOLUTION.md");
  if (existsSync(filePath)) {
    throw new Error(
      `${filePath} already exists — a thread may only be closed once`,
    );
  }

  const noteSuffix = args.note ? ` — ${args.note}` : "";
  const statusLine =
    closeStatus === "cancelled"
      ? `${marker} Cancelled${noteSuffix}`
      : `${marker} Completed${noteSuffix}`;
  const statusClass = markerToStatusClass(statusLine);

  const body =
    `# ${args.threadId} — RESOLUTION (${closeStatus})\n\n` +
    (args.note ? `${args.note}\n\n` : "") +
    `Standing by.\n`;

  // Phase 7 refactor (wave 2B): the old inline `inferPeerRig` has been
  // replaced with the engine helper `findPeerRigs`, which is the single
  // source of truth for non-self rig discovery (also used by `relay`
  // and `status`). The helper scans every thread in the bridge — the
  // previous shape only scanned the closing thread. Behavior delta is
  // intentional + minor: a thread whose own envelopes are sparse but
  // whose peer is well-known from other threads now resolves correctly.
  const peerTo = findPeerRigs(root, cfg.rig_id)[0]?.rig_id ?? cfg.rig_id;

  const frontmatter: Record<string, unknown> = {
    from: cfg.rig_id,
    to: peerTo,
    date: new Date().toISOString().slice(0, 10),
    status: statusLine,
    type: "RESOLUTION",
    thread: args.threadId,
  };
  if (cfg.display_name) frontmatter.display_name = cfg.display_name;

  // body_hash is part of the envelope (Q6 / G-001 close): SHA-256 of the
  // §4.1-normalized body. Compute BEFORE validation so the schema sees the
  // populated field AND the rendered RESOLUTION.md actually carries the
  // hash. Receiving rigs re-hash on pull and compare to detect drift —
  // without this field, drift detection has nothing to compare against.
  // Mirrors the order used in send.ts (see send.ts §"body_hash is part of
  // the envelope" comment) — the order is load-bearing.
  const hash = bodyHash(body);
  frontmatter.body_hash = hash;

  const validation = validateFrontmatter(frontmatter);
  if (!validation.valid) {
    throw new Error(
      `RESOLUTION envelope failed schema validation: ${validation.errorText}`,
    );
  }

  const text = renderEnvelope({ frontmatter, body });
  writeFileSync(filePath, text, "utf8");

  // F-CMD-008: if commit fails (missing git identity, hook failure, etc.)
  // the freshly-written envelope file is orphaned on disk; a naive retry
  // then dies with "file already exists" until the operator manually deletes
  // it. Clean up the orphan before re-throwing so retry is straightforward.
  // We deliberately surface BOTH the cleanup note and the original error.
  let commitResult: SafeCommitResult;
  try {
    commitResult = safeCommit({
      files: [filePath],
      message: `RESOLUTION: ${args.threadId} ${closeStatus}`,
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
  //   stdout: parseable contract line — type=RESOLUTION thread=<id>
  //           status=<completed|cancelled> commit=<sha7>. Phase 7's
  //           scanner does `awk '/^rig-bridge: closed /'` and parses
  //           key=value pairs.
  //   stderr: natural prose for operators reading the terminal.
  const sha7 = commitResult.commitSha.slice(0, 7);
  stdout(
    `rig-bridge: closed type=RESOLUTION thread=${args.threadId} status=${closeStatus} commit=${sha7}\n`,
  );
  stderr(
    `rig-bridge: closed thread ${args.threadId} (${closeStatus}); committed as ${sha7}\n`,
  );

  return {
    filePath,
    commitSha: commitResult.commitSha,
    bodyHash: hash,
    statusClass,
  };
}
