// `rig-bridge init` — set up a freshly cloned bridge repo.
//
// Behaviour:
//   * cwd MUST be inside a git working tree.
//   * Validates --rig-id (kebab-case) at ingress.
//   * Writes .bridge/config.yaml at repo root (errors if exists, unless
//     --force).
//   * Installs a placeholder commit-message hook at .git/hooks/commit-msg.
//     v1.0.0 keeps this a no-op; v1.1 may add real validation.
//
// OUTPUT DISCIPLINE (B-CMD-002 / B-CMD-003, Stage C wave 1):
//   * stdout is the stable, parseable contract — one line, key=value pairs
//     suitable for `result=$(rig-bridge init)` and `awk` consumption. No
//     absolute filesystem paths (those leak host layout into logs).
//   * stderr is the human-readable narrative — full paths, side-effect
//     descriptions, and hints. Scripts that pipe stdout get clean parseable
//     lines; operators watching the terminal see the full story on stderr.

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { basename, join } from "node:path";
import { isGitRepo, repoRoot } from "../engine/git.js";
import { writeConfig, configPath } from "../engine/config.js";
import { validateRigId, normalizeRigId } from "../engine/rig-id.js";

// B-ENG-003 cross-cutting fix: case-normalize rig-ids at command ingress so
// `--rig-id Mac-M5max` becomes `mac-m5max` before validation. The Engine
// helper `normalizeRigId` is imported above; it is a pure (trim +
// lowercase) transform. validateRigId stays a pure predicate, so the
// composition `validateRigId(normalizeRigId(input))` is the explicit
// auto-fix shape the brief mandates for init, send, and close.

/**
 * Decide whether to print the .bridge/ gitignore hint.
 *
 * F-002 (dogfood-friction.md, 2026-04-30): operators leave `init` with an
 * untracked `.bridge/config.yaml` and have to figure out whether to commit
 * it or ignore it. Print a one-line hint when neither outcome is already
 * settled.
 *
 * Returns true when a hint is warranted: there's a `.gitignore` at the
 * repo root that does NOT exclude `.bridge`. (No `.gitignore` at all is
 * fine — committing the config is a reasonable default.)
 */
export function shouldPrintBridgeIgnoreHint(repoRootPath: string): boolean {
  const gitignorePath = join(repoRootPath, ".gitignore");
  if (!existsSync(gitignorePath)) return false;
  const lines = readFileSync(gitignorePath, "utf8")
    .split("\n")
    .map((l) => l.trim());
  return !lines.some((l) =>
    l === ".bridge" ||
    l === ".bridge/" ||
    l === ".bridge/*" ||
    l === ".bridge/config.yaml" ||
    l === ".bridge/config.yml",
  );
}

export interface InitArgs {
  cwd: string;
  rigId: string;
  displayName?: string;
  force?: boolean;
  /** stdout writer (injected for tests). Parseable contract — one key=value line. */
  stdout?: (line: string) => void;
  /** stderr writer (injected for tests). Human-readable narrative — full paths + hints. */
  stderr?: (line: string) => void;
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
  const stderr = args.stderr ?? ((s: string) => process.stderr.write(s));

  // B-ENG-003: case-normalize the rig-id at ingress before validation so
  // `Mac-M5max` → `mac-m5max` and downstream config/envelope writes carry
  // the canonical form.
  const normalizedRigId = normalizeRigId(args.rigId);
  const id = validateRigId(normalizedRigId);
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
      rig_id: normalizedRigId,
      ...(args.displayName ? { display_name: args.displayName } : {}),
    },
    { force: args.force },
  );

  // Hook path: .git/hooks/commit-msg
  // F-CMD-001: config write requires --force on re-init; mirror that for
  // the hook so re-init is symmetric. An operator who has customized the
  // commit-msg hook should not have it silently clobbered. Error shape
  // matches the writeConfig error from engine/config.ts so the operator
  // sees a familiar message.
  const hooksDir = join(root, ".git", "hooks");
  mkdirSync(hooksDir, { recursive: true });
  const hookPath = join(hooksDir, "commit-msg");
  if (existsSync(hookPath) && !args.force) {
    throw new Error(
      `${hookPath} already exists — pass --force to overwrite`,
    );
  }
  writeFileSync(hookPath, PLACEHOLDER_HOOK, "utf8");
  try {
    chmodSync(hookPath, 0o755);
  } catch {
    // Some FS layers (e.g. Windows) don't support chmod; non-fatal.
  }

  // B-CMD-002 split:
  //   stdout: single key=value contract line PLUS the gitignore action hint
  //           (when warranted). The `root=` token is the repo BASENAME, not
  //           an absolute path — leaking host filesystem layout
  //           (E:/AI/rig-bridge) into logs was the original bug. The repo
  //           name is enough for an operator to disambiguate; the full path
  //           stays on stderr for humans. The gitignore hint is the
  //           "what should I do next?" prompt and remains on stdout because
  //           it's actionable advice (not a side-effect description). The
  //           ABSOLUTE-PATH narrative lines move to stderr.
  //   stderr: full paths + side-effect descriptions. Scripts that pipe
  //           stdout get the contract line + optional hint and never see
  //           the host filesystem layout.
  const rootName = basename(root);
  stdout(
    `rig-bridge: init OK rig-id=${normalizedRigId} root=${rootName}\n`,
  );
  stderr(`rig-bridge: initialized\n`);
  stderr(`  config: ${configPath(root)}\n`);
  stderr(`  hook:   ${hookPath}\n`);
  if (shouldPrintBridgeIgnoreHint(root)) {
    stdout(
      `note: .bridge/config.yaml is untracked — commit it or add \`.bridge/\` to .gitignore\n`,
    );
  }
  return { configPath: cfgPath, hookPath };
}
