import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runInit } from "./init.js";
import { runNew } from "./new.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rig-bridge-new-"));
  spawnSync("git", ["init", "-b", "main", dir], { encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "t@x"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "T"], { cwd: dir, encoding: "utf8" });
  runInit({ cwd: dir, rigId: "mac-m5max", displayName: "Mac Claude", stdout: () => {} });
  return () => rmSync(dir, { recursive: true, force: true });
});

describe("runNew", () => {
  it("scaffolds a thread/REQUEST.md", () => {
    const r = runNew({ cwd: dir, threadId: "smoke-test-001", stdout: () => {} });
    expect(existsSync(r.filePath)).toBe(true);
    const text = readFileSync(r.filePath, "utf8");
    expect(text).toContain("from: mac-m5max");
    expect(text).toContain("type: REQUEST");
    expect(text).toContain("thread: smoke-test-001");
    expect(text).toContain("display_name: Mac Claude");
  });

  it("rejects an invalid thread-id", () => {
    expect(() =>
      runNew({ cwd: dir, threadId: "Bad ID!", stdout: () => {} }),
    ).toThrow(/kebab-case/);
    expect(() =>
      runNew({ cwd: dir, threadId: "-leading", stdout: () => {} }),
    ).toThrow(/kebab-case/);
    expect(() =>
      runNew({ cwd: dir, threadId: "trailing-", stdout: () => {} }),
    ).toThrow(/kebab-case/);
  });

  it("accepts a single-character thread id", () => {
    const r = runNew({ cwd: dir, threadId: "a", stdout: () => {} });
    expect(existsSync(r.filePath)).toBe(true);
  });

  it("refuses to overwrite an existing file without --force", () => {
    runNew({ cwd: dir, threadId: "thread-1", stdout: () => {} });
    expect(() =>
      runNew({ cwd: dir, threadId: "thread-1", stdout: () => {} }),
    ).toThrow(/already exists/);
  });

  it("errors clearly when no config exists", () => {
    const fresh = mkdtempSync(join(tmpdir(), "rig-bridge-fresh-"));
    spawnSync("git", ["init", "-b", "main", fresh], { encoding: "utf8" });
    try {
      expect(() =>
        runNew({ cwd: fresh, threadId: "t1", stdout: () => {} }),
      ).toThrow(/not found/);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });
});
