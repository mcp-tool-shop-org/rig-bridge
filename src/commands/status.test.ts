// Tests for `rig-bridge status` (Phase 7 Wave 2B).
//
// Locks under test:
//   * L10 — 4-5 column default; recency-desc sort; color reserved for state.
//   * L11 — `--wide` adds FROM, TO, body_hash-ish second tier.
//   * L14 — stdout = data; stderr = narrative.
//   * L15 — `--json` opt-in; schema_version "1.0" present.

import { describe, it, expect, beforeEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runInit } from "./init.js";
import { runNew } from "./new.js";
import { runSend } from "./send.js";
import { runClose } from "./close.js";
import { runStatus } from "./status.js";

let dir: string;

// B-TST-001: tolerate transient Windows file-locks via maxRetries.
function cleanupTempDir(p: string): void {
  try {
    rmSync(p, { recursive: true, force: true, maxRetries: 3 });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("temp cleanup failed for", p, e);
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rig-bridge-status-"));
  spawnSync("git", ["init", "-b", "main", dir], { encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "t@x"], {
    cwd: dir,
    encoding: "utf8",
  });
  spawnSync("git", ["config", "user.name", "T"], {
    cwd: dir,
    encoding: "utf8",
  });
  spawnSync("git", ["config", "commit.gpgsign", "false"], {
    cwd: dir,
    encoding: "utf8",
  });
  runInit({
    cwd: dir,
    rigId: "mac-m5max",
    displayName: "Mac Claude",
    stdout: () => {},
    stderr: () => {},
  });
  return () => cleanupTempDir(dir);
});

// Helper — make a thread with a REQUEST envelope ready.
function newThread(threadId: string): void {
  runNew({
    cwd: dir,
    threadId,
    stdout: () => {},
    stderr: () => {},
  });
}

// Helper — send a HANDOFF in an existing thread (no push so the test
// doesn't need a remote).
function sendHandoff(threadId: string, body = "stub body\n"): void {
  runSend({
    cwd: dir,
    type: "HANDOFF",
    threadId,
    to: ["windows-5080"],
    status: "▶ HANDOFF active",
    bodyText: body,
    noPush: true,
    stdout: () => {},
    stderr: () => {},
  });
}

// Helper — close a thread (RESOLUTION.md present makes is_closed=true).
function closeThread(
  threadId: string,
  status: "completed" | "cancelled" = "completed",
): void {
  runClose({
    cwd: dir,
    threadId,
    status,
    noPush: true,
    stdout: () => {},
    stderr: () => {},
  });
}

describe("runStatus — empty bridge", () => {
  it("returns empty thread list and emits a clean header line", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const r = await runStatus({
      cwd: dir,
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    });
    expect(r.threads).toEqual([]);
    // A freshly-init'd bridge has .bridge/ untracked (that's the config
    // dir); the dirty list may or may not be empty depending on whether
    // .gitignore covers it. We assert structure not exact equality.
    expect(Array.isArray(r.dirty_files)).toBe(true);
    expect(r.unpushed_commits).toEqual([]);
    const joined = out.join("");
    expect(joined).toMatch(/^rig-bridge: status open=0 closed=0/);
    // L14: helpful narrative goes to stderr.
    expect(err.join("")).toContain("no threads found");
  });

  it("emits a valid JSON object in --json mode", async () => {
    const out: string[] = [];
    await runStatus({
      cwd: dir,
      json: true,
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    const payload = JSON.parse(out.join(""));
    expect(payload.schema_version).toBe("1.0");
    expect(Array.isArray(payload.threads)).toBe(true);
    expect(payload.threads.length).toBe(0);
    expect(Array.isArray(payload.dirty_files)).toBe(true);
    expect(Array.isArray(payload.unpushed_commits)).toBe(true);
  });
});

describe("runStatus — populated bridge", () => {
  beforeEach(() => {
    // Three threads with different status classes.
    newThread("alpha-thread"); // REQUEST = active
    sendHandoff("alpha-thread", "alpha body\n"); // active

    newThread("beta-thread");
    sendHandoff("beta-thread", "beta body\n");
    closeThread("beta-thread", "completed"); // completed (closed)

    newThread("gamma-thread"); // active only
  });

  it("sorts threads by recency desc (latest first)", async () => {
    const out: string[] = [];
    const r = await runStatus({
      cwd: dir,
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    expect(r.threads.length).toBeGreaterThanOrEqual(3);
    // Sort verification: each entry's last_modified must be >= the next.
    for (let i = 1; i < r.threads.length; i++) {
      const a = r.threads[i - 1].last_modified.getTime();
      const b = r.threads[i].last_modified.getTime();
      expect(a).toBeGreaterThanOrEqual(b);
    }
  });

  it("emits a header line then one key=value row per thread", async () => {
    const out: string[] = [];
    await runStatus({
      cwd: dir,
      noColor: true,
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    const lines = out.join("").split("\n").filter((l) => l.length > 0);
    // Header + 3 thread rows minimum.
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines[0]).toMatch(/^rig-bridge: status open=/);
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]).toMatch(/^thread=/);
      expect(lines[i]).toMatch(/last=/);
      expect(lines[i]).toMatch(/status=/);
      expect(lines[i]).toMatch(/type=/);
      expect(lines[i]).toMatch(/dirty=/);
    }
  });

  it("reflects is_closed in the JSON output for closed threads", async () => {
    const out: string[] = [];
    await runStatus({
      cwd: dir,
      json: true,
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    const payload = JSON.parse(out.join(""));
    const beta = payload.threads.find(
      (t: { thread_id: string }) => t.thread_id === "beta-thread",
    );
    expect(beta).toBeDefined();
    expect(beta.is_closed).toBe(true);
    expect(beta.status_class).toBe("completed");
  });

  it("`--wide` adds from / to / closed / envelopes columns", async () => {
    const out: string[] = [];
    await runStatus({
      cwd: dir,
      wide: true,
      noColor: true,
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    const joined = out.join("");
    expect(joined).toMatch(/from=mac-m5max/);
    expect(joined).toMatch(/to=windows-5080/);
    expect(joined).toMatch(/envelopes=\d+/);
    expect(joined).toMatch(/closed=(true|false)/);
  });

  it("default mode does NOT include from/to/envelopes columns", async () => {
    const out: string[] = [];
    await runStatus({
      cwd: dir,
      noColor: true,
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    const joined = out.join("");
    expect(joined).not.toMatch(/^from=/m);
    // The data rows must not embed the wide columns.
    const dataLines = joined.split("\n").filter((l) => l.startsWith("thread="));
    for (const l of dataLines) {
      expect(l).not.toMatch(/\bfrom=/);
      expect(l).not.toMatch(/\bto=/);
      expect(l).not.toMatch(/\benvelopes=/);
    }
  });

  it("emits valid JSON with schema_version 1.0", async () => {
    const out: string[] = [];
    await runStatus({
      cwd: dir,
      json: true,
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    const payload = JSON.parse(out.join(""));
    expect(payload.schema_version).toBe("1.0");
    expect(payload.threads.length).toBeGreaterThanOrEqual(3);
    for (const t of payload.threads) {
      expect(typeof t.thread_id).toBe("string");
      expect(typeof t.envelope_count).toBe("number");
      expect(typeof t.is_closed).toBe("boolean");
      expect(typeof t.status_class).toBe("string");
      expect(typeof t.last_modified).toBe("string");
      expect(t.latest_envelope).toBeDefined();
    }
  });
});

describe("runStatus — dirty + color discipline", () => {
  it("detects dirty files via git status --porcelain", async () => {
    newThread("ddt-thread");
    sendHandoff("ddt-thread", "clean body\n");
    // Now make the working tree dirty by writing an unrelated untracked file.
    writeFileSync(join(dir, "ddt-thread", "scratch.txt"), "dirty\n", "utf8");
    const out: string[] = [];
    const r = await runStatus({
      cwd: dir,
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    expect(r.dirty_files.length).toBeGreaterThan(0);
    // Header reflects the dirty count.
    expect(out.join("")).toMatch(/dirty=[1-9]\d*/);
  });

  it("suppresses color when --no-color is set", async () => {
    newThread("nc-thread");
    sendHandoff("nc-thread", "body\n");
    const out: string[] = [];
    await runStatus({
      cwd: dir,
      noColor: true,
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    // ANSI escape `[` should not appear when color is suppressed.
    // We check the raw escape character.
    expect(out.join("")).not.toMatch(/\[/);
  });

  it("suppresses color when NO_COLOR env is set (presence-only check)", async () => {
    newThread("env-thread");
    sendHandoff("env-thread", "body\n");
    const prev = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
    try {
      const out: string[] = [];
      await runStatus({
        cwd: dir,
        stdout: (s) => out.push(s),
        stderr: () => {},
      });
      expect(out.join("")).not.toMatch(/\[/);
    } finally {
      if (prev === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = prev;
      }
    }
  });

  it("suppresses color in --json mode regardless of TTY", async () => {
    newThread("jc-thread");
    sendHandoff("jc-thread", "body\n");
    const out: string[] = [];
    await runStatus({
      cwd: dir,
      json: true,
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    // JSON output is plain — no ANSI codes ever.
    expect(out.join("")).not.toMatch(/\[/);
    // And the output parses as valid JSON.
    expect(() => JSON.parse(out.join(""))).not.toThrow();
  });

  it("suppresses color when stdout is not a TTY (default test env)", async () => {
    // process.stdout.isTTY is undefined in vitest by default, so color
    // gate must already evaluate to false here.
    newThread("notty-thread");
    sendHandoff("notty-thread", "body\n");
    const out: string[] = [];
    await runStatus({
      cwd: dir,
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    expect(out.join("")).not.toMatch(/\[/);
  });
});
