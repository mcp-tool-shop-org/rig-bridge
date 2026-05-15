// findPeerRigs — scan the bridge for non-self counterpart rig-ids and
// rank them by appearance count.
//
// This is the engine-side refactor of `inferPeerRig` previously embedded
// in src/commands/close.ts. Same shape (walks all threads, parses every
// .md envelope, collects from/to rig-ids), refactored into the engine
// where it belongs so:
//   * The Phase 7 `relay` and `sync` commands can ask the same question
//     ("who are my peers and how active are they?") without duplicating
//     the directory scan.
//   * The result is exposed as a sorted array (`RigCount[]`) rather than
//     a single "best peer" — the engine surfaces structured data and
//     lets callers pick what they need.
//   * Validation flows through `validateRigId` so a single malformed
//     rig-id in a stale envelope cannot poison the counts.
//
// Rig-id normalization (B-ENG-003): every candidate id is normalized
// (trim + lowercase) at the ingress point before equality + validation,
// so a Phase-0-era envelope with mixed-case rig-ids does not produce
// divergent canonical peer counts.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseEnvelope } from "./envelope.js";
import { normalizeRigId, validateRigId } from "./rig-id.js";

// Match the thread-id pattern from the schema. Centralizing it here
// (and in threads.ts) keeps the bridge-directory walking helpers in
// sync with the wire format. If the pattern ever changes, both files
// move together.
const THREAD_ID_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export interface RigCount {
  rig_id: string;
  envelope_count: number;
}

// Walk a thread directory and collect rig-id appearances from every
// parseable envelope. Silent on parse failures — a single corrupt file
// must not crash the whole peer-discovery walk. Adds each appearance
// once per envelope (a from-self envelope adds the recipient; a to-self
// envelope adds the sender). The caller filters out `selfRigId`.
function tallyThread(
  threadDir: string,
  counts: Map<string, number>,
): void {
  let entries: string[];
  try {
    entries = readdirSync(threadDir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.endsWith(".md")) continue;
    const full = join(threadDir, e);
    let raw: string;
    try {
      raw = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    let env;
    try {
      env = parseEnvelope(raw);
    } catch {
      continue;
    }
    const fm = env.frontmatter;
    const candidates: unknown[] = [];
    if (typeof fm.from === "string") candidates.push(fm.from);
    if (typeof fm.to === "string") candidates.push(fm.to);
    else if (Array.isArray(fm.to)) {
      for (const x of fm.to) {
        if (typeof x === "string") candidates.push(x);
      }
    }
    for (const c of candidates) {
      if (typeof c !== "string") continue;
      const norm = normalizeRigId(c);
      if (!validateRigId(norm).ok) continue;
      counts.set(norm, (counts.get(norm) ?? 0) + 1);
    }
  }
}

export function findPeerRigs(
  bridgeRoot: string,
  selfRigId: string,
): RigCount[] {
  // Normalize self at the ingress so a caller passing "Mac-M5max" still
  // gets filtered correctly. We do not validate the input — invalid
  // selfRigIds simply won't be matched by any normalized candidate, and
  // the result will (correctly) include every other id.
  const normalizedSelf = normalizeRigId(selfRigId);

  let entries: string[];
  try {
    entries = readdirSync(bridgeRoot);
  } catch {
    return [];
  }

  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
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

    tallyThread(threadDir, counts);
  }

  // Filter out self.
  counts.delete(normalizedSelf);

  // Sort by count desc, then rig_id asc as a deterministic tiebreaker.
  const result: RigCount[] = [];
  for (const [rig_id, envelope_count] of counts) {
    result.push({ rig_id, envelope_count });
  }
  result.sort((a, b) => {
    if (a.envelope_count !== b.envelope_count) {
      return b.envelope_count - a.envelope_count;
    }
    return a.rig_id < b.rig_id ? -1 : a.rig_id > b.rig_id ? 1 : 0;
  });
  return result;
}
