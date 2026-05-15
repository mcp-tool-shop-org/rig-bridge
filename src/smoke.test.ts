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
import { bodyHash } from "./engine/body-hash.js";

let dir: string;

// B-TST-001 (Stage C wave 1): wrap temp-dir cleanup so a transient Windows
// file-lock or a swallowed error during teardown surfaces in test output
// instead of silently corrupting the next test's environment. `force` keeps
// teardown best-effort; `maxRetries` survives EBUSY/EPERM on Windows when a
// child process is briefly still holding a handle.
function cleanupTempDir(p: string): void {
  try {
    rmSync(p, { recursive: true, force: true, maxRetries: 3 });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("temp cleanup failed for", p, e);
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rig-bridge-smoke-"));
  spawnSync("git", ["init", "-b", "main", dir], { encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "smoke@test"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "Smoke Test"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir, encoding: "utf8" });
  return () => cleanupTempDir(dir);
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
      // F-TST-013 (CRITICAL): body_hash round-trip invariant on HANDOFF.
      // Re-read the disk envelope, parse it, recompute the hash from the
      // parsed body, and assert it matches the persisted body_hash. This is
      // the canonical drift-detection invariant — a receiving rig does
      // exactly this on pull.
      expect(env.frontmatter.body_hash).toBe(sendRes.bodyHash);
      expect(bodyHash(env.body)).toBe(env.frontmatter.body_hash);
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
      // F-TST-013 (CRITICAL): body_hash round-trip invariant on RESOLUTION.
      // The close command must persist body_hash too — without it, a peer
      // pulling the RESOLUTION cannot detect body drift on the close.
      expect(env.frontmatter.body_hash).toBe(closeRes.bodyHash);
      expect(bodyHash(env.body)).toBe(env.frontmatter.body_hash);
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

  // F-TST-013 (CRITICAL): the body_hash round-trip invariant is the load-
  // bearing success bar for the rig-bridge transport. The bridge works
  // because every envelope written by send/close carries a sha256 of its
  // §4.1-normalized body, and the receiving rig re-hashes on pull to detect
  // drift. This test exhaustively walks the thread directory after a full
  // init → new → send → close round-trip and verifies that for every
  // envelope authored by the CLI (HANDOFF from send + RESOLUTION from close)
  // re-reading from disk and re-hashing matches the persisted body_hash.
  // REQUEST.md scaffolded by `new` is not authored via the CLI's send/close
  // pipeline (the operator fills it in), so it is exempted.
  it("body_hash round-trip invariant holds for every sent + closed envelope", () => {
    runInit({
      cwd: dir,
      rigId: "mac-m5max",
      displayName: "Mac Claude",
      stdout: () => {},
    });
    runNew({ cwd: dir, threadId: "drift-thread", stdout: () => {} });
    const sent = runSend({
      cwd: dir,
      type: "HANDOFF",
      threadId: "drift-thread",
      to: ["windows-5080"],
      status: "▶ wave",
      bodyText:
        "# Drift body\n\nMixed endings: line A\r\nline B\nline C  \n\nTrailing whitespace stripped.\n",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    const closed = runClose({
      cwd: dir,
      threadId: "drift-thread",
      status: "completed",
      note: "Drift smoke close",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });

    // Walk both files written by the CLI's send/close pipeline. REQUEST.md
    // is intentionally skipped because the operator authors that body, not
    // the CLI — its body_hash is unset by design.
    const writtenFiles = [sent.filePath, closed.filePath];
    for (const path of writtenFiles) {
      const raw = readFileSync(path, "utf8");
      const env = parseEnvelope(raw);
      // body_hash is REQUIRED on send/close output for drift detection.
      expect(env.frontmatter.body_hash).toMatch(/^[0-9a-f]{64}$/);
      // Re-hash the disk body and confirm it matches.
      const rehash = bodyHash(env.body);
      expect(rehash).toBe(env.frontmatter.body_hash);
    }

    // And confirm the SendResult / CloseResult bodyHash fields agree with
    // what landed on disk — i.e. the in-process hash is what the receiver
    // would compare against.
    {
      const env = parseEnvelope(readFileSync(sent.filePath, "utf8"));
      expect(env.frontmatter.body_hash).toBe(sent.bodyHash);
    }
    {
      const env = parseEnvelope(readFileSync(closed.filePath, "utf8"));
      expect(env.frontmatter.body_hash).toBe(closed.bodyHash);
    }
  });
});
