// listThreads — directory-scan helper that returns per-thread summaries
// for the Phase 7 `status` command and any v1.1 control-plane consumer
// that needs an at-a-glance picture of the bridge.
//
// Architectural lock L10 (Phase 7 study swarm, 2026-05-15) constrains the
// status surface to 4-5 columns sorted by recency desc. Hick's Law L10 is
// load-bearing here: any caller that renders a table from this output
// must respect the recency-first ordering this helper guarantees.
//
// Architectural lock L12 (small-multiples thread rendering) also reads
// this same per-envelope shape — `thread <id>` and `status` therefore
// share a single source-of-truth derivation: parse the envelope, read
// its frontmatter, map to ThreadSummary.
//
// Stability contract: ThreadSummary + EnvelopeRef are part of the v1.1
// engine API surface. Renames or signature changes are breaking; new
// optional fields are additive and allowed.
//
// Cross-platform: thread directories are listed via readdirSync and
// joined with `node:path` join so Windows path separators are handled
// uniformly. The thread-id pattern matches the schema's pattern
// (`^[a-z0-9][a-z0-9-]*[a-z0-9]$`) to filter out repository plumbing
// directories such as `.git`, `.bridge`, `node_modules`, and `dist`.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseEnvelope } from "./envelope.js";
import { markerToStatusClass, type StatusClass } from "./status.js";

// Thread-id pattern — must match the schema's pattern from
// schemas/bridge-message.schema.json (the `thread` field's `pattern`
// constraint). Centralizing the pattern here means any future relaxation
// or tightening on the wire travels with this helper too.
const THREAD_ID_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export interface EnvelopeRef {
  filename: string;
  type: string; // HANDOFF, RESPONSE, RESOLUTION, etc.
  date: string; // YYYY-MM-DD or full ISO timestamp (whatever the frontmatter carried)
  from: string;
  to: string | string[];
}

export interface ThreadSummary {
  thread_id: string;
  envelope_count: number; // total envelope files (REQUEST, HANDOFF, RESPONSE, ACK, RESOLUTION, …)
  is_closed: boolean; // RESOLUTION.md present?
  latest_envelope: EnvelopeRef;
  status_class: StatusClass; // derived from the latest envelope's status marker
  last_modified: Date;
}

// Internal — read a single envelope into a ref-or-null tuple. Parse and
// I/O failures are silenced into nulls so a single corrupt file in a
// thread directory doesn't tank the whole listing. The caller dedupes
// nulls. This is deliberately tolerant — Phase 7's `status` is meant
// to glance, not validate the corpus.
interface RawEnvelopeRead {
  ref: EnvelopeRef;
  mtime: Date;
  status: string | null;
}

function tryReadEnvelope(
  threadDir: string,
  filename: string,
): RawEnvelopeRead | null {
  const full = join(threadDir, filename);
  let st;
  try {
    st = statSync(full);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  let raw: string;
  try {
    raw = readFileSync(full, "utf8");
  } catch {
    return null;
  }
  let env;
  try {
    env = parseEnvelope(raw);
  } catch {
    return null;
  }
  const fm = env.frontmatter;
  const type = typeof fm.type === "string" ? fm.type : "";
  const date = typeof fm.date === "string" ? fm.date : "";
  const from = typeof fm.from === "string" ? fm.from : "";
  let to: string | string[] = "";
  if (typeof fm.to === "string") to = fm.to;
  else if (Array.isArray(fm.to)) {
    const strs = fm.to.filter((x): x is string => typeof x === "string");
    to = strs;
  }
  const status = typeof fm.status === "string" ? fm.status : null;
  return {
    ref: { filename, type, date, from, to },
    mtime: st.mtime,
    status,
  };
}

// Pick the most-recent envelope from a list. Prefer mtime — per the
// helper's contract ("mtime is more reliable for git-cloned files,"
// dispatch line) — and break ties on filename for determinism. Returns
// null when the input is empty.
function pickLatest(reads: RawEnvelopeRead[]): RawEnvelopeRead | null {
  if (reads.length === 0) return null;
  let best = reads[0];
  for (let i = 1; i < reads.length; i++) {
    const r = reads[i];
    if (r.mtime > best.mtime) {
      best = r;
    } else if (r.mtime.getTime() === best.mtime.getTime()) {
      // Stable tiebreaker — lexicographic on filename so two envelopes
      // written the same millisecond produce a deterministic latest.
      if (r.ref.filename > best.ref.filename) best = r;
    }
  }
  return best;
}

// Default fallback when the latest envelope's status marker is not one
// of the canonical five (▶ ⏸ 🎯 ✅ ❌). The bridge's wire enforces
// these via the schema, but `listThreads` runs against on-disk content
// that may pre-date schema enforcement (Phase 0 corpus) — fall back to
// "active" so the column never crashes a status render. Status-class
// derivation is best-effort here.
const FALLBACK_STATUS_CLASS: StatusClass = "active";

export function listThreads(bridgeRoot: string): ThreadSummary[] {
  // The bridgeRoot must exist and be a directory; otherwise return [].
  // We don't throw — `status` callers typically run from a fresh repo
  // that has never had a thread, and the empty-list answer is correct.
  let entries: string[];
  try {
    entries = readdirSync(bridgeRoot);
  } catch {
    return [];
  }

  const summaries: ThreadSummary[] = [];

  for (const entry of entries) {
    // Skip dotfiles/dotdirs — `.git`, `.bridge`, anything hidden.
    if (entry.startsWith(".")) continue;
    // Skip known plumbing dirs by name. The thread-id pattern alone
    // would reject `node_modules` and `dist` (underscore in
    // node_modules; "dist" passes the pattern but is excluded
    // explicitly so a bridge repo with a build dir doesn't surface a
    // ghost thread). This list is short by design — the bridge root
    // is meant to contain thread dirs and `.bridge/`.
    if (entry === "node_modules" || entry === "dist") continue;
    if (!THREAD_ID_PATTERN.test(entry)) continue;

    const threadDir = join(bridgeRoot, entry);
    let st;
    try {
      st = statSync(threadDir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    let files: string[];
    try {
      files = readdirSync(threadDir);
    } catch {
      continue;
    }
    // Restrict to .md files — schema-bound envelopes. Other files
    // (README scratchpads, etc.) are not envelopes and don't count
    // toward envelope_count.
    const mdFiles = files.filter((f) => f.endsWith(".md"));

    const reads: RawEnvelopeRead[] = [];
    for (const f of mdFiles) {
      const r = tryReadEnvelope(threadDir, f);
      if (r) reads.push(r);
    }
    if (reads.length === 0) continue; // not really a thread, no parseable envelopes

    const isClosed = existsSync(join(threadDir, "RESOLUTION.md"));
    const latest = pickLatest(reads);
    if (!latest) continue;

    let statusClass: StatusClass = FALLBACK_STATUS_CLASS;
    if (latest.status) {
      try {
        statusClass = markerToStatusClass(latest.status);
      } catch {
        // Unknown marker — keep fallback. status's
        // UnrecognizedMarkerError is the gate for write paths; here
        // we degrade gracefully on read.
      }
    }

    summaries.push({
      thread_id: entry,
      envelope_count: reads.length,
      is_closed: isClosed,
      latest_envelope: latest.ref,
      status_class: statusClass,
      last_modified: latest.mtime,
    });
  }

  // L10: recency-first ordering. Lower-precision tiebreak on thread_id
  // alphabetic-asc so equal-mtime threads sort deterministically.
  summaries.sort((a, b) => {
    if (a.last_modified.getTime() !== b.last_modified.getTime()) {
      return b.last_modified.getTime() - a.last_modified.getTime();
    }
    return a.thread_id < b.thread_id ? -1 : a.thread_id > b.thread_id ? 1 : 0;
  });

  return summaries;
}
