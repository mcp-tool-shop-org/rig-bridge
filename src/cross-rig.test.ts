// Cross-rig round-trip integration tests — the FT-TST-001 CRITICAL category
// surfaced by Phase 5 feature audit.
//
// The unit smoke test (src/smoke.test.ts) proves the local pipeline:
//   init → new → send → close on ONE clone, body_hash invariant on local disk.
//
// What that test CANNOT prove is the cross-rig load-bearing scenario:
//
//   1. Rig A writes an envelope and pushes
//   2. Rig B pulls
//   3. Rig B re-hashes the body
//   4. The re-hashed value matches the persisted body_hash
//
// That four-step round-trip is THE invariant that makes rig-bridge a
// cross-rig sync tool instead of a glorified per-rig logger. If a
// Mac-authored envelope arrives on Windows with `core.autocrlf=true` and
// the line endings flip to CRLF, the §4.1 normalization in normalizeBody()
// (engine/body-hash.ts) MUST collapse them back to LF before hashing so
// the cross-rig hash matches.
//
// These tests construct two (or three) independent git working trees that
// share a bare-repo "remote" and exercise the full transport — push from
// A, pull on B, re-parse + re-hash on B, assert equality. They are slower
// than the unit smoke test because every test spawns multiple `git` subprocs,
// but they are the only place this property is actually proven.
//
// References:
//   * docs/control-plane-integration.md §4.1 — body normalization rule
//   * src/engine/body-hash.ts — implementation
//   * src/smoke.test.ts — single-rig version of these checks
//   * src/engine/git.test.ts — the B-TST-001 cleanup pattern used here

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runInit } from "./commands/init.js";
import { runNew } from "./commands/new.js";
import { runSend } from "./commands/send.js";
import { parseEnvelope } from "./engine/envelope.js";
import { bodyHash } from "./engine/body-hash.js";

// B-TST-001 (Stage C wave 1): wrap teardown so a transient Windows
// file-lock or a swallowed error surfaces in test output instead of
// silently corrupting the next test's environment.
function cleanupTempDir(p: string): void {
  try {
    rmSync(p, { recursive: true, force: true, maxRetries: 3 });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("temp cleanup failed for", p, e);
  }
}

// Configure a freshly-cloned working tree with deterministic git identity
// and disabled GPG signing so commits don't prompt for keys in CI.
function configureClone(
  dir: string,
  name: string,
  email: string,
  opts?: { autocrlf?: boolean },
): void {
  spawnSync("git", ["config", "user.email", email], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", name], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "commit.gpgsign", "false"], {
    cwd: dir,
    encoding: "utf8",
  });
  if (opts?.autocrlf) {
    // Simulate Windows default (core.autocrlf=true) — on checkout, LF in
    // tree becomes CRLF on disk; on commit, CRLF on disk becomes LF in
    // tree. This is the canonical line-ending drift that §4.1
    // normalization must survive.
    spawnSync("git", ["config", "core.autocrlf", "true"], {
      cwd: dir,
      encoding: "utf8",
    });
  }
}

// Make a bare repo that acts as the shared "remote" (the GitHub equivalent
// for the bridge-scratch repo). All clones push/pull through this bare.
function makeBareRemote(label: string): string {
  const bare = mkdtempSync(join(tmpdir(), `rig-bridge-${label}-bare-`));
  const r = spawnSync("git", ["init", "--bare", "-b", "main", bare], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error(`failed to init bare repo at ${bare}: ${r.stderr}`);
  }
  return bare;
}

// Create a fresh working clone of `bare`. Requires that `bare` already has
// at least one commit on `main` (otherwise git refuses to clone a branch
// that does not exist yet — that's why the suite's beforeEach seeds rigA
// via `git init` + push BEFORE cloning rigB.
function cloneFromBare(bare: string, label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `rig-bridge-${label}-clone-`));
  const r = spawnSync("git", ["clone", "-b", "main", bare, dir], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error(`clone failed: ${r.stderr}`);
  }
  return dir;
}

// Initialize a NEW (non-cloned) working tree and wire it to a bare remote.
// Used to seed rigA on the first iteration where the bare is still empty
// — we can't clone from an empty bare, so we init + add remote + push.
function initAndWireToBare(label: string, bare: string): string {
  const dir = mkdtempSync(join(tmpdir(), `rig-bridge-${label}-init-`));
  spawnSync("git", ["init", "-b", "main", dir], { encoding: "utf8" });
  spawnSync("git", ["remote", "add", "origin", bare], {
    cwd: dir,
    encoding: "utf8",
  });
  return dir;
}

// Push a clone's main back to its origin.
function pushMain(dir: string): { status: number; stderr: string } {
  const r = spawnSync("git", ["push", "origin", "main"], {
    cwd: dir,
    encoding: "utf8",
  });
  return { status: r.status ?? -1, stderr: r.stderr ?? "" };
}

// Pull --rebase into a clone.
function pullRebase(dir: string): { status: number; stderr: string } {
  const r = spawnSync("git", ["pull", "--rebase", "origin", "main"], {
    cwd: dir,
    encoding: "utf8",
  });
  return { status: r.status ?? -1, stderr: r.stderr ?? "" };
}

let bare: string;
let rigA: string;
let rigB: string;
let rigC: string | undefined;

beforeEach(() => {
  // 1. Bare remote (the shared transport).
  bare = makeBareRemote("xrig");

  // 2. Initialize rigA fresh (NOT via clone — bare is empty, so we
  //    `git init` + add the bare as `origin`, then seed + push). After
  //    the first push, `main` exists on bare and subsequent rigs CAN
  //    clone normally.
  rigA = initAndWireToBare("xrig-a", bare);
  configureClone(rigA, "Mac Claude", "mac@test");

  // 3. Seed the bare with an initial commit on main so the second clone
  //    can `clone -b main` cleanly. We write a tiny placeholder, commit,
  //    push.
  writeFileSync(join(rigA, "README.bridge"), "seed\n");
  spawnSync("git", ["add", "README.bridge"], { cwd: rigA, encoding: "utf8" });
  spawnSync("git", ["commit", "-m", "seed"], { cwd: rigA, encoding: "utf8" });
  pushMain(rigA);

  // 4. Clone rigB from the now-seeded bare (the Windows side).
  rigB = cloneFromBare(bare, "xrig-b");
  configureClone(rigB, "Win Claude", "win@test");

  // 5. Initialize the bridge on both sides. rig-bridge init writes
  //    .bridge/config.yaml and the hook — it does NOT make a commit, so
  //    the bare doesn't get out of sync.
  runInit({
    cwd: rigA,
    rigId: "mac-m5max",
    displayName: "Mac Claude",
    stdout: () => {},
    stderr: () => {},
  });
  runInit({
    cwd: rigB,
    rigId: "windows-5080",
    displayName: "Win Claude",
    stdout: () => {},
    stderr: () => {},
  });
});

afterEach(() => {
  if (rigC) cleanupTempDir(rigC);
  cleanupTempDir(rigB);
  cleanupTempDir(rigA);
  cleanupTempDir(bare);
  rigC = undefined;
});

describe("rig-bridge cross-rig round trip (FT-TST-001)", () => {
  // CRITICAL: This is the load-bearing invariant for cross-rig sync.
  // Rig A authors → pushes → Rig B pulls → Rig B re-hashes → match.
  // If this fails, the bridge cannot detect tampering OR cannot survive
  // even editor-level transport drift.
  it("Rig A sends HANDOFF; Rig B pulls; Rig B re-hashes body; body_hash matches", () => {
    // Rig A authors a new thread + HANDOFF.
    runNew({ cwd: rigA, threadId: "alpha", stdout: () => {}, stderr: () => {} });
    const sent = runSend({
      cwd: rigA,
      type: "HANDOFF",
      threadId: "alpha",
      to: ["windows-5080"],
      status: "▶ first turn",
      tldr: "cross-rig round trip",
      bodyText: "# first turn\n\nThis is the body Rig A authored.\n",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    expect(sent.commitSha).toMatch(/^[0-9a-f]{40}$/);

    // Push Rig A's commit to the shared bare. (We used noPush in runSend
    // so we can drive the push explicitly here and catch its result.)
    expect(pushMain(rigA).status).toBe(0);

    // Rig B pulls.
    const pull = pullRebase(rigB);
    expect(pull.status).toBe(0);

    // Rig B reads the HANDOFF.md off disk.
    const onDisk = join(rigB, "alpha", "HANDOFF.md");
    expect(existsSync(onDisk)).toBe(true);
    const raw = readFileSync(onDisk, "utf8");
    const env = parseEnvelope(raw);

    // The persisted body_hash MUST round-trip:
    //   - re-parsing yields the same frontmatter.body_hash
    //   - re-hashing env.body via bodyHash() yields the same value
    expect(env.frontmatter.body_hash).toBe(sent.bodyHash);
    expect(bodyHash(env.body)).toBe(env.frontmatter.body_hash);

    // And rig-identity propagated correctly through the transport.
    expect(env.frontmatter.from).toBe("mac-m5max");
    expect(env.frontmatter.to).toBe("windows-5080");
  });

  // Bidirectional: A → B → A. This proves the body_hash invariant survives
  // a full there-and-back round-trip and that --ref correctly points back
  // to the prior commit SHA.
  it("Bidirectional round-trip: A→B→A with body_hash preserved both directions", () => {
    // A sends HANDOFF.
    runNew({ cwd: rigA, threadId: "beta", stdout: () => {}, stderr: () => {} });
    const aSent = runSend({
      cwd: rigA,
      type: "HANDOFF",
      threadId: "beta",
      to: ["windows-5080"],
      status: "▶ A sends",
      bodyText: "# A's handoff\n\nFirst direction.\n",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    expect(pushMain(rigA).status).toBe(0);

    // B pulls + verifies.
    expect(pullRebase(rigB).status).toBe(0);
    const aFromB = parseEnvelope(
      readFileSync(join(rigB, "beta", "HANDOFF.md"), "utf8"),
    );
    expect(bodyHash(aFromB.body)).toBe(aFromB.frontmatter.body_hash);
    expect(aFromB.frontmatter.body_hash).toBe(aSent.bodyHash);

    // B sends RESPONSE referencing A's commit SHA.
    const bSent = runSend({
      cwd: rigB,
      type: "RESPONSE",
      threadId: "beta",
      to: ["mac-m5max"],
      status: "▶ B responds",
      bodyText: "# B's response\n\nSecond direction.\n",
      references: [aSent.commitSha],
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    expect(pushMain(rigB).status).toBe(0);

    // A pulls + verifies B's RESPONSE.
    expect(pullRebase(rigA).status).toBe(0);
    const bFromA = parseEnvelope(
      readFileSync(join(rigA, "beta", "RESPONSE.md"), "utf8"),
    );
    expect(bodyHash(bFromA.body)).toBe(bFromA.frontmatter.body_hash);
    expect(bFromA.frontmatter.body_hash).toBe(bSent.bodyHash);

    // And A's earlier HANDOFF body_hash still verifies after the round-trip.
    const aFromAStill = parseEnvelope(
      readFileSync(join(rigA, "beta", "HANDOFF.md"), "utf8"),
    );
    expect(bodyHash(aFromAStill.body)).toBe(aFromAStill.frontmatter.body_hash);
    expect(aFromAStill.frontmatter.body_hash).toBe(aSent.bodyHash);
  });

  // CRLF/LF: the canonical cross-platform transport drift case. Rig A
  // authors with LF (Mac default); Rig B pulls with core.autocrlf=true
  // (Windows default), which materializes the file on disk with CRLF
  // line endings. The body_hash MUST still verify because normalizeBody
  // (§4.1 rule 1) collapses CRLF → LF before hashing.
  it("CRLF/LF cross-platform: A sends with LF, B reads with autocrlf=true; body_hash still matches", () => {
    // Reconfigure rigB to behave like a Windows default checkout.
    configureClone(rigB, "Win Claude", "win@test", { autocrlf: true });

    runNew({ cwd: rigA, threadId: "gamma", stdout: () => {}, stderr: () => {} });
    const sent = runSend({
      cwd: rigA,
      type: "HANDOFF",
      threadId: "gamma",
      to: ["windows-5080"],
      status: "▶ LF body",
      bodyText:
        "# LF body\n\nLine one.\nLine two.\nLine three.\n\nFinal paragraph.\n",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    expect(pushMain(rigA).status).toBe(0);

    // B pulls. With autocrlf=true the new HANDOFF.md materializes with
    // CRLF on disk even though the tree-side blob stored LF.
    expect(pullRebase(rigB).status).toBe(0);

    const bRaw = readFileSync(join(rigB, "gamma", "HANDOFF.md"), "utf8");
    // Cross-platform note: on Linux/macOS CI runners, core.autocrlf=true
    // does NOTHING on checkout (it only converts on Windows). On real
    // Windows runners it would actually flip endings. The invariant we
    // care about is that EITHER WAY the hash still matches, so the
    // assertion is platform-neutral.
    const env = parseEnvelope(bRaw);
    expect(env.frontmatter.body_hash).toBe(sent.bodyHash);
    // normalizeBody must collapse whatever ending is on disk back to LF
    // before hashing. If this assertion ever fails, normalizeBody (or
    // someone's edit to it) broke the canonical drift-detection rule.
    expect(bodyHash(env.body)).toBe(env.frontmatter.body_hash);
  });

  // Three-rig topology: Mac + Windows + a third rig (Linux). The HANDOFF
  // is addressed to two recipients. After all three sync, every rig sees
  // the same envelope on disk, and the body_hash verifies on each.
  //
  // Note: rig-bridge's `to` frontmatter is a single-rig-id string per the
  // current schema; multi-recipient addressing happens at the comma-split
  // ingress level. The on-disk envelope can capture only one `to`. We
  // assert what's actually persistable + verifiable today; the three-way
  // visibility we exercise here is that all three rigs share the same
  // append-only file via the bare remote.
  it("Three-rig topology: A + B + C; body_hash matches on all three rig reads", () => {
    rigC = cloneFromBare(bare, "xrig-c");
    configureClone(rigC, "Linux Claude", "linux@test");
    runInit({
      cwd: rigC,
      rigId: "linux-3070",
      displayName: "Linux Claude",
      stdout: () => {},
      stderr: () => {},
    });

    runNew({ cwd: rigA, threadId: "delta", stdout: () => {}, stderr: () => {} });
    const sent = runSend({
      cwd: rigA,
      type: "HANDOFF",
      threadId: "delta",
      // Comma-split at the --to ingress accepts multiple recipients;
      // the envelope persists the first (per the current schema). The
      // important property at this layer is "all three rigs receive the
      // file and verify".
      to: ["windows-5080,linux-3070"],
      status: "▶ broadcast",
      bodyText:
        "# Three-rig broadcast\n\nVisible to mac, windows, and linux.\n",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    expect(pushMain(rigA).status).toBe(0);

    // Each downstream rig pulls + verifies.
    for (const rig of [rigB, rigC]) {
      const pull = pullRebase(rig);
      expect(pull.status).toBe(0);
      const env = parseEnvelope(
        readFileSync(join(rig, "delta", "HANDOFF.md"), "utf8"),
      );
      expect(env.frontmatter.body_hash).toBe(sent.bodyHash);
      expect(bodyHash(env.body)).toBe(env.frontmatter.body_hash);
      // The envelope persists the comma-split `to`. The exact YAML
      // shape (single string vs sequence) is determined by the
      // envelope renderer; we assert what matters at this layer —
      // the on-disk envelope identifies all recipients in some form
      // (either a string with comma or a YAML sequence). Both pass.
      const to = env.frontmatter.to;
      const toAsArray = Array.isArray(to) ? to : [to];
      expect(toAsArray.length).toBeGreaterThan(0);
      // Recipients must include both windows-5080 and linux-3070.
      const flat = toAsArray.map((v) => String(v)).join(",");
      expect(flat).toMatch(/windows-5080/);
      expect(flat).toMatch(/linux-3070/);
    }
  });

  // Conflict surfacing: A and B both author into the same thread without
  // syncing first. B's push fails non-fast-forward; B can recover via the
  // F-CMD-010 documented path (git pull --rebase; git push).
  //
  // This proves the L1 architectural lock from phase7-research-grounding:
  // append-only + per-thread dirs make MOST conflicts fast-forward-able,
  // but a true content conflict (both rigs author into the same thread
  // at the same time) still surfaces as a non-FF push that requires
  // operator action.
  it("Conflict surfacing: parallel sends produce non-FF on B; B recovers via pull-rebase", () => {
    // A sends in thread "epsilon" — bare-remote moves forward.
    runNew({ cwd: rigA, threadId: "epsilon", stdout: () => {}, stderr: () => {} });
    runSend({
      cwd: rigA,
      type: "HANDOFF",
      threadId: "epsilon",
      to: ["windows-5080"],
      status: "▶ A first",
      bodyText: "# A first\n\nA wrote into epsilon first.\n",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    expect(pushMain(rigA).status).toBe(0);

    // B (without pulling) sends into the same thread. B's local commit
    // is fine — the per-thread filename ordinal picks a non-colliding
    // path locally (HANDOFF.md). The collision surfaces at PUSH time.
    runNew({ cwd: rigB, threadId: "epsilon", stdout: () => {}, stderr: () => {} });
    runSend({
      cwd: rigB,
      type: "HANDOFF",
      threadId: "epsilon",
      to: ["mac-m5max"],
      status: "▶ B parallel",
      bodyText: "# B parallel\n\nB wrote into epsilon at the same time.\n",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });

    // B's push must fail (non-fast-forward; A's commit is already on
    // origin/main and B's local main diverges).
    const bPush = pushMain(rigB);
    expect(bPush.status).not.toBe(0);
    // The stderr should mention "non-fast-forward" or "rejected" — the
    // exact git phrasing varies by version but BOTH appear in modern
    // git's reject message.
    expect(bPush.stderr.toLowerCase()).toMatch(/non-fast-forward|rejected|fetch first/);

    // Recovery path: B pulls --rebase, which will conflict because both
    // sides authored a HANDOFF.md in epsilon/. The conflict IS the
    // signal — L4 says "surface everything at the sync boundary" and
    // this is exactly the boundary. We assert the conflict surfaces;
    // resolution is operator-mediated.
    const bPull = pullRebase(rigB);
    // Either the rebase succeeds (if the bare HANDOFF.md happened to
    // sort first and B's local got renamed) OR it fails with a
    // conflict. Both are valid surface paths — what's invalid is
    // SILENTLY losing one side. Assert the path is one of those two,
    // not a no-op.
    if (bPull.status !== 0) {
      expect(bPull.stderr.toLowerCase()).toMatch(/conflict|merge|rebase/);
    } else {
      // If rebase succeeded, the bare's HANDOFF.md should still be on
      // disk and verify.
      const onDisk = join(rigB, "epsilon", "HANDOFF.md");
      expect(existsSync(onDisk)).toBe(true);
    }
  });
});
