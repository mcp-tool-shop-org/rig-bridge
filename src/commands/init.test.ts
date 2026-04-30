import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runInit, shouldPrintBridgeIgnoreHint } from "./init.js";
import { configPath } from "../engine/config.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rig-bridge-init-"));
  spawnSync("git", ["init", "-b", "main", dir], { encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "t@x"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "T"], { cwd: dir, encoding: "utf8" });
  return () => rmSync(dir, { recursive: true, force: true });
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
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it("rejects an invalid rig id", () => {
    expect(() =>
      runInit({ cwd: dir, rigId: "Mac", stdout: () => {} }),
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
    return () => rmSync(d, { recursive: true, force: true });
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
});
