// Thin wrapper over `git` for rig-bridge's commit + push surface.
//
// Three guards apply at the commit layer (belt-and-suspenders alongside
// .gitignore):
//   * Submodule guard: refuse to commit any path that is itself a gitlink
//     (a subdirectory with its own .git/). This is the 681c054 regression
//     case from the Phase 0 corpus.
//   * Size guard: warn (stderr) when any single file exceeds 25 MB. Does
//     NOT block — per the handoff doc, large diffs are visible but allowed.
//   * OS-junk guard: refuse paths matching .DS_Store / ._* / Thumbs.db.

import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

const TWENTY_FIVE_MB = 25 * 1024 * 1024;

const OS_JUNK_BASENAMES = new Set([".DS_Store", "Thumbs.db"]);
const APPLE_DOUBLE_PREFIX = "._";

export class GitError extends Error {
  readonly stderr?: string;
  constructor(message: string, stderr?: string) {
    super(stderr ? `${message}\n${stderr}` : message);
    this.name = "GitError";
    this.stderr = stderr;
  }
}

export interface GitRunResult {
  status: number;
  stdout: string;
  stderr: string;
}

export function runGit(
  args: string[],
  cwd: string,
  opts: SpawnSyncOptions = {},
): GitRunResult {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    ...opts,
  });
  if (r.error) {
    throw new GitError(`git ${args[0]} failed to spawn: ${r.error.message}`);
  }
  return {
    status: r.status ?? 1,
    stdout: typeof r.stdout === "string" ? r.stdout : r.stdout?.toString() ?? "",
    stderr: typeof r.stderr === "string" ? r.stderr : r.stderr?.toString() ?? "",
  };
}

export function isGitRepo(cwd: string): boolean {
  const r = runGit(["rev-parse", "--is-inside-work-tree"], cwd);
  return r.status === 0 && r.stdout.trim() === "true";
}

export function repoRoot(cwd: string): string {
  const r = runGit(["rev-parse", "--show-toplevel"], cwd);
  if (r.status !== 0) {
    throw new GitError(`not inside a git repo (cwd=${cwd})`, r.stderr);
  }
  return r.stdout.trim();
}

function isOsJunk(path: string): boolean {
  const base = basename(path);
  if (OS_JUNK_BASENAMES.has(base)) return true;
  if (base.startsWith(APPLE_DOUBLE_PREFIX)) return true;
  return false;
}

function isGitlinkPath(repoRootDir: string, relPath: string): boolean {
  // A gitlink is a tracked subdirectory with its own .git directory or file.
  // Detect by checking for a .git entry inside the path.
  const abs = isAbsolute(relPath) ? relPath : join(repoRootDir, relPath);
  if (!existsSync(abs)) return false;
  let st;
  try {
    st = statSync(abs);
  } catch {
    return false;
  }
  if (!st.isDirectory()) return false;
  const dotGit = join(abs, ".git");
  return existsSync(dotGit);
}

export interface SafeCommitOpts {
  files: string[];
  message: string;
  cwd: string;
  /** stderr writer (defaults to process.stderr); injected for tests */
  stderr?: (line: string) => void;
}

export interface SafeCommitResult {
  commitSha: string;
  warnings: string[];
}

export function safeCommit(opts: SafeCommitOpts): SafeCommitResult {
  const { files, message, cwd } = opts;
  const writeStderr = opts.stderr ?? ((s: string) => process.stderr.write(s));
  const root = repoRoot(cwd);
  const warnings: string[] = [];

  if (files.length === 0) {
    throw new GitError("safeCommit requires at least one file");
  }

  // On macOS the temp dir resolves through `/var → /private/var`. Compare
  // realpaths so user-supplied absolute paths inside the repo aren't
  // misclassified as "outside the repo root."
  let rootReal = root;
  try {
    rootReal = realpathSync(root);
  } catch {
    // fall through with the original
  }

  // Resolve each input to a path relative to the repo root for git add, and
  // to an absolute path for fs checks. Also enforce the three guards.
  const relFiles: string[] = [];
  for (const f of files) {
    const abs = isAbsolute(f) ? f : resolve(cwd, f);
    let absReal = abs;
    if (existsSync(abs)) {
      try {
        absReal = realpathSync(abs);
      } catch {
        // ignore — keep abs
      }
    }
    const rel = relative(rootReal, absReal);
    if (rel.startsWith("..")) {
      throw new GitError(`refuse to commit path outside repo root: ${f}`);
    }
    if (isOsJunk(rel)) {
      throw new GitError(
        `refuse to commit OS-junk path: ${rel} (matches .DS_Store/._*/Thumbs.db)`,
      );
    }
    if (isGitlinkPath(root, rel)) {
      throw new GitError(
        `refuse to commit gitlink path: ${rel} (subdirectory has its own .git/ — submodule guard)`,
      );
    }
    if (existsSync(abs)) {
      try {
        const st = statSync(abs);
        if (st.isFile() && st.size > TWENTY_FIVE_MB) {
          const mb = (st.size / (1024 * 1024)).toFixed(1);
          const warn = `rig-bridge: warning: ${rel} is ${mb} MB (>25 MB threshold)\n`;
          warnings.push(warn);
          writeStderr(warn);
        }
      } catch {
        // ignore stat errors; git will error if the path doesn't exist
      }
    }
    relFiles.push(rel);
  }

  const add = runGit(["add", "--", ...relFiles], root);
  if (add.status !== 0) {
    throw new GitError(`git add failed`, add.stderr);
  }

  const commit = runGit(["commit", "-m", message], root);
  if (commit.status !== 0) {
    throw new GitError(`git commit failed`, commit.stderr);
  }

  const head = runGit(["rev-parse", "HEAD"], root);
  if (head.status !== 0) {
    throw new GitError(`git rev-parse HEAD failed after commit`, head.stderr);
  }

  return { commitSha: head.stdout.trim(), warnings };
}

export interface PushOpts {
  cwd: string;
  remote?: string;
  branch?: string;
}

export function safePush(opts: PushOpts): void {
  const remote = opts.remote ?? "origin";
  const branch = opts.branch ?? "main";
  const root = repoRoot(opts.cwd);
  const r = runGit(["push", remote, branch], root);
  if (r.status !== 0) {
    throw new GitError(`git push ${remote} ${branch} failed`, r.stderr);
  }
}

export function safePull(cwd: string): void {
  const root = repoRoot(cwd);
  const fetch = runGit(["fetch"], root);
  if (fetch.status !== 0) {
    throw new GitError(`git fetch failed`, fetch.stderr);
  }
  const pull = runGit(["pull", "--rebase"], root);
  if (pull.status !== 0) {
    throw new GitError(`git pull --rebase failed`, pull.stderr);
  }
}
