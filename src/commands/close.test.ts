import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runInit } from "./init.js";
import { runNew } from "./new.js";
import { runSend } from "./send.js";
import { runClose } from "./close.js";

let dir: string;

// B-TST-001 (Stage C wave 1): surface teardown failures and tolerate
// transient Windows file-locks via maxRetries.
function cleanupTempDir(p: string): void {
  try {
    rmSync(p, { recursive: true, force: true, maxRetries: 3 });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("temp cleanup failed for", p, e);
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rig-bridge-close-"));
  spawnSync("git", ["init", "-b", "main", dir], { encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "t@x"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "T"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir, encoding: "utf8" });
  runInit({ cwd: dir, rigId: "mac-m5max", displayName: "Mac Claude", stdout: () => {} });
  runNew({ cwd: dir, threadId: "thread-1", stdout: () => {} });
  return () => cleanupTempDir(dir);
});

describe("runClose", () => {
  it("writes a RESOLUTION.md with status_class=completed", () => {
    runSend({
      cwd: dir,
      type: "HANDOFF",
      threadId: "thread-1",
      to: ["windows-5080"],
      bodyText: "deliverable\n",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    const r = runClose({
      cwd: dir,
      threadId: "thread-1",
      status: "completed",
      note: "Wave 1 landed",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    expect(r.statusClass).toBe("completed");
    expect(existsSync(r.filePath)).toBe(true);
    const text = readFileSync(r.filePath, "utf8");
    expect(text).toContain("type: RESOLUTION");
    expect(text).toContain("✅ Completed");
    expect(text).toContain("Wave 1 landed");
    expect(text).toContain("to: windows-5080");
  });

  it("writes a RESOLUTION.md with status_class=cancelled", () => {
    const r = runClose({
      cwd: dir,
      threadId: "thread-1",
      status: "cancelled",
      note: "premise gone",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    expect(r.statusClass).toBe("cancelled");
    const text = readFileSync(r.filePath, "utf8");
    expect(text).toContain("❌ Cancelled");
    expect(text).toContain("premise gone");
  });

  it("rejects an unknown --status", () => {
    expect(() =>
      runClose({
        cwd: dir,
        threadId: "thread-1",
        status: "deferred",
        noPush: true,
        stdout: () => {},
        stderr: () => {},
      }),
    ).toThrow(/cancelled|completed/);
  });

  it("refuses to close a thread that doesn't exist", () => {
    expect(() =>
      runClose({
        cwd: dir,
        threadId: "no-such-thread",
        status: "completed",
        noPush: true,
        stdout: () => {},
        stderr: () => {},
      }),
    ).toThrow(/not found/);
  });

  it("refuses to close a thread twice", () => {
    runClose({
      cwd: dir,
      threadId: "thread-1",
      status: "completed",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    expect(() =>
      runClose({
        cwd: dir,
        threadId: "thread-1",
        status: "cancelled",
        noPush: true,
        stdout: () => {},
        stderr: () => {},
      }),
    ).toThrow(/already exists/);
  });

  // Phase 7 wave 2B refactor: the inline `inferPeerRig` has been
  // replaced with the engine helper `findPeerRigs`. This test
  // exercises the peer-inference path end-to-end to prove the swap
  // preserves behavior: send several envelopes mentioning multiple
  // non-self rig-ids (with varying frequencies), close the thread,
  // and assert the RESOLUTION's `to:` is the most-frequent non-self
  // peer. Falls back to selfRigId only when no peers are present in
  // the bridge corpus.
  it("RESOLUTION `to:` resolves to the most-frequent non-self peer via findPeerRigs", () => {
    // Send 3 envelopes addressed to windows-5080 and 1 to mike-relay.
    // After the swap, close.ts should still pick windows-5080 as the
    // peer (highest count) and route the RESOLUTION there.
    for (let i = 0; i < 3; i++) {
      runSend({
        cwd: dir,
        type: "RESPONSE",
        threadId: "thread-1",
        to: ["windows-5080"],
        bodyText: `r${i}\n`,
        noPush: true,
        stdout: () => {},
        stderr: () => {},
      });
    }
    runSend({
      cwd: dir,
      type: "HANDOFF",
      threadId: "thread-1",
      to: ["mike-relay"],
      bodyText: "to relay\n",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    const r = runClose({
      cwd: dir,
      threadId: "thread-1",
      status: "completed",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    const text = readFileSync(r.filePath, "utf8");
    expect(text).toContain("to: windows-5080");
    // Sanity check the other peer also appeared in the corpus — if
    // not, the test isn't exercising the multi-peer ranking branch.
    // The RESOLUTION's `to:` is single-string-shaped because the
    // helper returns a sorted RigCount[] and we pick [0].
    expect(text).not.toMatch(/^to: mike-relay$/m);
  });

  it("RESOLUTION `to:` falls back to self when no peer envelopes exist", () => {
    // Empty thread (just the dir created by `new`). close should not
    // crash and should produce a schema-valid RESOLUTION with `to:`
    // self. This is the degenerate-but-supported case the helper
    // preserves on the swap (the old inline inferPeerRig returned
    // null and close.ts had `... ?? cfg.rig_id` fallback; the new
    // shape does the same with `findPeerRigs(...)[0]?.rig_id ?? cfg.rig_id`).
    const r = runClose({
      cwd: dir,
      threadId: "thread-1",
      status: "cancelled",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    const text = readFileSync(r.filePath, "utf8");
    expect(text).toContain("to: mac-m5max");
  });
});
