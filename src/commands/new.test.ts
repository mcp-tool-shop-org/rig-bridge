import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runInit } from "./init.js";
import { runNew } from "./new.js";

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
  dir = mkdtempSync(join(tmpdir(), "rig-bridge-new-"));
  spawnSync("git", ["init", "-b", "main", dir], { encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "t@x"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "T"], { cwd: dir, encoding: "utf8" });
  runInit({ cwd: dir, rigId: "mac-m5max", displayName: "Mac Claude", stdout: () => {} });
  return () => cleanupTempDir(dir);
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
      cleanupTempDir(fresh);
    }
  });

  // F-TST-011: thread-id Unicode lookalikes + normalization forms. The
  // pattern in new.ts is ASCII-only ([a-z0-9-]); any homoglyph in another
  // script must be rejected at ingress, not silently accepted. This
  // prevents the path-overlap attack where a Cyrillic-а thread-dir sits
  // next to a Latin-a thread-dir and they appear identical to humans.
  describe("Unicode thread-id boundaries (F-TST-011)", () => {
    it("rejects Cyrillic 'а' (U+0430) that visually matches Latin 'a'", () => {
      const cyrillic = "а"; // visually identical to "a"
      expect(() =>
        runNew({ cwd: dir, threadId: cyrillic, stdout: () => {} }),
      ).toThrow(/kebab-case/);
    });

    it("rejects 'café' (NFC composed form with U+00E9)", () => {
      // NFC: c, a, f, é (U+00E9). Single composed code point.
      const composed = "café";
      expect(() =>
        runNew({ cwd: dir, threadId: composed, stdout: () => {} }),
      ).toThrow(/kebab-case/);
    });

    it("rejects 'café' (NFD decomposed form: e + U+0301 combining acute)", () => {
      // NFD: c, a, f, e, combining-acute. The combining mark is outside
      // [a-z0-9-] so the regex rejects either way — pin this.
      const decomposed = "café";
      expect(() =>
        runNew({ cwd: dir, threadId: decomposed, stdout: () => {} }),
      ).toThrow(/kebab-case/);
    });

    it("rejects an emoji thread-id (Unicode but visibly non-ASCII)", () => {
      expect(() =>
        runNew({ cwd: dir, threadId: "🎯-target", stdout: () => {} }),
      ).toThrow(/kebab-case/);
    });

    it("accepts the single-char boundary 'a' (Latin) and rejects single Cyrillic 'а'", () => {
      // The schema currently allows length-1 thread-ids. Pin both forks
      // so if Engine/Commands tighten the bound later, this test surfaces.
      const r = runNew({ cwd: dir, threadId: "a", stdout: () => {} });
      expect(existsSync(r.filePath)).toBe(true);
      expect(() =>
        runNew({ cwd: dir, threadId: "а", stdout: () => {} }),
      ).toThrow(/kebab-case/);
    });
  });
});
