// `rig-bridge init` — set up a freshly cloned bridge repo.
//
// Behaviour:
//   * cwd MUST be inside a git working tree.
//   * Validates --rig-id (kebab-case) at ingress.
//   * Writes .bridge/config.yaml at repo root (errors if exists, unless
//     --force).
//   * Installs a placeholder commit-message hook at .git/hooks/commit-msg.
//     v1.0.0 keeps this a no-op; v1.1 may add real validation.

import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { isGitRepo, repoRoot } from "../engine/git.js";
import { writeConfig, configPath } from "../engine/config.js";
import { validateRigId } from "../engine/rig-id.js";

export interface InitArgs {
  cwd: string;
  rigId: string;
  displayName?: string;
  force?: boolean;
  /** stdout writer (injected for tests) */
  stdout?: (line: string) => void;
}

export interface InitResult {
  configPath: string;
  hookPath: string;
}

const PLACEHOLDER_HOOK = `#!/bin/sh
# rig-bridge commit-msg hook (v1.0.0 placeholder).
# v1.1 may add real validation here. For now this is a no-op.
exit 0
`;

export function runInit(args: InitArgs): InitResult {
  const stdout = args.stdout ?? ((s: string) => process.stdout.write(s));

  const id = validateRigId(args.rigId);
  if (!id.ok) {
    throw new Error(`--rig-id: ${id.reason}`);
  }
  if (args.displayName !== undefined && args.displayName.length > 80) {
    throw new Error("--display-name exceeds 80-char cap");
  }

  if (!isGitRepo(args.cwd)) {
    throw new Error(
      `cwd is not inside a git repo: ${args.cwd}. Run \`git init\` (or \`git clone\`) first.`,
    );
  }
  const root = repoRoot(args.cwd);

  const cfgPath = writeConfig(
    root,
    {
      rig_id: args.rigId,
      ...(args.displayName ? { display_name: args.displayName } : {}),
    },
    { force: args.force },
  );

  // Hook path: .git/hooks/commit-msg
  const hooksDir = join(root, ".git", "hooks");
  mkdirSync(hooksDir, { recursive: true });
  const hookPath = join(hooksDir, "commit-msg");
  if (!existsSync(hookPath) || args.force) {
    writeFileSync(hookPath, PLACEHOLDER_HOOK, "utf8");
    try {
      chmodSync(hookPath, 0o755);
    } catch {
      // Some FS layers (e.g. Windows) don't support chmod; non-fatal.
    }
  }

  stdout(`rig-bridge: initialized\n`);
  stdout(`  config: ${configPath(root)}\n`);
  stdout(`  hook:   ${hookPath}\n`);
  return { configPath: cfgPath, hookPath };
}
