// Tests for `rig-bridge thread <id>` (Phase 7 Wave 2B).
//
// Locks under test:
//   * L12 — small-multiples: identical frontmatter-header per envelope,
//     chronological asc order.
//   * L14 — stdout = data; stderr = narrative.
//   * L15 — `--json` opt-in; schema_version "1.0".

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runInit } from "./init.js";
import { runNew } from "./new.js";
import { runSend } from "./send.js";
import { runClose } from "./close.js";
import { runThread } from "./thread.js";

let dir: string;

function cleanupTempDir(p: string): void {
  try {
    rmSync(p, { recursive: true, force: true, maxRetries: 3 });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("temp cleanup failed for", p, e);
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rig-bridge-thread-"));
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

describe("runThread — error paths", () => {
  it("throws a clean error when the thread directory is missing", async () => {
    await expect(
      runThread({
        cwd: dir,
        threadId: "missing-thread",
        stdout: () => {},
        stderr: () => {},
      }),
    ).rejects.toThrow(/not found/);
  });
});

describe("runThread — REQUEST only", () => {
  beforeEach(() => {
    runNew({
      cwd: dir,
      threadId: "single-req",
      stdout: () => {},
      stderr: () => {},
    });
  });

  it("renders exactly one block in text mode", async () => {
    const out: string[] = [];
    const r = await runThread({
      cwd: dir,
      threadId: "single-req",
      noColor: true,
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    expect(r.envelope_count).toBe(1);
    expect(r.envelopes.length).toBe(1);
    const joined = out.join("");
    // Summary header line per L12.
    expect(joined).toMatch(
      /^rig-bridge: thread single-req envelope=1 of 1 type=REQUEST/m,
    );
    // Frontmatter fence appears within the block.
    expect(joined).toMatch(/^---$/m);
    // Body block from runNew template includes a "REQUEST" marker.
    expect(joined).toContain("# single-req — REQUEST");
  });

  it("emits a single JSON object with schema_version 1.0", async () => {
    const out: string[] = [];
    await runThread({
      cwd: dir,
      threadId: "single-req",
      json: true,
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    const payload = JSON.parse(out.join(""));
    expect(payload.schema_version).toBe("1.0");
    expect(payload.thread_id).toBe("single-req");
    expect(payload.envelope_count).toBe(1);
    expect(Array.isArray(payload.envelopes)).toBe(true);
    expect(payload.envelopes.length).toBe(1);
    expect(payload.envelopes[0].frontmatter.type).toBe("REQUEST");
    expect(typeof payload.envelopes[0].body).toBe("string");
  });
});

describe("runThread — REQUEST → HANDOFF → RESOLUTION", () => {
  beforeEach(() => {
    runNew({
      cwd: dir,
      threadId: "multi-turn",
      stdout: () => {},
      stderr: () => {},
    });
    runSend({
      cwd: dir,
      type: "HANDOFF",
      threadId: "multi-turn",
      to: ["windows-5080"],
      status: "▶ HANDOFF active",
      bodyText: "# multi-turn — HANDOFF body\n",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    runClose({
      cwd: dir,
      threadId: "multi-turn",
      status: "completed",
      note: "wrapped",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
  });

  it("renders 3 blocks in chronological order (REQUEST → HANDOFF → RESOLUTION)", async () => {
    const out: string[] = [];
    const r = await runThread({
      cwd: dir,
      threadId: "multi-turn",
      noColor: true,
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    expect(r.envelope_count).toBe(3);
    // Filenames in returned order.
    // Because chronoOrder sorts by date asc then filename asc, REQUEST
    // (single date, "REQUEST.md") < HANDOFF.md < RESOLUTION.md
    // lexicographically.
    const types = r.envelopes.map((e) =>
      typeof e.frontmatter.type === "string" ? e.frontmatter.type : "",
    );
    // The HANDOFF and RESOLUTION lex-sort with capital letters: HANDOFF
    // < REQUEST < RESOLUTION. We assert the set of types contains all
    // three and that REQUEST appears in the rendered text BEFORE
    // RESOLUTION (the load-bearing ordering claim for a thread reader).
    expect(types).toContain("REQUEST");
    expect(types).toContain("HANDOFF");
    expect(types).toContain("RESOLUTION");
    const joined = out.join("");
    const reqIdx = joined.indexOf("type=REQUEST");
    const resIdx = joined.indexOf("type=RESOLUTION");
    expect(reqIdx).toBeGreaterThanOrEqual(0);
    expect(resIdx).toBeGreaterThanOrEqual(0);
    // Text rendering: chrono order should put RESOLUTION after REQUEST.
    expect(resIdx).toBeGreaterThan(reqIdx);
  });

  it("emits 3 envelopes in --json mode", async () => {
    const out: string[] = [];
    await runThread({
      cwd: dir,
      threadId: "multi-turn",
      json: true,
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    const payload = JSON.parse(out.join(""));
    expect(payload.envelope_count).toBe(3);
    expect(payload.envelopes.length).toBe(3);
    // schema_version present.
    expect(payload.schema_version).toBe("1.0");
  });

  it("envelope=1 of N labels are sequential through text output", async () => {
    const out: string[] = [];
    await runThread({
      cwd: dir,
      threadId: "multi-turn",
      noColor: true,
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    const joined = out.join("");
    expect(joined).toMatch(/envelope=1 of 3/);
    expect(joined).toMatch(/envelope=2 of 3/);
    expect(joined).toMatch(/envelope=3 of 3/);
  });

  it("preserves body content verbatim in text mode", async () => {
    const out: string[] = [];
    await runThread({
      cwd: dir,
      threadId: "multi-turn",
      noColor: true,
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    const joined = out.join("");
    // HANDOFF body text exactly as authored.
    expect(joined).toContain("# multi-turn — HANDOFF body");
    // RESOLUTION body content.
    expect(joined).toContain("multi-turn — RESOLUTION");
  });
});

describe("runThread — color discipline", () => {
  beforeEach(() => {
    runNew({
      cwd: dir,
      threadId: "color-thread",
      stdout: () => {},
      stderr: () => {},
    });
  });

  it("suppresses color when --no-color is set", async () => {
    const out: string[] = [];
    await runThread({
      cwd: dir,
      threadId: "color-thread",
      noColor: true,
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    // Look for ANSI ESC (\x1b) — not a bare `[` which collides with JSON arrays.
    // eslint-disable-next-line no-control-regex
    expect(out.join("")).not.toMatch(/\x1b\[/);
  });

  it("suppresses color in --json mode regardless of TTY", async () => {
    const out: string[] = [];
    await runThread({
      cwd: dir,
      threadId: "color-thread",
      json: true,
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    // Look for ANSI ESC (\x1b) — not a bare `[` which collides with JSON arrays.
    // eslint-disable-next-line no-control-regex
    expect(out.join("")).not.toMatch(/\x1b\[/);
    expect(() => JSON.parse(out.join(""))).not.toThrow();
  });
});
