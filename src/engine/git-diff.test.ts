import { describe, it, expect, beforeEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { gitDiffSinceLastSync } from "./git-diff.js";
import { GitError, safeCommit } from "./git.js";

function cleanupTempDir(p: string): void {
  try {
    rmSync(p, { recursive: true, force: true, maxRetries: 3 });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("temp cleanup failed for", p, e);
  }
}

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

// Spin up a triple (bare + local + remote-second-worktree) to simulate
// realistic cross-rig sync semantics. The bare repo is the shared
// origin; `local` is the rig under test; `remote2` is a second clone
// that simulates "the other rig" producing new commits.
interface Triple {
  bare: string;
  local: string;
  remote2: string;
}

function setupTriple(): Triple {
  const bare = mkdtempSync(join(tmpdir(), "rig-bridge-diff-bare-"));
  const local = mkdtempSync(join(tmpdir(), "rig-bridge-diff-local-"));
  const remote2 = mkdtempSync(join(tmpdir(), "rig-bridge-diff-r2-"));

  spawnSync("git", ["init", "--bare", "-b", "main", bare], {
    encoding: "utf8",
  });
  initGitRepo(local);
  writeFileSync(join(local, "seed.md"), "seed\n");
  safeCommit({ files: [join(local, "seed.md")], message: "seed", cwd: local });
  spawnSync("git", ["remote", "add", "origin", bare], {
    cwd: local,
    encoding: "utf8",
  });
  spawnSync("git", ["push", "-u", "origin", "main"], {
    cwd: local,
    encoding: "utf8",
  });

  const clone = spawnSync("git", ["clone", "-b", "main", bare, remote2], {
    encoding: "utf8",
  });
  if (clone.status !== 0) {
    throw new Error("clone failed: " + clone.stderr);
  }
  spawnSync("git", ["config", "user.email", "r@x"], {
    cwd: remote2,
    encoding: "utf8",
  });
  spawnSync("git", ["config", "user.name", "R"], {
    cwd: remote2,
    encoding: "utf8",
  });
  spawnSync("git", ["config", "commit.gpgsign", "false"], {
    cwd: remote2,
    encoding: "utf8",
  });
  return { bare, local, remote2 };
}

function cleanupTriple(t: Triple): void {
  cleanupTempDir(t.local);
  cleanupTempDir(t.remote2);
  cleanupTempDir(t.bare);
}

let triple: Triple;

beforeEach(() => {
  triple = setupTriple();
  return () => cleanupTriple(triple);
});

describe("gitDiffSinceLastSync — no-op cases", () => {
  it("returns fast_forward_eligible=true with empty lists when local==remote", () => {
    const diff = gitDiffSinceLastSync(triple.local, null);
    expect(diff.fast_forward_eligible).toBe(true);
    expect(diff.new_envelopes).toEqual([]);
    expect(diff.changed_envelopes).toEqual([]);
    expect(diff.diverged).toBe(false);
    expect(diff.local_head).toMatch(/^[0-9a-f]{40}$/);
    expect(diff.remote_head).toBe(diff.local_head);
  });

  it("returns fast_forward_eligible=true when local is ahead and remote has no new commits", () => {
    // Local makes a commit that hasn't been pushed yet; the remote is
    // unchanged. There's nothing to pull → caller treats as "nothing
    // new from remote." We mark this as fast_forward_eligible=true
    // because the no-op pull is trivially safe.
    writeFileSync(join(triple.local, "local-only.md"), "x\n");
    safeCommit({
      files: [join(triple.local, "local-only.md")],
      message: "local only",
      cwd: triple.local,
    });
    const diff = gitDiffSinceLastSync(triple.local, null);
    expect(diff.fast_forward_eligible).toBe(true);
    expect(diff.new_envelopes).toEqual([]);
    expect(diff.changed_envelopes).toEqual([]);
    expect(diff.diverged).toBe(false);
  });
});

describe("gitDiffSinceLastSync — L1 fast-forward", () => {
  it("flags fast_forward_eligible=true when remote adds a new envelope in a thread dir", () => {
    // remote2 creates a new thread dir + envelope, commits, pushes.
    const threadDir = join(triple.remote2, "thread-1");
    mkdirSync(threadDir);
    const envelopePath = join(threadDir, "REQUEST.md");
    writeFileSync(
      envelopePath,
      "---\nfrom: mac-m5max\nto: windows-5080\ndate: 2026-05-15\nstatus: '▶ open'\ntype: REQUEST\nthread: thread-1\n---\n\nbody\n",
    );
    safeCommit({
      files: [envelopePath],
      message: "open thread-1",
      cwd: triple.remote2,
    });
    spawnSync("git", ["push", "origin", "main"], {
      cwd: triple.remote2,
      encoding: "utf8",
    });

    const diff = gitDiffSinceLastSync(triple.local, null);
    expect(diff.fast_forward_eligible).toBe(true);
    expect(diff.new_envelopes).toHaveLength(1);
    expect(diff.new_envelopes[0].path).toBe("thread-1/REQUEST.md");
    expect(diff.new_envelopes[0].thread_id).toBe("thread-1");
    expect(diff.changed_envelopes).toEqual([]);
    expect(diff.diverged).toBe(false);
  });

  it("accepts multiple new envelopes across multiple threads", () => {
    for (const tName of ["thread-a", "thread-b"]) {
      const tDir = join(triple.remote2, tName);
      mkdirSync(tDir);
      writeFileSync(
        join(tDir, "REQUEST.md"),
        `---\nfrom: mac-m5max\nto: windows-5080\ndate: 2026-05-15\nstatus: '▶ open'\ntype: REQUEST\nthread: ${tName}\n---\n\nbody\n`,
      );
      safeCommit({
        files: [join(tDir, "REQUEST.md")],
        message: `open ${tName}`,
        cwd: triple.remote2,
      });
    }
    spawnSync("git", ["push", "origin", "main"], {
      cwd: triple.remote2,
      encoding: "utf8",
    });

    const diff = gitDiffSinceLastSync(triple.local, null);
    expect(diff.fast_forward_eligible).toBe(true);
    expect(diff.new_envelopes).toHaveLength(2);
    const paths = diff.new_envelopes.map((n) => n.path).sort();
    expect(paths).toEqual(["thread-a/REQUEST.md", "thread-b/REQUEST.md"]);
  });
});

describe("gitDiffSinceLastSync — L2 append-only enforcement", () => {
  it("flags fast_forward_eligible=false when remote modifies an existing file", () => {
    // remote2 modifies seed.md (which both sides already have) and pushes.
    writeFileSync(join(triple.remote2, "seed.md"), "remote-edit\n");
    safeCommit({
      files: [join(triple.remote2, "seed.md")],
      message: "modify seed",
      cwd: triple.remote2,
    });
    spawnSync("git", ["push", "origin", "main"], {
      cwd: triple.remote2,
      encoding: "utf8",
    });

    const diff = gitDiffSinceLastSync(triple.local, null);
    expect(diff.fast_forward_eligible).toBe(false);
    expect(diff.diverged).toBe(true);
    expect(diff.changed_envelopes).toHaveLength(1);
    expect(diff.changed_envelopes[0].path).toBe("seed.md");
    expect(diff.changed_envelopes[0].reason).toMatch(/modified in place/);
  });

  it("flags both new + changed paths in a mixed remote commit", () => {
    // remote2 both modifies seed.md AND adds a new envelope in a thread.
    writeFileSync(join(triple.remote2, "seed.md"), "remote-edit\n");
    const threadDir = join(triple.remote2, "thread-1");
    mkdirSync(threadDir);
    writeFileSync(
      join(threadDir, "REQUEST.md"),
      "---\nfrom: mac-m5max\nto: windows-5080\ndate: 2026-05-15\nstatus: '▶ open'\ntype: REQUEST\nthread: thread-1\n---\n\nbody\n",
    );
    safeCommit({
      files: [join(triple.remote2, "seed.md"), join(threadDir, "REQUEST.md")],
      message: "mixed",
      cwd: triple.remote2,
    });
    spawnSync("git", ["push", "origin", "main"], {
      cwd: triple.remote2,
      encoding: "utf8",
    });

    const diff = gitDiffSinceLastSync(triple.local, null);
    expect(diff.fast_forward_eligible).toBe(false);
    expect(diff.new_envelopes).toHaveLength(1);
    expect(diff.changed_envelopes).toHaveLength(1);
    expect(diff.changed_envelopes[0].reason).toMatch(/modified/);
    expect(diff.diverged).toBe(true);
  });

  it("flags fast_forward_eligible=false when remote deletes a file", () => {
    // remote2 deletes seed.md.
    rmSync(join(triple.remote2, "seed.md"));
    spawnSync("git", ["add", "-A"], {
      cwd: triple.remote2,
      encoding: "utf8",
    });
    spawnSync("git", ["commit", "-m", "delete seed"], {
      cwd: triple.remote2,
      encoding: "utf8",
    });
    spawnSync("git", ["push", "origin", "main"], {
      cwd: triple.remote2,
      encoding: "utf8",
    });

    const diff = gitDiffSinceLastSync(triple.local, null);
    expect(diff.fast_forward_eligible).toBe(false);
    expect(diff.diverged).toBe(true);
    expect(diff.changed_envelopes).toHaveLength(1);
    expect(diff.changed_envelopes[0].reason).toMatch(/deleted/);
  });

  it("flags new file outside a thread directory as changed (not auto-resolvable)", () => {
    // remote2 adds a top-level README file (NOT inside a thread dir).
    // This is a NEW file, but it lands outside a known thread dir, so
    // we surface it as a "changed" entry for the operator to review.
    writeFileSync(join(triple.remote2, "README.md"), "readme\n");
    safeCommit({
      files: [join(triple.remote2, "README.md")],
      message: "add readme",
      cwd: triple.remote2,
    });
    spawnSync("git", ["push", "origin", "main"], {
      cwd: triple.remote2,
      encoding: "utf8",
    });

    const diff = gitDiffSinceLastSync(triple.local, null);
    expect(diff.fast_forward_eligible).toBe(false);
    expect(diff.new_envelopes).toEqual([]);
    expect(diff.changed_envelopes).toHaveLength(1);
    expect(diff.changed_envelopes[0].path).toBe("README.md");
    expect(diff.changed_envelopes[0].reason).toMatch(/outside a known thread/);
  });
});

describe("gitDiffSinceLastSync — divergence (both sides ahead)", () => {
  it("flags diverged=true when local AND remote both have unique commits", () => {
    // Local makes a commit; remote2 makes a different commit + pushes.
    writeFileSync(join(triple.local, "local-side.md"), "local\n");
    safeCommit({
      files: [join(triple.local, "local-side.md")],
      message: "local side",
      cwd: triple.local,
    });
    writeFileSync(join(triple.remote2, "remote-side.md"), "remote\n");
    safeCommit({
      files: [join(triple.remote2, "remote-side.md")],
      message: "remote side",
      cwd: triple.remote2,
    });
    spawnSync("git", ["push", "origin", "main"], {
      cwd: triple.remote2,
      encoding: "utf8",
    });

    const diff = gitDiffSinceLastSync(triple.local, null);
    expect(diff.diverged).toBe(true);
    expect(diff.fast_forward_eligible).toBe(false);
  });
});

describe("gitDiffSinceLastSync — error paths", () => {
  it("throws GitError when bridgeRoot is not a git repo", () => {
    const plain = mkdtempSync(join(tmpdir(), "rig-bridge-diff-plain-"));
    try {
      expect(() => gitDiffSinceLastSync(plain, null)).toThrow(GitError);
    } finally {
      cleanupTempDir(plain);
    }
  });

  it("throws GitError when there is no upstream configured", () => {
    // A fresh repo with no remote at all.
    const orphan = mkdtempSync(join(tmpdir(), "rig-bridge-diff-orphan-"));
    try {
      initGitRepo(orphan);
      writeFileSync(join(orphan, "seed.md"), "seed\n");
      safeCommit({
        files: [join(orphan, "seed.md")],
        message: "seed",
        cwd: orphan,
      });
      // No `git remote add origin` and no push — branch main has no upstream.
      expect(() => gitDiffSinceLastSync(orphan, null)).toThrow(/upstream/);
    } finally {
      cleanupTempDir(orphan);
    }
  });
});
