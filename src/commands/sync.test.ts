import { describe, it, expect, beforeEach } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { safeCommit } from "../engine/git.js";
import { runInit } from "./init.js";
import { runSync } from "./sync.js";

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

function initGitRepo(dir: string): void {
  spawnSync("git", ["init", "-b", "main", dir], { encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "t@x"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "T"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir, encoding: "utf8" });
}

// Spin up a triple (bare + local + remote-second-worktree) so the sync
// command sees a realistic remote tracking ref. Mirrors the shape used
// by src/engine/git-diff.test.ts so the surface tests exercise the same
// scenarios as the helper tests, but at the command layer (i.e. checks
// stdout / stderr contract + the pull-or-refuse decision).
interface Triple {
  bare: string;
  local: string;
  remote2: string;
}

function setupTriple(): Triple {
  const bare = mkdtempSync(join(tmpdir(), "rig-bridge-sync-bare-"));
  const local = mkdtempSync(join(tmpdir(), "rig-bridge-sync-local-"));
  const remote2 = mkdtempSync(join(tmpdir(), "rig-bridge-sync-r2-"));

  spawnSync("git", ["init", "--bare", "-b", "main", bare], { encoding: "utf8" });
  initGitRepo(local);
  // Seed file so the branch has at least one commit and an upstream
  // can be set.
  writeFileSync(join(local, "seed.md"), "seed\n");
  safeCommit({
    files: [join(local, "seed.md")],
    message: "seed",
    cwd: local,
  });
  spawnSync("git", ["remote", "add", "origin", bare], { cwd: local, encoding: "utf8" });
  spawnSync("git", ["push", "-u", "origin", "main"], { cwd: local, encoding: "utf8" });

  // Initialize the local rig as a bridge — sync needs .bridge/config.yaml
  // present (readConfig is not called by sync itself, but the engine
  // helpers expect a configured bridge).
  runInit({
    cwd: local,
    rigId: "mac-m5max",
    displayName: "Mac Claude",
    stdout: () => {},
    stderr: () => {},
  });

  const clone = spawnSync("git", ["clone", "-b", "main", bare, remote2], { encoding: "utf8" });
  if (clone.status !== 0) {
    throw new Error("clone failed: " + clone.stderr);
  }
  spawnSync("git", ["config", "user.email", "r@x"], { cwd: remote2, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "R"], { cwd: remote2, encoding: "utf8" });
  spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: remote2, encoding: "utf8" });

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

describe("runSync — no-op (in sync)", () => {
  it("returns pulled=false, fast_forward_eligible=true, new_envelopes=0 when local==remote", async () => {
    const outs: string[] = [];
    const errs: string[] = [];
    const r = await runSync({
      cwd: triple.local,
      stdout: (s) => outs.push(s),
      stderr: (s) => errs.push(s),
    });
    expect(r.pulled).toBe(false);
    expect(r.fast_forward_eligible).toBe(true);
    expect(r.diverged).toBe(false);
    expect(r.new_envelopes).toBe(0);
    const stdout = outs.join("");
    expect(stdout).toContain("rig-bridge: sync pulled=false");
    expect(stdout).toContain("fast_forward=true");
    expect(stdout).toContain("new_envelopes=0");
    // Stderr should narrate the up-to-date state, NOT a fast-forward preview.
    expect(errs.join("")).toMatch(/up to date/);
  });
});

describe("runSync — remote-ahead (1 new envelope)", () => {
  function publishOneNewEnvelope(t: Triple): void {
    const threadDir = join(t.remote2, "thread-1");
    mkdirSync(threadDir);
    const envelopePath = join(threadDir, "REQUEST.md");
    writeFileSync(
      envelopePath,
      "---\nfrom: mac-m5max\nto: windows-5080\ndate: 2026-05-15\nstatus: '▶ open'\ntype: REQUEST\nthread: thread-1\n---\n\nbody\n",
    );
    safeCommit({
      files: [envelopePath],
      message: "open thread-1",
      cwd: t.remote2,
    });
    spawnSync("git", ["push", "origin", "main"], { cwd: t.remote2, encoding: "utf8" });
  }

  it("without --auto: refuses to pull, surfaces a fast-forward preview on stderr", async () => {
    publishOneNewEnvelope(triple);
    const outs: string[] = [];
    const errs: string[] = [];
    const r = await runSync({
      cwd: triple.local,
      stdout: (s) => outs.push(s),
      stderr: (s) => errs.push(s),
    });
    expect(r.pulled).toBe(false);
    expect(r.fast_forward_eligible).toBe(true);
    expect(r.diverged).toBe(false);
    expect(r.new_envelopes).toBe(1);
    const stdout = outs.join("");
    expect(stdout).toMatch(/pulled=false/);
    expect(stdout).toMatch(/fast_forward=true/);
    expect(stdout).toMatch(/new_envelopes=1/);
    const stderr = errs.join("");
    expect(stderr).toMatch(/ready to fast-forward 1 envelope/);
    expect(stderr).toMatch(/thread-1\/REQUEST\.md/);
    expect(stderr).toMatch(/sync --auto/);
  });

  it("with --auto: pulls, sets pulled=true, surfaces success on stderr", async () => {
    publishOneNewEnvelope(triple);
    const outs: string[] = [];
    const errs: string[] = [];
    const r = await runSync({
      cwd: triple.local,
      auto: true,
      stdout: (s) => outs.push(s),
      stderr: (s) => errs.push(s),
    });
    expect(r.pulled).toBe(true);
    expect(r.fast_forward_eligible).toBe(true);
    expect(r.diverged).toBe(false);
    expect(r.new_envelopes).toBe(1);
    const stdout = outs.join("");
    expect(stdout).toMatch(/pulled=true/);
    expect(stdout).toMatch(/new_envelopes=1/);
    const stderr = errs.join("");
    expect(stderr).toMatch(/fast-forwarded 1 envelope/);
  });
});

describe("runSync — local-only (local ahead, remote unchanged)", () => {
  it("returns pulled=false, fast_forward_eligible=true, new_envelopes=0, no divergence", async () => {
    // Make a local-only commit; remote2 doesn't push anything.
    writeFileSync(join(triple.local, "local-only.md"), "x\n");
    safeCommit({
      files: [join(triple.local, "local-only.md")],
      message: "local only",
      cwd: triple.local,
    });
    const outs: string[] = [];
    const errs: string[] = [];
    const r = await runSync({
      cwd: triple.local,
      stdout: (s) => outs.push(s),
      stderr: (s) => errs.push(s),
    });
    expect(r.pulled).toBe(false);
    expect(r.fast_forward_eligible).toBe(true);
    expect(r.diverged).toBe(false);
    expect(r.new_envelopes).toBe(0);
    expect(errs.join("")).toMatch(/up to date/);
  });
});

describe("runSync — divergence (both sides ahead)", () => {
  it("refuses the pull, sets diverged=true, surfaces the divergence report on stderr", async () => {
    // Local commit.
    writeFileSync(join(triple.local, "local-side.md"), "local\n");
    safeCommit({
      files: [join(triple.local, "local-side.md")],
      message: "local side",
      cwd: triple.local,
    });
    // Remote commit + push.
    writeFileSync(join(triple.remote2, "remote-side.md"), "remote\n");
    safeCommit({
      files: [join(triple.remote2, "remote-side.md")],
      message: "remote side",
      cwd: triple.remote2,
    });
    spawnSync("git", ["push", "origin", "main"], { cwd: triple.remote2, encoding: "utf8" });

    const outs: string[] = [];
    const errs: string[] = [];
    const r = await runSync({
      cwd: triple.local,
      stdout: (s) => outs.push(s),
      stderr: (s) => errs.push(s),
    });
    expect(r.pulled).toBe(false);
    expect(r.diverged).toBe(true);
    expect(r.fast_forward_eligible).toBe(false);
    const stdout = outs.join("");
    expect(stdout).toMatch(/pulled=false/);
    expect(stdout).toMatch(/diverged=true/);
    const stderr = errs.join("");
    expect(stderr).toMatch(/sync refused/);
    expect(stderr).toMatch(/Recovery/);
    expect(stderr).toMatch(/git pull --rebase/);
  });

  it("--auto on diverged: still refuses (L1 safety — never auto-merge divergence)", async () => {
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
    spawnSync("git", ["push", "origin", "main"], { cwd: triple.remote2, encoding: "utf8" });

    const r = await runSync({
      cwd: triple.local,
      auto: true,
      stdout: () => {},
      stderr: () => {},
    });
    expect(r.pulled).toBe(false);
    expect(r.diverged).toBe(true);
  });
});

describe("runSync — append-only enforcement (L2)", () => {
  it("refuses when remote modified an existing file (non-append change)", async () => {
    // Remote modifies seed.md (which both sides already have).
    writeFileSync(join(triple.remote2, "seed.md"), "remote-edit\n");
    safeCommit({
      files: [join(triple.remote2, "seed.md")],
      message: "modify seed",
      cwd: triple.remote2,
    });
    spawnSync("git", ["push", "origin", "main"], { cwd: triple.remote2, encoding: "utf8" });

    const outs: string[] = [];
    const errs: string[] = [];
    const r = await runSync({
      cwd: triple.local,
      stdout: (s) => outs.push(s),
      stderr: (s) => errs.push(s),
    });
    expect(r.pulled).toBe(false);
    expect(r.diverged).toBe(true);
    expect(r.fast_forward_eligible).toBe(false);
    expect(r.divergence_report?.changed_envelopes?.length).toBeGreaterThan(0);
    const stdout = outs.join("");
    expect(stdout).toMatch(/reason=non_append_change_on_remote/);
    const stderr = errs.join("");
    expect(stderr).toMatch(/seed\.md/);
    expect(stderr).toMatch(/modified in place/);
    expect(stderr).toMatch(/append-only rule violated/);
  });

  it("--auto on non-append remote change: still refuses (L2 safety)", async () => {
    writeFileSync(join(triple.remote2, "seed.md"), "remote-edit\n");
    safeCommit({
      files: [join(triple.remote2, "seed.md")],
      message: "modify seed",
      cwd: triple.remote2,
    });
    spawnSync("git", ["push", "origin", "main"], { cwd: triple.remote2, encoding: "utf8" });

    const r = await runSync({
      cwd: triple.local,
      auto: true,
      stdout: () => {},
      stderr: () => {},
    });
    expect(r.pulled).toBe(false);
    expect(r.diverged).toBe(true);
  });
});

describe("runSync — --json output (L15)", () => {
  it("emits a single JSON object with schema_version=1.0 in the no-op case", async () => {
    const outs: string[] = [];
    const errs: string[] = [];
    await runSync({
      cwd: triple.local,
      json: true,
      stdout: (s) => outs.push(s),
      stderr: (s) => errs.push(s),
    });
    const joined = outs.join("");
    expect(() => JSON.parse(joined)).not.toThrow();
    const payload = JSON.parse(joined);
    expect(payload.schema_version).toBe("1.0");
    expect(payload.pulled).toBe(false);
    expect(payload.fast_forward_eligible).toBe(true);
    expect(payload.diverged).toBe(false);
    expect(payload.new_envelopes_count).toBe(0);
    expect(payload.local_head).toMatch(/^[0-9a-f]{40}$/);
  });

  it("includes the full divergence_report on the diverged path", async () => {
    writeFileSync(join(triple.remote2, "seed.md"), "remote-edit\n");
    safeCommit({
      files: [join(triple.remote2, "seed.md")],
      message: "modify seed",
      cwd: triple.remote2,
    });
    spawnSync("git", ["push", "origin", "main"], { cwd: triple.remote2, encoding: "utf8" });

    const outs: string[] = [];
    await runSync({
      cwd: triple.local,
      json: true,
      stdout: (s) => outs.push(s),
      stderr: () => {},
    });
    const payload = JSON.parse(outs.join(""));
    expect(payload.schema_version).toBe("1.0");
    expect(payload.pulled).toBe(false);
    expect(payload.diverged).toBe(true);
    expect(payload.divergence_report).toBeDefined();
    expect(payload.divergence_report.changed_envelopes.length).toBeGreaterThan(0);
    expect(payload.divergence_report.changed_envelopes[0].reason).toMatch(/modified in place/);
  });

  it("--json + --auto + FF-eligible: pulls and emits JSON with pulled=true", async () => {
    const threadDir = join(triple.remote2, "thread-1");
    mkdirSync(threadDir);
    writeFileSync(
      join(threadDir, "REQUEST.md"),
      "---\nfrom: mac-m5max\nto: windows-5080\ndate: 2026-05-15\nstatus: '▶ open'\ntype: REQUEST\nthread: thread-1\n---\n\nbody\n",
    );
    safeCommit({
      files: [join(threadDir, "REQUEST.md")],
      message: "open thread-1",
      cwd: triple.remote2,
    });
    spawnSync("git", ["push", "origin", "main"], { cwd: triple.remote2, encoding: "utf8" });

    const outs: string[] = [];
    await runSync({
      cwd: triple.local,
      auto: true,
      json: true,
      stdout: (s) => outs.push(s),
      stderr: () => {},
    });
    const payload = JSON.parse(outs.join(""));
    expect(payload.schema_version).toBe("1.0");
    expect(payload.pulled).toBe(true);
    expect(payload.new_envelopes_count).toBe(1);
    expect(payload.divergence_report.new_envelopes[0].path).toBe("thread-1/REQUEST.md");
  });
});
