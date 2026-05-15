// `rig-bridge sync [--auto] [--json]` — read-only inspection of remote
// state with an opt-in fast-forward pull.
//
// Sequence:
//   1. Resolve repo + load .bridge/config.yaml.
//   2. Call gitDiffSinceLastSync(bridgeRoot, null) — fetches the remote
//      tracking ref but never pulls. The helper enforces L1 (auto-resolve
//      only the FF case) and L2 (append-only — any modify/rename/delete
//      flips fast_forward_eligible=false).
//   3. If the diff is FF-eligible AND --auto was passed, call safePull.
//      Else: show the operator what WOULD pull and refuse without --auto.
//   4. If diverged or not FF-eligible: refuse the pull. Stdout carries
//      the contract line; stderr carries the divergence report.
//
// Architectural locks honored:
//   L1 — sync auto-resolves ONLY the fast-forward case. Diverged or
//        modified-in-place → refuse + surface (research grounding:
//        Owhadi-Kareshk 2019 "1-in-5 OSS merges conflict, manual-
//        intervention conflict code is 26× more bug-likely"; Tao 2021
//        "bad merges run 10-20% at Microsoft scale; tools hiding
//        conflicts lose net").
//   L2 — envelopes are append-only with stable IDs; sync NEVER content-
//        merges two envelopes. The gitDiffSinceLastSync helper flips
//        fast_forward_eligible=false on any non-A diff filter.
//   L4 — surface everything at the sync boundary. The operator just
//        typed `sync` — cheapest moment to show divergence per Iqbal &
//        Horvitz 2007 (task boundaries cost ~10min recovery vs ~20-25min
//        mid-task). Defer-to-later costs ~2× recovery.
//   L14-L16 — stdout = data (key=value); stderr = narrative. --json
//        opt-in, schema_version=1.0 pinned on every JSON object.
//
// OUTPUT DISCIPLINE (B-CMD-002 / B-CMD-003, Stage C wave 1):
//   * stdout is the stable, parseable contract:
//       rig-bridge: sync pulled=<bool> fast_forward=<bool> diverged=<bool> new_envelopes=<N>
//     The contract line is single-line key=value pairs. Scripts that
//     pipe stdout to awk get reliable parse without re-reading the diff.
//   * stderr is the human narrative — full divergence report, operator
//     recovery hints ("Run `rig-bridge sync --auto` to fast-forward").
//   * --json emits the full SyncDiff under `divergence_report` so a
//     consumer (control-plane, CI) can reason structurally.

import { repoRoot, safePull } from "../engine/git.js";
import {
  gitDiffSinceLastSync,
  type SyncDiff,
} from "../engine/git-diff.js";

const SCHEMA_VERSION = "1.0";

export interface SyncArgs {
  cwd: string;
  /** When true AND the diff is fast-forward-eligible, perform the pull. */
  auto?: boolean;
  /** Emit machine-readable JSON to stdout instead of the text contract. */
  json?: boolean;
  /** L16: disable color reservation if --no-color or NO_COLOR env. Reserved for future state-color rendering. */
  noColor?: boolean;
  /** stdout writer (injected for tests). */
  stdout?: (line: string) => void;
  /** stderr writer (injected for tests). */
  stderr?: (line: string) => void;
}

export interface SyncResult {
  pulled: boolean;
  fast_forward_eligible: boolean;
  diverged: boolean;
  new_envelopes: number;
  divergence_report?: SyncDiff;
}

// Render the divergence-report narrative to stderr. Called when the
// caller refuses to pull because the remote has modified, renamed, or
// deleted files (L2) — the operator needs to know exactly what changed
// and what recovery to perform. The narrative is multi-line and reads
// top-down: header → per-file lines → recovery hint.
function renderDivergenceReport(
  diff: SyncDiff,
  stderr: (s: string) => void,
): void {
  stderr(`rig-bridge: sync refused — remote state cannot be fast-forwarded\n`);
  stderr(`  local_head:  ${diff.local_head}\n`);
  stderr(`  remote_head: ${diff.remote_head}\n`);
  if (diff.new_envelopes.length > 0) {
    stderr(`\nNew envelopes the remote has (would have been pulled):\n`);
    for (const n of diff.new_envelopes) {
      stderr(`  + ${n.path}  (thread: ${n.thread_id})\n`);
    }
  }
  if (diff.changed_envelopes.length > 0) {
    stderr(`\nFiles changed on remote (append-only rule violated):\n`);
    for (const c of diff.changed_envelopes) {
      stderr(`  ! ${c.path}  — ${c.reason}\n`);
    }
  }
  stderr(
    `\nRecovery:  cd <bridge-root>; git pull --rebase   (resolve manually, then re-run \`rig-bridge sync\`)\n`,
  );
}

// Render the fast-forward preview to stderr when the operator typed
// `sync` without --auto. Shows what WOULD pull and the one-line hint
// to actually do it. Per L4, we surface at the sync boundary — this is
// the cheapest moment to show what's coming.
function renderFastForwardPreview(
  diff: SyncDiff,
  stderr: (s: string) => void,
): void {
  const n = diff.new_envelopes.length;
  stderr(`rig-bridge: sync ready to fast-forward ${n} envelope${n === 1 ? "" : "s"}\n`);
  stderr(`  local_head:  ${diff.local_head}\n`);
  stderr(`  remote_head: ${diff.remote_head}\n`);
  if (n > 0) {
    stderr(`\nNew envelopes:\n`);
    for (const ne of diff.new_envelopes) {
      stderr(`  + ${ne.path}  (thread: ${ne.thread_id})\n`);
    }
  }
  stderr(`\nRun \`rig-bridge sync --auto\` to fast-forward ${n} envelope${n === 1 ? "" : "s"}.\n`);
}

// Build the JSON payload for --json mode. Includes the schema_version
// per L15 and a `divergence_report` field carrying the full SyncDiff
// for downstream consumers (control-plane, CI) that want structural
// access to the new/changed lists.
function buildJsonPayload(
  pulled: boolean,
  diff: SyncDiff,
): Record<string, unknown> {
  return {
    schema_version: SCHEMA_VERSION,
    pulled,
    fast_forward_eligible: diff.fast_forward_eligible,
    diverged: diff.diverged,
    new_envelopes_count: diff.new_envelopes.length,
    changed_envelopes_count: diff.changed_envelopes.length,
    local_head: diff.local_head,
    remote_head: diff.remote_head,
    divergence_report: diff,
  };
}

export async function runSync(args: SyncArgs): Promise<SyncResult> {
  const stdout = args.stdout ?? ((s: string) => process.stdout.write(s));
  const stderr = args.stderr ?? ((s: string) => process.stderr.write(s));

  const root = repoRoot(args.cwd);

  // lastKnownSha is reserved for v1.1 sync-state tracking. v1.0.0 always
  // compares local..remote against the configured upstream.
  const diff = gitDiffSinceLastSync(root, null);
  const newCount = diff.new_envelopes.length;

  // Case 1: fast-forward eligible (L1 + L2 happy path).
  if (diff.fast_forward_eligible && !diff.diverged) {
    if (args.auto) {
      // Operator opted in. Perform the pull. The L1 "auto-resolve only
      // the FF case" rule is honored because gitDiffSinceLastSync only
      // flips fast_forward_eligible=true when no path was modified, no
      // rename happened, and the local side is not also ahead.
      safePull(root);
      const result: SyncResult = {
        pulled: true,
        fast_forward_eligible: true,
        diverged: false,
        new_envelopes: newCount,
      };
      if (args.json) {
        stdout(`${JSON.stringify(buildJsonPayload(true, diff))}\n`);
      } else {
        stdout(
          `rig-bridge: sync pulled=true fast_forward=true diverged=false new_envelopes=${newCount}\n`,
        );
        stderr(
          `rig-bridge: fast-forwarded ${newCount} envelope${newCount === 1 ? "" : "s"} from origin/main\n`,
        );
      }
      return result;
    }

    // Default behavior — show what WOULD pull and refuse without --auto.
    // L4: the operator just typed `sync` — cheapest moment to surface.
    const result: SyncResult = {
      pulled: false,
      fast_forward_eligible: true,
      diverged: false,
      new_envelopes: newCount,
    };
    if (args.json) {
      stdout(`${JSON.stringify(buildJsonPayload(false, diff))}\n`);
    } else {
      stdout(
        `rig-bridge: sync pulled=false fast_forward=true diverged=false new_envelopes=${newCount}\n`,
      );
      // Only narrate when there's actually something to pull — a
      // no-op sync (local==remote, zero new) doesn't need a "ready
      // to fast-forward 0 envelopes" preamble.
      if (newCount > 0) {
        renderFastForwardPreview(diff, stderr);
      } else {
        stderr(`rig-bridge: sync — local is up to date with origin/main\n`);
      }
    }
    return result;
  }

  // Case 2: diverged or not FF-eligible (L1 + L2 refusal path).
  // NEVER silently merge. NEVER force-push. Append-only discipline.
  const shortReason =
    diff.changed_envelopes.length > 0
      ? "non_append_change_on_remote"
      : diff.diverged
        ? "both_sides_diverged"
        : "not_fast_forward_eligible";

  const result: SyncResult = {
    pulled: false,
    fast_forward_eligible: diff.fast_forward_eligible,
    diverged: diff.diverged,
    new_envelopes: newCount,
    divergence_report: diff,
  };
  if (args.json) {
    stdout(`${JSON.stringify(buildJsonPayload(false, diff))}\n`);
  } else {
    stdout(
      `rig-bridge: sync pulled=false diverged=${diff.diverged} reason=${shortReason}\n`,
    );
    renderDivergenceReport(diff, stderr);
  }
  return result;
}
