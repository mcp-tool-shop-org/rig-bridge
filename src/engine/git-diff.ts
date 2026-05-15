// gitDiffSinceLastSync — read-only inspection of the local-vs-remote
// state of the bridge repo, returning a structured SyncDiff that the
// Phase 7 `sync` command can use to decide whether to fast-forward
// (L1) or refuse + surface (L1 + L4).
//
// Architectural locks honored:
//   L1 — auto-resolve ONLY the fast-forward case. New files inside
//        known thread directories are FF-eligible. Anything else (an
//        existing envelope was modified in-place, a file landed
//        outside a thread directory, both sides have unique commits)
//        flips fast_forward_eligible=false. The caller MUST refuse
//        the auto-pull and surface the divergence.
//   L2 — envelopes are append-only. A `--diff-filter=M` hit on any
//        path triggers diverged=true and a clear `reason` per file
//        so the operator sees exactly what was changed.
//   L4 — `sync` is the cheapest moment to surface divergence; this
//        helper returns ALL signals (new + changed + diverged) so the
//        caller can render them at the boundary in one render pass.
//
// Side-effects: this helper performs `git fetch` to refresh the
// remote-tracking refs, but NEVER pulls and NEVER pushes. The caller
// decides whether to `safePull` based on the SyncDiff. `lastKnownSha`
// is reserved for future "since last sync" callers; for v1.0.0 the
// comparison is always `local..remote` against the configured upstream.

import { join } from "node:path";
import { runGit, GitError } from "./git.js";

// Thread-id pattern (matches schema). Centralized in threads.ts and
// peer-rigs.ts already; re-stated here so this module is independently
// readable and avoids creating an internal helper module just for one
// regex. If the pattern ever changes, all three sites move together.
const THREAD_ID_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export interface NewEnvelope {
  path: string; // repo-relative path, forward-slash normalized
  thread_id: string;
  sha: string; // commit SHA that introduced the file (remote HEAD if multi-commit batch)
}

export interface ChangedEnvelope {
  path: string;
  reason: string; // human-readable reason — "modified in place", "rename detected", etc.
}

export interface SyncDiff {
  fast_forward_eligible: boolean; // L1: only auto-resolve when true
  new_envelopes: NewEnvelope[];
  changed_envelopes: ChangedEnvelope[]; // L2: append-only enforcement
  diverged: boolean; // both sides have unique commits, OR any file modified
  remote_head: string; // SHA of remote tracking branch (or "" if unknown)
  local_head: string; // SHA of local HEAD (or "" if unknown)
}

// Note on lastKnownSha: this parameter is reserved for the v1.1
// "since-last-sync" use case (e.g. a control-plane writer storing the
// last successfully reconciled SHA and asking "show me everything new
// since then"). For v1.0.0 the comparison is always local..remote.
// Accept the parameter today so adding behavior later is non-breaking.
// The leading underscore prefix tells the TS noUnusedParameters check
// "intentionally unused" without resorting to ts-ignore.
export function gitDiffSinceLastSync(
  bridgeRoot: string,
  _lastKnownSha: string | null,
): SyncDiff {
  // Default empty result — used when we can't talk to git or no upstream
  // is configured. The fast_forward_eligible flag is false because we
  // can't prove FF-safety without remote refs.
  const empty: SyncDiff = {
    fast_forward_eligible: false,
    new_envelopes: [],
    changed_envelopes: [],
    diverged: false,
    remote_head: "",
    local_head: "",
  };

  // Resolve the current branch first; we need its upstream to compare.
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"], bridgeRoot);
  if (branch.status !== 0) {
    throw new GitError(`git rev-parse HEAD failed`, branch.stderr);
  }
  const branchName = branch.stdout.trim();
  if (!branchName || branchName === "HEAD") {
    throw new GitError(
      `cannot diff: detached HEAD (no current branch). Check out a branch first.`,
    );
  }

  // Upstream ref — typically `origin/main`. If no upstream is configured
  // the operator cannot pull; surface a clean error.
  const upstream = runGit(
    ["rev-parse", "--abbrev-ref", `${branchName}@{upstream}`],
    bridgeRoot,
  );
  if (upstream.status !== 0) {
    throw new GitError(
      `branch "${branchName}" has no upstream configured. ` +
        `Set one with: git push --set-upstream origin ${branchName}`,
      upstream.stderr,
    );
  }
  const upstreamRef = upstream.stdout.trim();

  // Fetch — refresh the remote tracking refs but do NOT pull.
  const fetch = runGit(["fetch"], bridgeRoot);
  if (fetch.status !== 0) {
    throw new GitError(`git fetch failed`, fetch.stderr);
  }

  // Resolve local + remote heads.
  const localHead = runGit(["rev-parse", "HEAD"], bridgeRoot);
  if (localHead.status !== 0) {
    return empty;
  }
  const remoteHead = runGit(["rev-parse", upstreamRef], bridgeRoot);
  if (remoteHead.status !== 0) {
    return { ...empty, local_head: localHead.stdout.trim() };
  }
  const localSha = localHead.stdout.trim();
  const remoteSha = remoteHead.stdout.trim();

  // If they're equal, nothing to do — fast-forward-eligible only in the
  // trivial sense (no-op).
  if (localSha === remoteSha) {
    return {
      fast_forward_eligible: true,
      new_envelopes: [],
      changed_envelopes: [],
      diverged: false,
      remote_head: remoteSha,
      local_head: localSha,
    };
  }

  // local..remote — commits the remote has that local does not.
  const ahead = runGit(
    ["rev-list", "--count", `HEAD..${upstreamRef}`],
    bridgeRoot,
  );
  // remote..local — commits local has that remote does not.
  const behind = runGit(
    ["rev-list", "--count", `${upstreamRef}..HEAD`],
    bridgeRoot,
  );
  if (ahead.status !== 0 || behind.status !== 0) {
    throw new GitError(
      `git rev-list failed`,
      ahead.stderr || behind.stderr,
    );
  }
  const remoteAhead = Number(ahead.stdout.trim()) || 0;
  const localAhead = Number(behind.stdout.trim()) || 0;

  // Both sides have unique commits → diverged. Not FF-eligible.
  // (We still collect the new/changed files so the caller can show
  // exactly what the remote brings.)
  const bothDiverged = remoteAhead > 0 && localAhead > 0;

  // If the remote has nothing new, local is purely ahead — there is
  // nothing to pull. Treat this as fast-forward-eligible=true and zero
  // new/changed files; the caller's `sync` will report "nothing to
  // pull" and likely push instead.
  if (remoteAhead === 0) {
    return {
      fast_forward_eligible: true,
      new_envelopes: [],
      changed_envelopes: [],
      diverged: false,
      remote_head: remoteSha,
      local_head: localSha,
    };
  }

  // Collect changed paths between HEAD and upstream. We split into:
  //   * A (added) — strictly-new files
  //   * everything else (M/R/T/C/D) — flag as changed_envelopes with
  //     a reason; this is the L2 append-only enforcement.
  // We deliberately run two `git diff --name-only --diff-filter=...`
  // invocations so the kinds are surfaced as separate lists.
  const added = runGit(
    [
      "diff",
      "--name-only",
      "--diff-filter=A",
      `HEAD..${upstreamRef}`,
    ],
    bridgeRoot,
  );
  if (added.status !== 0) {
    throw new GitError(`git diff (added) failed`, added.stderr);
  }
  const changed = runGit(
    [
      "diff",
      "--name-status",
      "--diff-filter=MRTCD",
      `HEAD..${upstreamRef}`,
    ],
    bridgeRoot,
  );
  if (changed.status !== 0) {
    throw new GitError(`git diff (changed) failed`, changed.stderr);
  }

  const newEnvelopes: NewEnvelope[] = [];
  const changedEnvelopes: ChangedEnvelope[] = [];

  // Parse the `A`-filter output — one path per line.
  for (const rawLine of added.stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    // Normalize path separators to forward-slash for cross-platform
    // consistency (git always emits forward slashes — but we make the
    // post-processing rule explicit so downstream comparisons against
    // `node:path.join` outputs work on Windows too).
    const norm = line.replace(/\\/g, "/");
    const segments = norm.split("/");
    const threadCandidate = segments[0];
    const isUnderThread =
      segments.length >= 2 &&
      THREAD_ID_PATTERN.test(threadCandidate) &&
      norm.endsWith(".md");
    if (isUnderThread) {
      newEnvelopes.push({
        path: norm,
        thread_id: threadCandidate,
        sha: remoteSha,
      });
    } else {
      // A new file that is NOT inside a thread directory — for example,
      // a top-level README change, a CI file edit, a docs change. The
      // caller can still surface these; we mark them as "changed" with
      // a clear reason so they show up in the diverged-bucket.
      changedEnvelopes.push({
        path: norm,
        reason: "new file outside a known thread directory",
      });
    }
  }

  // Parse the M/R/T/C/D output — each line is "<status>\t<path>" (or
  // "<status>\t<old>\t<new>" for renames). We collapse to a single
  // path + a reason string for the caller.
  for (const rawLine of changed.stdout.split("\n")) {
    const line = rawLine.replace(/[\r\n]+$/, "");
    if (!line) continue;
    // git --name-status uses TAB as the column separator.
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const status = parts[0];
    const path = (parts[2] ?? parts[1]).replace(/\\/g, "/");
    let reason = `unknown change (${status})`;
    if (status.startsWith("M")) reason = "modified in place (append-only rule violated)";
    else if (status.startsWith("R")) reason = "rename detected (envelopes must not move)";
    else if (status.startsWith("C")) reason = "copy detected";
    else if (status.startsWith("T")) reason = "type change detected";
    else if (status.startsWith("D")) reason = "file deleted on remote";
    changedEnvelopes.push({ path, reason });
  }

  // Fast-forward eligibility (L1 + L2):
  //   * Neither side may be diverged (both ahead).
  //   * Zero changed_envelopes (no M/R/T/C/D, no new-outside-thread).
  //   * At least one new_envelope inside a thread dir (otherwise the
  //     remote contains commits that affect only non-envelope paths,
  //     which is not what `sync` auto-resolves — surface for review).
  const ffEligible =
    !bothDiverged &&
    changedEnvelopes.length === 0 &&
    newEnvelopes.length > 0;

  return {
    fast_forward_eligible: ffEligible,
    new_envelopes: newEnvelopes,
    changed_envelopes: changedEnvelopes,
    diverged: bothDiverged || changedEnvelopes.length > 0,
    remote_head: remoteSha,
    local_head: localSha,
  };
}

// Re-export for convenience — callers that need to construct a join
// path can use node:path directly, but exposing it once here means
// downstream tooling reading this module's surface doesn't have to
// chase imports. Kept internal — not re-exported via index.ts.
export const _internal = { join, THREAD_ID_PATTERN };
