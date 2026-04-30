import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  safeCommit,
  safePull,
  isGitRepo,
  repoRoot,
  GitError,
} from "./git.js";

function initGitRepo(dir: string): void {
  spawnSync("git", ["init", "-b", "main", dir], { encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
    encoding: "utf8",
  });
  spawnSync("git", ["config", "user.name", "Test"], {
    cwd: dir,
    encoding: "utf8",
  });
  spawnSync("git", ["config", "commit.gpgsign", "false"], {
    cwd: dir,
    encoding: "utf8",
  });
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rig-bridge-git-"));
  initGitRepo(dir);
  return () => rmSync(dir, { recursive: true, force: true });
});

describe("isGitRepo + repoRoot", () => {
  it("detects a git repo", () => {
    expect(isGitRepo(dir)).toBe(true);
    expect(repoRoot(dir)).toBeDefined();
  });

  it("returns false on a non-repo dir", () => {
    const plain = mkdtempSync(join(tmpdir(), "rig-bridge-plain-"));
    try {
      expect(isGitRepo(plain)).toBe(false);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe("safeCommit", () => {
  it("commits a regular file and returns its SHA", () => {
    const f = join(dir, "hello.md");
    writeFileSync(f, "hi\n");
    const r = safeCommit({
      files: [f],
      message: "test commit",
      cwd: dir,
    });
    expect(r.commitSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("refuses to commit a gitlink (submodule) path", () => {
    const sub = join(dir, "subrepo");
    mkdirSync(sub);
    initGitRepo(sub);
    writeFileSync(join(sub, "x.md"), "x\n");
    expect(() =>
      safeCommit({ files: [sub], message: "should refuse", cwd: dir }),
    ).toThrow(/gitlink/);
  });

  it("refuses to commit OS-junk paths", () => {
    const dsstore = join(dir, ".DS_Store");
    writeFileSync(dsstore, "junk");
    expect(() =>
      safeCommit({ files: [dsstore], message: "should refuse", cwd: dir }),
    ).toThrow(/OS-junk/);

    const apple = join(dir, "._weirdfile");
    writeFileSync(apple, "junk");
    expect(() =>
      safeCommit({ files: [apple], message: "should refuse", cwd: dir }),
    ).toThrow(/OS-junk/);
  });

  it("warns (does not block) when a single file exceeds 25MB", () => {
    const f = join(dir, "big.bin");
    // 26MB, allocated as a Buffer once
    const buf = Buffer.alloc(26 * 1024 * 1024, 0);
    writeFileSync(f, buf);
    const captured: string[] = [];
    const r = safeCommit({
      files: [f],
      message: "large file",
      cwd: dir,
      stderr: (s) => captured.push(s),
    });
    expect(r.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(captured.join("")).toMatch(/>25 MB/);
  });

  it("refuses paths outside the repo root", () => {
    const outside = mkdtempSync(join(tmpdir(), "rig-bridge-outside-"));
    try {
      const f = join(outside, "x.md");
      writeFileSync(f, "x\n");
      expect(() =>
        safeCommit({ files: [f], message: "outside", cwd: dir }),
      ).toThrow(GitError);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("safePull", () => {
  it("errors clearly when there is no remote", () => {
    expect(() => safePull(dir)).toThrow(GitError);
  });
});
