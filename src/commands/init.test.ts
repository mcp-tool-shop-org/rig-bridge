import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runInit } from "./init.js";
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
});
