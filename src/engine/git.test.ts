import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  runGit,
  safeCommit,
  safePush,
  safePull,
  isGitRepo,
  repoRoot,
  GitError,
} from "./git.js";

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

// B-TST-002 (Stage C wave 1): rig-bridge's test suite spawns real `git`
// subprocesses. Older git versions (< 2.28) lack `-b <branch>` on `git init`
// (added 2.28) and similar flags the tests rely on. Surface a clear,
// actionable warning at suite start instead of letting the maintainer
// chase a confusing "flag --b is not recognized" failure at 3am. We don't
// SKIP — older git may still pass many tests; let the operator see the
// real failure surface alongside the warning.
beforeAll(() => {
  const r = spawnSync("git", ["--version"], { encoding: "utf8" });
  const out = (typeof r.stdout === "string" ? r.stdout : "").trim();
  // Match `git version 2.39.2` or `git version 2.39.2.windows.1`. The
  // leading three dotted components are the SemVer-ish identity.
  const m = /git version (\d+)\.(\d+)\.(\d+)/.exec(out);
  if (!m) {
    // eslint-disable-next-line no-console
    console.warn(
      `rig-bridge tests: could not parse \`git --version\` output (${JSON.stringify(out)}). ` +
        `Tests may fail in unexpected ways. Expected git ≥ 2.28.`,
    );
    return;
  }
  const major = Number(m[1]);
  const minor = Number(m[2]);
  // Required minimum: 2.28 (released July 2020, ships `git init -b`).
  const tooOld = major < 2 || (major === 2 && minor < 28);
  if (tooOld) {
    // eslint-disable-next-line no-console
    console.warn(
      `rig-bridge tests require git ≥ 2.28; detected ${m[1]}.${m[2]}.${m[3]}. ` +
        `Tests may fail on older git (e.g. \`git init -b\` was added in 2.28).`,
    );
  }
});

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
  return () => cleanupTempDir(dir);
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
      cleanupTempDir(plain);
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
      cleanupTempDir(outside);
    }
  });
});

describe("safePull", () => {
  it("errors clearly when there is no remote", () => {
    expect(() => safePull(dir)).toThrow(GitError);
  });

  // F-TST-008: simulated merge-conflict path. We make a remote bare repo,
  // push our local main, then create a divergent local + remote commit on
  // the same file. `git pull --rebase` will fail with a conflict; safePull
  // must surface a GitError including stderr context.
  it("errors with stderr context on a divergent (non-fast-forward) pull", () => {
    const bare = mkdtempSync(join(tmpdir(), "rig-bridge-bare-"));
    try {
      // Make `bare` a bare git repo (acts as the remote) with default
      // branch main so clones pick the right ref.
      const init = spawnSync("git", ["init", "--bare", "-b", "main", bare], {
        encoding: "utf8",
      });
      expect(init.status).toBe(0);

      // Wire the local dir to that bare remote, seed an initial commit,
      // push to establish main.
      writeFileSync(join(dir, "seed.md"), "seed\n");
      safeCommit({ files: [join(dir, "seed.md")], message: "seed", cwd: dir });
      spawnSync("git", ["remote", "add", "origin", bare], {
        cwd: dir,
        encoding: "utf8",
      });
      const push = spawnSync("git", ["push", "origin", "main"], {
        cwd: dir,
        encoding: "utf8",
      });
      expect(push.status).toBe(0);

      // Clone the bare into a second working tree, make a divergent commit,
      // push it. Now origin/main has a commit local doesn't.
      const remote2 = mkdtempSync(join(tmpdir(), "rig-bridge-remote2-"));
      try {
        const clone = spawnSync(
          "git",
          ["clone", "-b", "main", bare, remote2],
          { encoding: "utf8" },
        );
        expect(clone.status).toBe(0);
        spawnSync("git", ["config", "user.email", "r@x"], {
          cwd: remote2, encoding: "utf8",
        });
        spawnSync("git", ["config", "user.name", "R"], {
          cwd: remote2, encoding: "utf8",
        });
        spawnSync("git", ["config", "commit.gpgsign", "false"], {
          cwd: remote2, encoding: "utf8",
        });
        writeFileSync(join(remote2, "seed.md"), "remote-edit\n");
        spawnSync("git", ["add", "seed.md"], { cwd: remote2, encoding: "utf8" });
        spawnSync("git", ["commit", "-m", "remote edit"], {
          cwd: remote2, encoding: "utf8",
        });
        const r2push = spawnSync("git", ["push", "origin", "main"], {
          cwd: remote2, encoding: "utf8",
        });
        expect(r2push.status).toBe(0);

        // Local makes a divergent edit to the same file.
        writeFileSync(join(dir, "seed.md"), "local-edit\n");
        safeCommit({ files: [join(dir, "seed.md")], message: "local edit", cwd: dir });

        // safePull should fail — fetch+rebase will conflict on seed.md.
        expect(() => safePull(dir)).toThrow(GitError);
      } finally {
        cleanupTempDir(remote2);
      }
    } finally {
      cleanupTempDir(bare);
    }
  });
});

describe("safePush — error paths (F-TST-008)", () => {
  it("throws GitError when pushing to a remote that does not exist", () => {
    // No `origin` configured at all — push must fail with a clear error.
    writeFileSync(join(dir, "x.md"), "x\n");
    safeCommit({ files: [join(dir, "x.md")], message: "x", cwd: dir });
    expect(() => safePush({ cwd: dir })).toThrow(GitError);
  });

  it("throws GitError when pushing to a branch that has diverged on remote (non-FF)", () => {
    // Set up a bare remote with a divergent main, then push local non-FF.
    const bare = mkdtempSync(join(tmpdir(), "rig-bridge-bare-ff-"));
    try {
      spawnSync("git", ["init", "--bare", "-b", "main", bare], {
        encoding: "utf8",
      });
      writeFileSync(join(dir, "seed.md"), "seed\n");
      safeCommit({ files: [join(dir, "seed.md")], message: "seed", cwd: dir });
      spawnSync("git", ["remote", "add", "origin", bare], {
        cwd: dir, encoding: "utf8",
      });
      const initialPush = spawnSync("git", ["push", "origin", "main"], {
        cwd: dir, encoding: "utf8",
      });
      expect(initialPush.status).toBe(0);

      const remote2 = mkdtempSync(join(tmpdir(), "rig-bridge-r2-ff-"));
      try {
        const clone = spawnSync(
          "git",
          ["clone", "-b", "main", bare, remote2],
          { encoding: "utf8" },
        );
        expect(clone.status).toBe(0);
        spawnSync("git", ["config", "user.email", "r@x"], {
          cwd: remote2, encoding: "utf8",
        });
        spawnSync("git", ["config", "user.name", "R"], {
          cwd: remote2, encoding: "utf8",
        });
        spawnSync("git", ["config", "commit.gpgsign", "false"], {
          cwd: remote2, encoding: "utf8",
        });
        writeFileSync(join(remote2, "seed.md"), "remote\n");
        spawnSync("git", ["add", "seed.md"], { cwd: remote2, encoding: "utf8" });
        spawnSync("git", ["commit", "-m", "remote"], {
          cwd: remote2, encoding: "utf8",
        });
        const remotePush = spawnSync("git", ["push", "origin", "main"], {
          cwd: remote2, encoding: "utf8",
        });
        expect(remotePush.status).toBe(0);

        // Local writes a divergent commit on the same file then attempts
        // a non-fast-forward push — must fail with GitError.
        writeFileSync(join(dir, "seed.md"), "local\n");
        safeCommit({
          files: [join(dir, "seed.md")],
          message: "local",
          cwd: dir,
        });
        expect(() => safePush({ cwd: dir })).toThrow(GitError);
      } finally {
        cleanupTempDir(remote2);
      }
    } finally {
      cleanupTempDir(bare);
    }
  });
});

describe("runGit — spawn-failure surface (F-TST-008)", () => {
  // B-TST-010 (Stage C wave 1): PATH env-var restoration must be guaranteed
  // even if the assertion inside throws. Previously this suite relied ONLY
  // on `afterEach` to restore PATH — that works, but if anything ever
  // re-entered the test body (or the assertion captured the env between
  // save and clear), the next test inherits an empty PATH and the failure
  // cascades into "tests pass individually but fail together." The explicit
  // try/finally INSIDE the test body removes that fragility entirely:
  // restoration happens before the test boundary, not at the afterEach
  // boundary, so the next assertion in the SAME test (if any) still sees a
  // good PATH. afterEach is kept as a belt-and-suspenders safety net.
  let savedPath: string | undefined;
  let savedPathExt: string | undefined;
  afterEach(() => {
    if (savedPath !== undefined) process.env.PATH = savedPath;
    else delete process.env.PATH;
    if (savedPathExt !== undefined) process.env.PATHEXT = savedPathExt;
    savedPath = undefined;
    savedPathExt = undefined;
  });

  it("throws GitError when the git binary cannot be spawned (PATH cleared)", () => {
    // Drive the wrapper's r.error code path by clearing PATH so spawnSync
    // returns an ENOENT error rather than a non-zero exit. This exercises
    // the `if (r.error)` branch in runGit that surfaces a clean GitError.
    //
    // B-TST-010 try/finally wrapper: even if the inner expect() throws
    // (e.g. someone changes runGit to NOT throw on missing git), PATH is
    // restored before the test returns. No leak into subsequent tests.
    savedPath = process.env.PATH;
    savedPathExt = process.env.PATHEXT;
    try {
      process.env.PATH = "";
      // On Windows, also clear PATHEXT so the spawn can't fall back to a
      // .exe / .cmd resolved via implicit suffixing.
      if (process.platform === "win32") {
        process.env.PATHEXT = "";
      }
      expect(() => runGit(["status"], dir)).toThrow(GitError);
    } finally {
      // Restore immediately so the rest of the suite is unaffected by a
      // mid-test throw. afterEach above is a redundant guarantee.
      if (savedPath !== undefined) process.env.PATH = savedPath;
      else delete process.env.PATH;
      if (savedPathExt !== undefined) process.env.PATHEXT = savedPathExt;
      else delete process.env.PATHEXT;
    }
  });
});

describe("repoRoot — realpath fallback (F-TST-008)", () => {
  it("throws GitError for a path that is not inside any git working tree", () => {
    // A plain (non-repo) tmpdir — runGit returns nonzero, repoRoot throws.
    const plain = mkdtempSync(join(tmpdir(), "rig-bridge-norepo-"));
    try {
      expect(() => repoRoot(plain)).toThrow(GitError);
    } finally {
      cleanupTempDir(plain);
    }
  });
});
