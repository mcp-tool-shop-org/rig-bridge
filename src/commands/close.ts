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

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnvelope } from "../engine/envelope.js";
import { validateRigId } from "../engine/rig-id.js";
import { repoRoot, safeCommit, safePush, type SafeCommitResult } from "../engine/git.js";
import { readConfig } from "../engine/config.js";
import { renderEnvelope } from "../engine/envelope.js";
import { validateFrontmatter } from "../engine/schema-validator.js";
import { bodyHash } from "../engine/body-hash.js";
import { markerToStatusClass, type StatusClass } from "../engine/status.js";

export type CloseStatus = "cancelled" | "completed";

function inferPeerRig(threadDir: string, selfRigId: string): string | null {
  let entries: string[];
  try {
    entries = readdirSync(threadDir);
  } catch {
    return null;
  }
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (!e.endsWith(".md")) continue;
    let raw: string;
    try {
      raw = readFileSync(join(threadDir, e), "utf8");
    } catch {
      continue;
    }
    let env;
    try {
      env = parseEnvelope(raw);
    } catch {
      continue;
    }
    const candidates: unknown[] = [];
    if (typeof env.frontmatter.from === "string") candidates.push(env.frontmatter.from);
    if (Array.isArray(env.frontmatter.to)) candidates.push(...env.frontmatter.to);
    else if (typeof env.frontmatter.to === "string") candidates.push(env.frontmatter.to);
    for (const c of candidates) {
      if (typeof c !== "string") continue;
      if (c === selfRigId) continue;
      if (!validateRigId(c).ok) continue;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [rig, n] of counts) {
    if (n > bestCount) {
      best = rig;
      bestCount = n;
    }
  }
  return best;
}

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

  const peerTo = inferPeerRig(threadDir, cfg.rig_id) ?? cfg.rig_id;

  const frontmatter: Record<string, unknown> = {
    from: cfg.rig_id,
    to: peerTo,
    date: new Date().toISOString().slice(0, 10),
    status: statusLine,
    type: "RESOLUTION",
    thread: args.threadId,
  };
  if (cfg.display_name) frontmatter.display_name = cfg.display_name;

  const validation = validateFrontmatter(frontmatter);
  if (!validation.valid) {
    throw new Error(
      `RESOLUTION envelope failed schema validation: ${validation.errorText}`,
    );
  }

  const hash = bodyHash(body);
  const text = renderEnvelope({ frontmatter, body });
  writeFileSync(filePath, text, "utf8");

  const commitResult: SafeCommitResult = safeCommit({
    files: [filePath],
    message: `RESOLUTION: ${args.threadId} ${closeStatus}`,
    cwd: root,
    stderr,
  });

  if (!args.noPush) {
    safePush({ cwd: root });
  }

  stdout(
    `rig-bridge: closed ${args.threadId} (${closeStatus}, ${commitResult.commitSha.slice(0, 7)})\n`,
  );

  return {
    filePath,
    commitSha: commitResult.commitSha,
    bodyHash: hash,
    statusClass,
  };
}
