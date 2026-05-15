import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runInit, shouldPrintBridgeIgnoreHint } from "./init.js";
import { configPath } from "../engine/config.js";

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
  dir = mkdtempSync(join(tmpdir(), "rig-bridge-init-"));
  spawnSync("git", ["init", "-b", "main", dir], { encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "t@x"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "T"], { cwd: dir, encoding: "utf8" });
  return () => cleanupTempDir(dir);
});

describe("runInit", () => {
  it("writes a config and installs the placeholder hook", () => {
    const out: string[] = [];
    const r = runInit({
      cwd: dir,
      rigId: "mac-m5max",
      displayName: "Mac Claude",
      stdout: (s) => out.push(s),
    });
    expect(existsSync(r.configPath)).toBe(true);
    expect(existsSync(r.hookPath)).toBe(true);
    const cfgText = readFileSync(configPath(dir), "utf8");
    expect(cfgText).toContain("rig_id: mac-m5max");
    expect(cfgText).toContain("display_name: Mac Claude");
    const hookText = readFileSync(r.hookPath, "utf8");
    expect(hookText).toContain("rig-bridge");
  });

  it("errors when cwd is not a git repo", () => {
    const plain = mkdtempSync(join(tmpdir(), "rig-bridge-plain-"));
    try {
      expect(() =>
        runInit({ cwd: plain, rigId: "mac-m5max", stdout: () => {} }),
      ).toThrow(/not inside a git repo/);
    } finally {
      cleanupTempDir(plain);
    }
  });

  it("rejects an invalid rig id", () => {
    // B-ENG-003 (parallel Commands wave): init.ts now case-normalizes the
    // rig-id at ingress, so "Mac" → "mac" which is valid. The test fixture
    // must use an input that remains invalid AFTER trim+lowercase to still
    // exercise the validator-rejection branch. "Bad Id!" → "bad id!" still
    // contains a space + "!" so RIG_ID_PATTERN rejects it.
    expect(() =>
      runInit({ cwd: dir, rigId: "Bad Id!", stdout: () => {} }),
    ).toThrow(/--rig-id/);
  });

  it("refuses to overwrite without --force", () => {
    runInit({ cwd: dir, rigId: "mac-m5max", stdout: () => {} });
    expect(() =>
      runInit({ cwd: dir, rigId: "mac-m5max", stdout: () => {} }),
    ).toThrow(/already exists/);
  });

  it("overwrites with --force", () => {
    runInit({ cwd: dir, rigId: "mac-m5max", stdout: () => {} });
    runInit({
      cwd: dir,
      rigId: "windows-5080",
      force: true,
      stdout: () => {},
    });
    const cfgText = readFileSync(configPath(dir), "utf8");
    expect(cfgText).toContain("windows-5080");
  });

  // F-002 (dogfood-friction.md, 2026-04-30): operators were left with an
  // untracked .bridge/config.yaml after init when the repo had a .gitignore
  // that didn't cover .bridge/. Print a one-line hint when that's the case.
  it("prints a gitignore hint when .gitignore exists but doesn't exclude .bridge/", () => {
    writeFileSync(join(dir, ".gitignore"), "node_modules/\ndist/\n", "utf8");
    const out: string[] = [];
    runInit({ cwd: dir, rigId: "mac-m5max", stdout: (s) => out.push(s) });
    const joined = out.join("");
    expect(joined).toContain(".bridge/config.yaml is untracked");
    expect(joined).toContain(".gitignore");
  });

  it("does NOT print the gitignore hint when .gitignore already excludes .bridge/", () => {
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n.bridge/\n", "utf8");
    const out: string[] = [];
    runInit({ cwd: dir, rigId: "mac-m5max", stdout: (s) => out.push(s) });
    expect(out.join("")).not.toContain("untracked");
  });

  it("does NOT print the gitignore hint when there's no .gitignore at all (committing the config is reasonable)", () => {
    const out: string[] = [];
    runInit({ cwd: dir, rigId: "mac-m5max", stdout: (s) => out.push(s) });
    expect(out.join("")).not.toContain("untracked");
  });
});

describe("shouldPrintBridgeIgnoreHint", () => {
  let d: string;
  beforeEach(() => {
    d = mkdtempSync(join(tmpdir(), "rig-bridge-hint-"));
    return () => cleanupTempDir(d);
  });

  it("returns false when .gitignore is absent", () => {
    expect(shouldPrintBridgeIgnoreHint(d)).toBe(false);
  });

  it("returns true when .gitignore exists but doesn't cover .bridge/", () => {
    writeFileSync(join(d, ".gitignore"), "node_modules/\n", "utf8");
    expect(shouldPrintBridgeIgnoreHint(d)).toBe(true);
  });

  it("returns false when .gitignore covers .bridge/ via any common form", () => {
    for (const line of [".bridge", ".bridge/", ".bridge/*", ".bridge/config.yaml", ".bridge/config.yml"]) {
      writeFileSync(join(d, ".gitignore"), `${line}\n`, "utf8");
      expect(shouldPrintBridgeIgnoreHint(d)).toBe(false);
    }
  });

  // B-TST-005 (Stage C wave 1): on Windows with `core.autocrlf=true`, the
  // local working-tree `.gitignore` can end up with CRLF line endings even
  // when the upstream repo stores LF. The hint check parses the file
  // line-by-line; if the regex/equality check is sensitive to a trailing
  // `\r`, an operator on Windows with autocrlf gets DIFFERENT behavior
  // from the same operator on macOS. Pin both forks.
  //
  // The current implementation in init.ts splits on `\n` and `.trim()`s each
  // line — that strips trailing `\r` so the comparison is CRLF-safe. These
  // tests lock that behavior. If a future refactor switches to a regex like
  // /^\.bridge\/?$/m (which would NOT tolerate `\r`), these tests catch the
  // silent cross-OS regression.
  it("returns false with CRLF line endings when .gitignore covers .bridge/", () => {
    for (const line of [".bridge", ".bridge/", ".bridge/*", ".bridge/config.yaml", ".bridge/config.yml"]) {
      writeFileSync(join(d, ".gitignore"), `${line}\r\n`, "utf8");
      expect(shouldPrintBridgeIgnoreHint(d)).toBe(false);
    }
  });

  it("returns true with CRLF line endings when .gitignore does NOT cover .bridge/", () => {
    writeFileSync(join(d, ".gitignore"), "node_modules/\r\ndist/\r\n", "utf8");
    expect(shouldPrintBridgeIgnoreHint(d)).toBe(true);
  });

  it("returns false with mixed CRLF + LF endings on the same file when .bridge/ is covered", () => {
    // `git config core.autocrlf` can produce a single-file mix when the
    // file is edited on multiple OSes in the same checkout.
    writeFileSync(
      join(d, ".gitignore"),
      "node_modules/\r\n.bridge/\ndist/\r\n",
      "utf8",
    );
    expect(shouldPrintBridgeIgnoreHint(d)).toBe(false);
  });
});

// B-TST-005 (Stage C wave 1): integration-level pin for the same CRLF
// behavior through the full runInit path. If init.ts ever switches its
// own .gitignore reading to a CRLF-sensitive form, this surfaces.
describe("runInit + CRLF .gitignore (B-TST-005)", () => {
  it("prints the hint when CRLF .gitignore exists but doesn't exclude .bridge/", () => {
    writeFileSync(join(dir, ".gitignore"), "node_modules/\r\ndist/\r\n", "utf8");
    const out: string[] = [];
    runInit({ cwd: dir, rigId: "mac-m5max", stdout: (s) => out.push(s) });
    const joined = out.join("");
    expect(joined).toContain(".bridge/config.yaml is untracked");
  });

  it("does NOT print the hint when CRLF .gitignore already excludes .bridge/", () => {
    writeFileSync(join(dir, ".gitignore"), "node_modules/\r\n.bridge/\r\n", "utf8");
    const out: string[] = [];
    runInit({ cwd: dir, rigId: "mac-m5max", stdout: (s) => out.push(s) });
    expect(out.join("")).not.toContain("untracked");
  });
});
