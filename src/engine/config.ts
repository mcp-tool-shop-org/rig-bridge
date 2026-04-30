// Read/write `.bridge/config.yaml` in the bridge repo root.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { validateRigId } from "./rig-id.js";

export const BRIDGE_DIR = ".bridge";
export const CONFIG_FILENAME = "config.yaml";

export interface BridgeConfig {
  rig_id: string;
  display_name?: string;
  default_thread?: string | null;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function configPath(repoRoot: string): string {
  return join(repoRoot, BRIDGE_DIR, CONFIG_FILENAME);
}

export function readConfig(repoRoot: string): BridgeConfig {
  const p = configPath(repoRoot);
  if (!existsSync(p)) {
    throw new ConfigError(
      `${p} not found — run \`rig-bridge init\` from the bridge repo root first`,
    );
  }
  const raw = readFileSync(p, "utf8");
  let parsed: unknown;
  try {
    parsed = yamlParse(raw);
  } catch (e) {
    throw new ConfigError(
      `${p} is not valid YAML: ${(e as Error).message}`,
    );
  }
  if (parsed === null || parsed === undefined || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigError(`${p} must be a YAML mapping`);
  }
  const cfg = parsed as Record<string, unknown>;
  if (typeof cfg.rig_id !== "string") {
    throw new ConfigError(`${p}: rig_id is required and must be a string`);
  }
  const idCheck = validateRigId(cfg.rig_id);
  if (!idCheck.ok) {
    throw new ConfigError(`${p}: ${idCheck.reason}`);
  }
  const out: BridgeConfig = { rig_id: cfg.rig_id };
  if (cfg.display_name !== undefined) {
    if (typeof cfg.display_name !== "string") {
      throw new ConfigError(`${p}: display_name must be a string`);
    }
    if (cfg.display_name.length > 80) {
      throw new ConfigError(`${p}: display_name exceeds 80-char cap`);
    }
    out.display_name = cfg.display_name;
  }
  if (cfg.default_thread !== undefined) {
    if (cfg.default_thread === null) {
      out.default_thread = null;
    } else if (typeof cfg.default_thread === "string") {
      out.default_thread = cfg.default_thread;
    } else {
      throw new ConfigError(`${p}: default_thread must be a string or null`);
    }
  }
  return out;
}

export function writeConfig(
  repoRoot: string,
  cfg: BridgeConfig,
  { force = false }: { force?: boolean } = {},
): string {
  const idCheck = validateRigId(cfg.rig_id);
  if (!idCheck.ok) {
    throw new ConfigError(`rig_id invalid: ${idCheck.reason}`);
  }
  if (cfg.display_name !== undefined && cfg.display_name.length > 80) {
    throw new ConfigError("display_name exceeds 80-char cap");
  }
  const p = configPath(repoRoot);
  if (existsSync(p) && !force) {
    throw new ConfigError(
      `${p} already exists — pass --force to overwrite`,
    );
  }
  mkdirSync(dirname(p), { recursive: true });
  const out: Record<string, unknown> = { rig_id: cfg.rig_id };
  if (cfg.display_name !== undefined) out.display_name = cfg.display_name;
  if (cfg.default_thread !== undefined) out.default_thread = cfg.default_thread;
  const text = yamlStringify(out, { lineWidth: 0 });
  writeFileSync(p, text, "utf8");
  return p;
}
