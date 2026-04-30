import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { readConfig, writeConfig, ConfigError, configPath } from "./config.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rig-bridge-config-"));
  return () => rmSync(root, { recursive: true, force: true });
});

describe("writeConfig + readConfig", () => {
  it("writes and reads a minimal config", () => {
    writeConfig(root, { rig_id: "mac-m5max" });
    const cfg = readConfig(root);
    expect(cfg.rig_id).toBe("mac-m5max");
  });

  it("preserves display_name and default_thread", () => {
    writeConfig(root, {
      rig_id: "mac-m5max",
      display_name: "Mac Claude",
      default_thread: "swarm-rig-bridge-001",
    });
    const cfg = readConfig(root);
    expect(cfg.display_name).toBe("Mac Claude");
    expect(cfg.default_thread).toBe("swarm-rig-bridge-001");
  });

  it("refuses to overwrite an existing config without force", () => {
    writeConfig(root, { rig_id: "mac-m5max" });
    expect(() => writeConfig(root, { rig_id: "mac-m5max" })).toThrow(
      ConfigError,
    );
  });

  it("overwrites with force", () => {
    writeConfig(root, { rig_id: "mac-m5max" });
    writeConfig(root, { rig_id: "windows-5080" }, { force: true });
    expect(readConfig(root).rig_id).toBe("windows-5080");
  });

  it("rejects an invalid rig id at write", () => {
    expect(() => writeConfig(root, { rig_id: "Mac" })).toThrow(ConfigError);
  });

  it("rejects display_name over 80 chars at write", () => {
    expect(() =>
      writeConfig(root, {
        rig_id: "mac-m5max",
        display_name: "x".repeat(81),
      }),
    ).toThrow(ConfigError);
  });

  it("read fails when config is missing", () => {
    expect(() => readConfig(root)).toThrow(/not found/);
  });

  it("read rejects yaml that isn't a mapping", () => {
    const p = configPath(root);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, "- just\n- a\n- list\n", "utf8");
    expect(() => readConfig(root)).toThrow(ConfigError);
  });

  it("read rejects bad rig_id in stored config", () => {
    const p = configPath(root);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, "rig_id: BadID\n", "utf8");
    expect(() => readConfig(root)).toThrow(ConfigError);
  });

  it("written file is plain YAML", () => {
    writeConfig(root, { rig_id: "mac-m5max", display_name: "Mac Claude" });
    const text = readFileSync(configPath(root), "utf8");
    expect(text).toContain("rig_id: mac-m5max");
    expect(text).toContain("display_name: Mac Claude");
  });
});
