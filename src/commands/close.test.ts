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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rig-bridge-close-"));
  spawnSync("git", ["init", "-b", "main", dir], { encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "t@x"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "T"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir, encoding: "utf8" });
  runInit({ cwd: dir, rigId: "mac-m5max", displayName: "Mac Claude", stdout: () => {} });
  runNew({ cwd: dir, threadId: "thread-1", stdout: () => {} });
  return () => rmSync(dir, { recursive: true, force: true });
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
});
