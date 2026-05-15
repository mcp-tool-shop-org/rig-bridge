// `rig-bridge thread <id>` — small-multiples transcript reader.
//
// Architectural locks honored (Phase 7 study swarm, 2026-05-15):
//   * L12 — small-multiples: identical frontmatter-header block per
//     envelope, chronological asc. Tufte 1983/1990 small-multiples
//     pattern: same design, same scale, learn-once-apply-many.
//   * L13 — auto-page via $PAGER when output exceeds terminal height
//     AND stdout is a TTY. Skipped in JSON mode.
//   * L14 — stdout = data (one block per envelope, each opened by a
//     parseable key=value summary line); stderr = narrative.
//   * L15 — `--json` opt-in; output object carries
//     `schema_version: "1.0"` per the kubectl pattern.
//
// The command is read-only: never writes a file, never commits, never
// mutates the working tree.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../engine/git.js";
import { parseEnvelope } from "../engine/envelope.js";
import type { ParsedEnvelope } from "../engine/validate-file.js";

export interface ThreadArgs {
  cwd: string;
  threadId: string;
  json?: boolean;
  noColor?: boolean;
  /** stdout writer (injected for tests). Parseable key=value summary + frontmatter+body blocks. */
  stdout?: (line: string) => void;
  /** stderr writer (injected for tests). Human-readable narrative — separator hints, render notes. */
  stderr?: (line: string) => void;
}

export interface ThreadResult {
  thread_id: string;
  envelope_count: number;
  /** Envelopes in chronological ascending order. */
  envelopes: ParsedEnvelope[];
}

interface ThreadJsonShape {
  schema_version: "1.0";
  thread_id: string;
  envelope_count: number;
  envelopes: ParsedEnvelope[];
}

// ANSI color helpers — color is reserved for state-change per L10 doctrine.
// In thread output we color the `type=` value (and the emoji status marker
// is already in the body — keep it as-is). Same NO_COLOR / isatty / flag
// gates as status.ts.
const COLOR_RESET = "[0m";
const COLOR_BLUE = "[34m";
const COLOR_GREEN = "[32m";
const COLOR_RED = "[31m";
const COLOR_YELLOW = "[33m";

function colorForType(type: string): string {
  switch (type) {
    case "REQUEST":
    case "HANDOFF":
      return COLOR_BLUE;
    case "RESPONSE":
    case "ACK":
      return COLOR_GREEN;
    case "RESOLUTION":
      return COLOR_GREEN;
    case "RECOVERY":
      return COLOR_YELLOW;
    case "VERIFY":
    case "DECISIONS":
      return COLOR_RED;
    default:
      return "";
  }
}

function shouldUseColor(noColor: boolean | undefined, json: boolean): boolean {
  if (json) return false;
  if (noColor) return false;
  if (process.env.NO_COLOR !== undefined) return false;
  return Boolean(process.stdout.isTTY);
}

// Sort envelopes chronologically asc. Filenames in a thread directory
// follow envelope-spec §2.3: REQUEST.md → HANDOFF.md → HANDOFF-2.md →
// RESPONSE.md → ... → RESOLUTION.md. The natural per-type ordinal sort
// already produces the correct chronological order in the common case
// (REQUEST < HANDOFF < HANDOFF-2 < RESOLUTION lexicographically when
// the type prefix is bucketed first).
//
// Two stable orderings: (a) date frontmatter ascending, then (b) filename
// ascending as tiebreaker. Date alone is unreliable because multiple
// envelopes can share a date — filename is the load-bearing chronological
// signal in that case.
function chronoOrder(a: EnvelopeFile, b: EnvelopeFile): number {
  const aDate = typeof a.parsed.frontmatter.date === "string"
    ? a.parsed.frontmatter.date
    : "";
  const bDate = typeof b.parsed.frontmatter.date === "string"
    ? b.parsed.frontmatter.date
    : "";
  if (aDate !== bDate) return aDate < bDate ? -1 : 1;
  // Same date — fall back to filename ordering.
  if (a.filename === b.filename) return 0;
  return a.filename < b.filename ? -1 : 1;
}

interface EnvelopeFile {
  filename: string;
  parsed: ParsedEnvelope;
  rawBody: string;
}

// Read every parseable .md envelope in the thread directory. Tolerant of
// individual parse failures — a single corrupt envelope skips that file
// (the operator will see fewer blocks; better than tanking the whole
// transcript render).
function readThreadEnvelopes(threadDir: string): EnvelopeFile[] {
  const entries = readdirSync(threadDir);
  const out: EnvelopeFile[] = [];
  for (const f of entries) {
    if (!f.endsWith(".md")) continue;
    const full = join(threadDir, f);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    let raw: string;
    try {
      raw = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    try {
      const env = parseEnvelope(raw);
      out.push({
        filename: f,
        parsed: { frontmatter: env.frontmatter, body: env.body },
        rawBody: env.body,
      });
    } catch {
      // Skip unparseable envelopes — the validate command surfaces these
      // explicitly; the thread reader degrades gracefully.
    }
  }
  out.sort(chronoOrder);
  return out;
}

// Render a single envelope as a small-multiples block (L12). Each block
// opens with a parseable key=value summary line (stdout-contract), then
// a frontmatter dump, then a body block, then a separator rule.
function renderBlock(
  env: EnvelopeFile,
  index: number,
  total: number,
  threadId: string,
  useColor: boolean,
): string {
  const fm = env.parsed.frontmatter;
  const type = typeof fm.type === "string" ? fm.type : "(unknown)";
  const from = typeof fm.from === "string" ? fm.from : "";
  const to = Array.isArray(fm.to)
    ? fm.to.filter((x): x is string => typeof x === "string").join(",")
    : typeof fm.to === "string"
    ? fm.to
    : "";
  const date = typeof fm.date === "string" ? fm.date : "";
  const status = typeof fm.status === "string" ? fm.status : "";
  const bodyHash =
    typeof fm.body_hash === "string" ? fm.body_hash : "";

  const typeToken = useColor
    ? `${colorForType(type)}${type}${COLOR_RESET}`
    : type;

  const summary =
    `rig-bridge: thread ${threadId} envelope=${index} of ${total} ` +
    `type=${typeToken} file=${env.filename}\n`;

  const fmLines = ["---\n"];
  if (from) fmLines.push(`from: ${from}\n`);
  if (to) fmLines.push(`to: ${to}\n`);
  if (date) fmLines.push(`date: ${date}\n`);
  if (type) fmLines.push(`type: ${type}\n`);
  if (status) fmLines.push(`status: ${status}\n`);
  if (bodyHash) fmLines.push(`body_hash: ${bodyHash}\n`);
  fmLines.push("---\n");

  // Body — render verbatim (no normalization beyond what parseEnvelope
  // already did via normalizeBody). Text mode shows what's on disk.
  const body = env.parsed.body;
  const bodyBlock = body.endsWith("\n") ? body : body + "\n";

  const separator = "===========================\n";

  return summary + fmLines.join("") + bodyBlock + separator;
}

function shouldPage(lineCount: number, json: boolean): boolean {
  if (json) return false;
  if (process.env.RIG_BRIDGE_NO_PAGER === "1") return false;
  if (!process.stdout.isTTY) return false;
  const rows = process.stdout.rows;
  if (typeof rows !== "number" || rows <= 0) return false;
  return lineCount > rows;
}

function tryPipeThroughPager(buffer: string): boolean {
  const pagerEnv = process.env.PAGER;
  const cmd = pagerEnv && pagerEnv.length > 0 ? pagerEnv : "less";
  const parts = cmd.split(/\s+/).filter((s) => s.length > 0);
  if (parts.length === 0) return false;
  const bin = parts[0];
  const baseArgs = parts.slice(1);
  const args = baseArgs.length > 0 ? baseArgs : ["-FIRX"];
  const r = spawnSync(bin, args, {
    input: buffer,
    stdio: ["pipe", "inherit", "inherit"],
  });
  return r.status === 0 && !r.error;
}

export async function runThread(args: ThreadArgs): Promise<ThreadResult> {
  const stdout = args.stdout ?? ((s: string) => process.stdout.write(s));
  const stderr = args.stderr ?? ((s: string) => process.stderr.write(s));

  const root = repoRoot(args.cwd);
  const threadDir = join(root, args.threadId);
  if (!existsSync(threadDir) || !statSync(threadDir).isDirectory()) {
    throw new Error(
      `thread "${args.threadId}" not found in bridge root ${root}`,
    );
  }

  const envelopes = readThreadEnvelopes(threadDir);

  // ---------- JSON mode (L15) ----------
  if (args.json === true) {
    const payload: ThreadJsonShape = {
      schema_version: "1.0",
      thread_id: args.threadId,
      envelope_count: envelopes.length,
      envelopes: envelopes.map((e) => e.parsed),
    };
    stdout(`${JSON.stringify(payload)}\n`);
    return {
      thread_id: args.threadId,
      envelope_count: envelopes.length,
      envelopes: envelopes.map((e) => e.parsed),
    };
  }

  // ---------- Text mode (L12/L13/L14) ----------
  const useColor = shouldUseColor(args.noColor, false);

  if (envelopes.length === 0) {
    stderr(
      `rig-bridge: thread "${args.threadId}" has no parseable envelopes ` +
        `at ${threadDir}.\n`,
    );
    return {
      thread_id: args.threadId,
      envelope_count: 0,
      envelopes: [],
    };
  }

  const total = envelopes.length;
  const buffer = envelopes
    .map((e, i) => renderBlock(e, i + 1, total, args.threadId, useColor))
    .join("");

  // Page if needed (L13). Skipped in JSON mode (already handled above).
  // Approximate line count by counting newlines in the buffered output.
  const lineCount = (buffer.match(/\n/g) ?? []).length;
  if (shouldPage(lineCount, false)) {
    const paged = tryPipeThroughPager(buffer);
    if (!paged) {
      stdout(buffer);
    }
  } else {
    stdout(buffer);
  }

  stderr(
    `rig-bridge: rendered ${total} envelope(s) for thread ${args.threadId}.\n`,
  );

  return {
    thread_id: args.threadId,
    envelope_count: total,
    envelopes: envelopes.map((e) => e.parsed),
  };
}

// Exported for tests + future composability.
export const _internal = {
  chronoOrder,
  shouldUseColor,
  shouldPage,
  colorForType,
  renderBlock,
};
