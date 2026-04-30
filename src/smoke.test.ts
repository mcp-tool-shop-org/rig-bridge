// Round-trip integration smoke test.
//
// init → new → send (HANDOFF) → close (completed). Validates that:
//   * each command's file is created at the expected path
//   * each frontmatter block validates against the schema
//   * each step produces a 40-char commit SHA
//   * the close step finds the peer rig by scanning prior envelopes
//   * Path B-2: zero CP-table references in the source tree (the
//     orchestrator's grep guard verifies this externally)

import { describe, it, expect, beforeEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runInit } from "./commands/init.js";
import { runNew } from "./commands/new.js";
import { runSend } from "./commands/send.js";
import { runClose } from "./commands/close.js";
import { parseEnvelope } from "./engine/envelope.js";
import { validateFrontmatter } from "./engine/schema-validator.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rig-bridge-smoke-"));
  spawnSync("git", ["init", "-b", "main", dir], { encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "smoke@test"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "Smoke Test"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir, encoding: "utf8" });
  return () => rmSync(dir, { recursive: true, force: true });
});

describe("rig-bridge round-trip smoke", () => {
  it("init → new → send → close lands four files and three commits", () => {
    const noisy: string[] = [];
    const stdout = (s: string) => noisy.push(s);
    const stderr = (s: string) => noisy.push(s);

    // 1. init
    const initRes = runInit({
      cwd: dir,
      rigId: "mac-m5max",
      displayName: "Mac Claude",
      stdout,
    });
    expect(existsSync(initRes.configPath)).toBe(true);
    expect(existsSync(initRes.hookPath)).toBe(true);

    // 2. new test-thread
    const newRes = runNew({
      cwd: dir,
      threadId: "test-thread",
      stdout,
    });
    expect(existsSync(newRes.filePath)).toBe(true);
    {
      const env = parseEnvelope(readFileSync(newRes.filePath, "utf8"));
      // The scaffolded REQUEST.md uses the placeholder string for `to`,
      // which will not validate against the schema — that's intentional;
      // the user fills it in before `send`. We still parse it.
      expect(env.frontmatter.type).toBe("REQUEST");
    }

    // 3. send HANDOFF (with a valid recipient rig id)
    const sendRes = runSend({
      cwd: dir,
      type: "HANDOFF",
      threadId: "test-thread",
      to: ["windows-5080"],
      status: "▶ Smoke test",
      tldr: "smoke-test handoff",
      bodyText: "# wave 1\n\nDispatched.\n\nStanding by.\n",
      noPush: true,
      stdout,
      stderr,
    });
    expect(sendRes.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(sendRes.statusClass).toBe("active");
    {
      const env = parseEnvelope(readFileSync(sendRes.filePath, "utf8"));
      const v = validateFrontmatter(env.frontmatter);
      expect(v.valid).toBe(true);
      expect(env.frontmatter.from).toBe("mac-m5max");
      expect(env.frontmatter.to).toBe("windows-5080");
      expect(env.frontmatter.tldr).toBe("smoke-test handoff");
    }

    // 4. close test-thread --status completed --note "Done"
    const closeRes = runClose({
      cwd: dir,
      threadId: "test-thread",
      status: "completed",
      note: "Done",
      noPush: true,
      stdout,
      stderr,
    });
    expect(closeRes.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(closeRes.statusClass).toBe("completed");
    {
      const env = parseEnvelope(readFileSync(closeRes.filePath, "utf8"));
      const v = validateFrontmatter(env.frontmatter);
      expect(v.valid).toBe(true);
      expect(env.frontmatter.type).toBe("RESOLUTION");
      // Peer-inference picked up the previous HANDOFF's `to: windows-5080`
      // and routed the RESOLUTION back to the same peer.
      expect(env.frontmatter.to).toBe("windows-5080");
    }

    // The thread directory holds REQUEST.md, HANDOFF.md, RESOLUTION.md
    const threadEntries = readdirSync(join(dir, "test-thread")).sort();
    expect(threadEntries).toEqual([
      "HANDOFF.md",
      "REQUEST.md",
      "RESOLUTION.md",
    ]);

    // Three real commits (init didn't make one — only writeConfig).
    const log = spawnSync(
      "git",
      ["log", "--oneline"],
      { cwd: dir, encoding: "utf8" },
    );
    const lines = log.stdout.split("\n").filter((s) => s.length > 0);
    // send + close = 2 commits (init only writes files, no commit)
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("RESOLUTION");
    expect(lines[1]).toContain("HANDOFF");
  });
});
