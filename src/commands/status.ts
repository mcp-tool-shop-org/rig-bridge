// `rig-bridge status` — at-a-glance bridge state for read-only inspection.
//
// Architectural locks honored (Phase 7 study swarm, 2026-05-15):
//   * L10 — default = 4-5 column shape (THREAD, LAST, STATUS, TYPE, DIRTY?),
//     sort by recency desc, color reserved for state. Hick's Law + dashboard
//     working-memory research (Long et al. 2024; Cowan 2001) bound the
//     column count and the recency-first ordering.
//   * L11 — `--wide` opt-in adds FROM, TO, BODY_HASH (single second tier;
//     no third tier per Nielsen 2006 progressive-disclosure findings).
//   * L13 — auto-page via $PAGER when output exceeds terminal height and
//     stdout is a TTY. Skipped in JSON mode (machines don't want pagers).
//   * L14 — stdout = data (one key=value line per thread + a header summary
//     line); stderr = narrative. Scripts that pipe stdout get parseable
//     records without re-walking the bridge.
//   * L15 — `--json` opt-in. Output object always carries
//     `schema_version: "1.0"` per the kubectl pattern; default text may
//     evolve but the JSON shape is pinned.
//
// The command is read-only: it never writes a file, commits, or pushes.
// Dirty / unpushed detection runs through git rev-parse + status --porcelain
// from the bridge root.

import { spawnSync } from "node:child_process";
import { repoRoot, runGit } from "../engine/git.js";
import { listThreads, type ThreadSummary } from "../engine/threads.js";

export interface StatusArgs {
  cwd: string;
  json?: boolean;
  wide?: boolean;
  noColor?: boolean;
  /** stdout writer (injected for tests). Parseable contract — header + per-thread key=value lines. */
  stdout?: (line: string) => void;
  /** stderr writer (injected for tests). Human-readable narrative — column descriptions, hints. */
  stderr?: (line: string) => void;
}

export interface StatusResult {
  /** Per-thread summaries, sorted by recency desc (mirrors listThreads). */
  threads: ThreadSummary[];
  /** `git status --porcelain` output — one entry per dirty file. */
  dirty_files: string[];
  /** Commits ahead of the upstream tracking branch (empty when up-to-date or no upstream). */
  unpushed_commits: string[];
}

// JSON output shape — pinned at schema_version "1.0" per L15 (kubectl
// pattern). Default text may evolve; this JSON shape is the stable
// machine-readable contract.
interface StatusJsonShape {
  schema_version: "1.0";
  threads: SerializableThread[];
  dirty_files: string[];
  unpushed_commits: string[];
}

interface SerializableThread {
  thread_id: string;
  envelope_count: number;
  is_closed: boolean;
  status_class: string;
  last_modified: string; // ISO-8601
  latest_envelope: {
    filename: string;
    type: string;
    date: string;
    from: string;
    to: string | string[];
  };
}

// ANSI color helpers. Color is reserved for state-change per L10
// (Few 2006 — Information Dashboard Design). Apply to the `status=`
// field only so the rest of the row stays neutral.
const COLOR_RESET = "[0m";
const COLOR_GREEN = "[32m";
const COLOR_RED = "[31m";
const COLOR_YELLOW = "[33m";
const COLOR_BLUE = "[34m";

function colorForStatusClass(cls: string): string {
  switch (cls) {
    case "completed":
      return COLOR_GREEN;
    case "cancelled":
      return COLOR_RED;
    case "pending":
      return COLOR_YELLOW;
    case "active":
      return COLOR_BLUE;
    case "targeted":
      return COLOR_BLUE;
    default:
      return "";
  }
}

// Decide whether color should be applied. NO_COLOR (no-color.org — presence
// of the env var alone, not its value) overrides; --no-color flag overrides
// env; isatty(stdout) is the final gate so piped output is plain.
function shouldUseColor(noColor: boolean | undefined, json: boolean): boolean {
  if (json) return false;
  if (noColor) return false;
  if (process.env.NO_COLOR !== undefined) return false;
  // process.stdout.isTTY is the standard Node check.
  return Boolean(process.stdout.isTTY);
}

// Format an ISO timestamp to a YYYY-MM-DD short form for the LAST column.
// The engine's ThreadSummary carries a Date object; we render the date-only
// part so the column stays short. The full ISO form lives in JSON output.
function shortDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Collect dirty files via `git status --porcelain` (one entry per line).
function readDirtyFiles(root: string): string[] {
  const r = runGit(["status", "--porcelain"], root);
  if (r.status !== 0) return [];
  return r.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// Collect unpushed commit short-shas (commits ahead of @{u}). If no upstream
// is configured, return an empty array — that's not an error condition for
// status (a freshly cloned bridge with no remote branch tracking is valid).
function readUnpushedCommits(root: string): string[] {
  // First check if @{u} resolves. If not, no upstream — no unpushed commits.
  const verify = runGit(["rev-parse", "--abbrev-ref", "@{u}"], root);
  if (verify.status !== 0) return [];
  const r = runGit(
    ["log", "--pretty=format:%h %s", "@{u}..HEAD"],
    root,
  );
  if (r.status !== 0) return [];
  return r.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// Decide whether to auto-page. L13: pipe through $PAGER (default
// `less -FIRX`) when output exceeds terminal height AND stdout is a TTY.
// Skip in JSON mode (L13 explicitly). Honor RIG_BRIDGE_NO_PAGER=1 escape
// hatch.
function shouldPage(lineCount: number, json: boolean): boolean {
  if (json) return false;
  if (process.env.RIG_BRIDGE_NO_PAGER === "1") return false;
  if (!process.stdout.isTTY) return false;
  const rows = process.stdout.rows;
  if (typeof rows !== "number" || rows <= 0) return false;
  return lineCount > rows;
}

// Spawn $PAGER (default `less -FIRX`) and pipe the buffered output through
// it. Done in a blocking spawnSync so tests + callers don't need to manage
// process exit timing. Errors fall back to direct stdout — the pager is a
// nicety, never a hard dependency.
function tryPipeThroughPager(lines: string[]): boolean {
  const pagerEnv = process.env.PAGER;
  const cmd = pagerEnv && pagerEnv.length > 0 ? pagerEnv : "less";
  // If the operator's PAGER already includes args, split on whitespace.
  const parts = cmd.split(/\s+/).filter((s) => s.length > 0);
  if (parts.length === 0) return false;
  const bin = parts[0];
  const baseArgs = parts.slice(1);
  // Default less flags per L13: -F (quit if one screen), -I (case-insensitive),
  // -R (raw control chars — preserve color), -X (no clear on exit).
  const args = baseArgs.length > 0 ? baseArgs : ["-FIRX"];
  const r = spawnSync(bin, args, {
    input: lines.join(""),
    stdio: ["pipe", "inherit", "inherit"],
  });
  return r.status === 0 && !r.error;
}

export async function runStatus(args: StatusArgs): Promise<StatusResult> {
  const stdout = args.stdout ?? ((s: string) => process.stdout.write(s));
  const stderr = args.stderr ?? ((s: string) => process.stderr.write(s));

  // Locate the bridge root via repoRoot (engine/git.js). Even though the
  // caller is read-only, we still need to resolve the git toplevel so the
  // listThreads walk runs from the correct directory (not whatever cwd
  // the operator typed `rig-bridge status` from).
  const root = repoRoot(args.cwd);

  const threads = listThreads(root);
  const dirtyFiles = readDirtyFiles(root);
  const unpushedCommits = readUnpushedCommits(root);

  // Tally open vs closed for the header summary line. A "closed" thread
  // is one whose RESOLUTION.md is present (listThreads sets is_closed).
  let open = 0;
  let closed = 0;
  for (const t of threads) {
    if (t.is_closed) closed++;
    else open++;
  }

  // ---------- JSON mode (L15) ----------
  if (args.json === true) {
    const payload: StatusJsonShape = {
      schema_version: "1.0",
      threads: threads.map(
        (t): SerializableThread => ({
          thread_id: t.thread_id,
          envelope_count: t.envelope_count,
          is_closed: t.is_closed,
          status_class: t.status_class,
          last_modified: t.last_modified.toISOString(),
          latest_envelope: {
            filename: t.latest_envelope.filename,
            type: t.latest_envelope.type,
            date: t.latest_envelope.date,
            from: t.latest_envelope.from,
            to: t.latest_envelope.to,
          },
        }),
      ),
      dirty_files: dirtyFiles,
      unpushed_commits: unpushedCommits,
    };
    stdout(`${JSON.stringify(payload)}\n`);
    return {
      threads,
      dirty_files: dirtyFiles,
      unpushed_commits: unpushedCommits,
    };
  }

  // ---------- Text mode (L10/L11/L14) ----------
  const useColor = shouldUseColor(args.noColor, false);

  // Header summary line — single key=value contract line, matches the
  // Stage C pattern (`rig-bridge: <verb> key=value ...`). Scripts can
  // grep `^rig-bridge: status ` and parse the rest as key=value pairs.
  const summary =
    `rig-bridge: status open=${open} closed=${closed} ` +
    `dirty=${dirtyFiles.length} unpushed=${unpushedCommits.length}\n`;
  const lines: string[] = [summary];

  // Map dirty files back to thread membership so the per-row dirty? flag
  // is meaningful. `git status --porcelain` emits lines like ` M path/to/file`
  // or `?? path/...` — we slice off the 3-char status prefix and check
  // whether the path's first segment matches a thread id.
  function threadDirtyFlag(threadId: string): boolean {
    for (const line of dirtyFiles) {
      const path = line.slice(3);
      // Normalize backslashes (Windows) and split on first separator.
      const norm = path.replace(/\\/g, "/");
      const firstSeg = norm.split("/", 1)[0];
      if (firstSeg === threadId) return true;
    }
    return false;
  }

  for (const t of threads) {
    const cls = t.status_class;
    const statusToken = useColor
      ? `${colorForStatusClass(cls)}${cls}${COLOR_RESET}`
      : cls;
    const isDirty = threadDirtyFlag(t.thread_id);
    const parts: string[] = [
      `thread=${t.thread_id}`,
      `last=${shortDate(t.last_modified)}`,
      `status=${statusToken}`,
      `type=${t.latest_envelope.type}`,
      `dirty=${isDirty}`,
    ];
    if (args.wide === true) {
      const toStr = Array.isArray(t.latest_envelope.to)
        ? t.latest_envelope.to.join(",")
        : t.latest_envelope.to;
      // body_hash is not in ThreadSummary; surface FROM/TO + envelope_count
      // + closed-state under --wide. Future minor versions can add body_hash
      // additively if the engine exposes it on the summary.
      parts.push(`from=${t.latest_envelope.from}`);
      parts.push(`to=${toStr}`);
      parts.push(`closed=${t.is_closed}`);
      parts.push(`envelopes=${t.envelope_count}`);
    }
    lines.push(parts.join(" ") + "\n");
  }

  // Narrative on stderr (L14). Column descriptions go here, not to
  // stdout, so the parseable contract stays clean.
  if (threads.length === 0) {
    stderr(
      `rig-bridge: no threads found at ${root}. ` +
        `Use \`rig-bridge new <thread-id>\` to scaffold one.\n`,
    );
  } else {
    stderr(
      `rig-bridge: showing ${threads.length} thread(s) sorted by recency.\n`,
    );
    if (args.wide !== true) {
      stderr(
        `  columns: thread, last, status, type, dirty. ` +
          `Pass --wide for from/to/envelope-count.\n`,
      );
    }
  }

  // Auto-page (L13). Skip in JSON mode; honor RIG_BRIDGE_NO_PAGER=1; only
  // page when stdout is a TTY AND output exceeds the visible terminal
  // height. The pager path is a soft fallback — if it fails (no `less`
  // on PATH, etc.) we drop into direct stdout.
  if (shouldPage(lines.length, false)) {
    const paged = tryPipeThroughPager(lines);
    if (!paged) {
      for (const l of lines) stdout(l);
    }
  } else {
    for (const l of lines) stdout(l);
  }

  return {
    threads,
    dirty_files: dirtyFiles,
    unpushed_commits: unpushedCommits,
  };
}

// Exported for tests — pure helpers worth pinning. Renames are breaking
// for the test file but the helpers themselves are internal to the
// command.
export const _internal = {
  shouldUseColor,
  shouldPage,
  colorForStatusClass,
  shortDate,
};
