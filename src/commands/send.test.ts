import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runInit } from "./init.js";
import { runNew } from "./new.js";
import { runSend } from "./send.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rig-bridge-send-"));
  spawnSync("git", ["init", "-b", "main", dir], { encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "t@x"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "T"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir, encoding: "utf8" });
  runInit({ cwd: dir, rigId: "mac-m5max", displayName: "Mac Claude", stdout: () => {} });
  runNew({ cwd: dir, threadId: "thread-1", stdout: () => {} });
  return () => rmSync(dir, { recursive: true, force: true });
});

describe("runSend", () => {
  it("writes a HANDOFF, computes body_hash, derives statusClass, commits", () => {
    const r = runSend({
      cwd: dir,
      type: "HANDOFF",
      threadId: "thread-1",
      to: ["windows-5080"],
      status: "▶ Phase 6 wave 1 ready",
      bodyText: "# wave 1\n\nDispatching backend agent.\n\nStanding by.\n",
      tldr: "wave 1 dispatch",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    expect(r.filename).toBe("HANDOFF.md");
    expect(r.statusClass).toBe("active");
    expect(r.bodyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.commitSha).toMatch(/^[0-9a-f]{40}$/);
    const text = readFileSync(r.filePath, "utf8");
    expect(text).toContain("from: mac-m5max");
    expect(text).toContain("to: windows-5080");
    expect(text).toContain("type: HANDOFF");
  });

  it("bumps the ordinal when the bare filename already exists", () => {
    const a = runSend({
      cwd: dir,
      type: "RESPONSE",
      threadId: "thread-1",
      to: ["windows-5080"],
      bodyText: "first\n",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    const b = runSend({
      cwd: dir,
      type: "RESPONSE",
      threadId: "thread-1",
      to: ["windows-5080"],
      bodyText: "second\n",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    expect(a.filename).toBe("RESPONSE.md");
    expect(b.filename).toBe("RESPONSE-2.md");
  });

  it("rejects an unknown message type", () => {
    expect(() =>
      runSend({
        cwd: dir,
        type: "GREETINGS",
        threadId: "thread-1",
        to: ["windows-5080"],
        noPush: true,
        stdout: () => {},
        stderr: () => {},
      }),
    ).toThrow(/unknown message type/);
  });

  it("rejects a --to with an invalid rig id (ingress validation)", () => {
    expect(() =>
      runSend({
        cwd: dir,
        type: "HANDOFF",
        threadId: "thread-1",
        to: ["WINDOWS-5080"],
        noPush: true,
        stdout: () => {},
        stderr: () => {},
      }),
    ).toThrow(/--to/);
  });

  it("rejects a status with no recognized marker", () => {
    expect(() =>
      runSend({
        cwd: dir,
        type: "HANDOFF",
        threadId: "thread-1",
        to: ["windows-5080"],
        status: "active phase 0",
        noPush: true,
        stdout: () => {},
        stderr: () => {},
      }),
    ).toThrow(/marker/);
  });

  it("accepts comma-separated and repeated --to flags", () => {
    const r = runSend({
      cwd: dir,
      type: "HANDOFF",
      threadId: "thread-1",
      to: ["windows-5080,mike-relay"],
      bodyText: "multi\n",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    const text = readFileSync(r.filePath, "utf8");
    expect(text).toContain("- windows-5080");
    expect(text).toContain("- mike-relay");
  });

  it("warns on stderr when tldr exceeds 280 chars (decision #1)", () => {
    const errs: string[] = [];
    runSend({
      cwd: dir,
      type: "HANDOFF",
      threadId: "thread-1",
      to: ["windows-5080"],
      bodyText: "x\n",
      tldr: "x".repeat(281),
      noPush: true,
      stdout: () => {},
      stderr: (s) => errs.push(s),
    });
    expect(errs.join("")).toMatch(/tldr is 281/);
  });

  it("errors when the thread directory does not exist", () => {
    expect(() =>
      runSend({
        cwd: dir,
        type: "HANDOFF",
        threadId: "no-such-thread",
        to: ["windows-5080"],
        noPush: true,
        stdout: () => {},
        stderr: () => {},
      }),
    ).toThrow(/thread directory not found/);
  });

  it("loads body from --body-file when provided", () => {
    const bf = join(dir, "scratch-body.md");
    writeFileSync(bf, "loaded from file\n", "utf8");
    const r = runSend({
      cwd: dir,
      type: "HANDOFF",
      threadId: "thread-1",
      to: ["windows-5080"],
      bodyFile: bf,
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    const text = readFileSync(r.filePath, "utf8");
    expect(text).toContain("loaded from file");
    expect(existsSync(bf)).toBe(true);
  });
});
