import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runInit } from "./init.js";
import { runNew } from "./new.js";
import { runSend, _internal as _sendInternal } from "./send.js";
import { bodyHash } from "../engine/body-hash.js";

let dir: string;

// B-TST-001 (Stage C wave 1): surface teardown failures and tolerate
// transient Windows file-locks via maxRetries.
function cleanupTempDir(p: string): void {
  try {
    rmSync(p, { recursive: true, force: true, maxRetries: 3 });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("temp cleanup failed for", p, e);
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rig-bridge-send-"));
  spawnSync("git", ["init", "-b", "main", dir], { encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "t@x"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "T"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir, encoding: "utf8" });
  runInit({ cwd: dir, rigId: "mac-m5max", displayName: "Mac Claude", stdout: () => {} });
  runNew({ cwd: dir, threadId: "thread-1", stdout: () => {} });
  return () => cleanupTempDir(dir);
});

describe("runSend", () => {
  it("writes a HANDOFF, computes body_hash, derives statusClass, commits", () => {
    const r = runSend({
      cwd: dir,
      type: "HANDOFF",
      threadId: "thread-1",
      to: ["windows-5080"],
      status: "▶ Phase 6 wave 1 ready",
      bodyText: "# wave 1\n\nDispatching backend agent.\n\nStanding by.\n",
      tldr: "wave 1 dispatch",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    expect(r.filename).toBe("HANDOFF.md");
    expect(r.statusClass).toBe("active");
    expect(r.bodyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.commitSha).toMatch(/^[0-9a-f]{40}$/);
    const text = readFileSync(r.filePath, "utf8");
    expect(text).toContain("from: mac-m5max");
    expect(text).toContain("to: windows-5080");
    expect(text).toContain("type: HANDOFF");
    // G-001: body_hash MUST be in the envelope frontmatter (not just SendResult).
    // Receiving rigs re-hash and compare against this field to detect drift.
    expect(text).toContain(`body_hash: ${r.bodyHash}`);
  });

  // G-001 (dogfood-friction.md): cross-rig drift detection requires body_hash
  // be persisted in the envelope. Round-trip test: parse the written file,
  // re-hash the body per §4.1 normalization, confirm it matches the stored
  // body_hash. This is the test the dogfood pipe was supposed to enable.
  it("body_hash in frontmatter round-trips against re-computation", async () => {
    const { parseEnvelope } = await import("../engine/envelope.js");
    const { bodyHash } = await import("../engine/body-hash.js");
    const r = runSend({
      cwd: dir,
      type: "STATE",
      threadId: "thread-1",
      to: ["windows-5080"],
      status: "✅ State snapshot",
      bodyText: "# State\n\nMixed line endings: line A\r\nline B\r\nline C  \n",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    const text = readFileSync(r.filePath, "utf8");
    const parsed = parseEnvelope(text);
    expect(parsed.frontmatter.body_hash).toBe(r.bodyHash);
    expect(bodyHash(parsed.body)).toBe(parsed.frontmatter.body_hash);
  });

  it("bumps the ordinal when the bare filename already exists", () => {
    const a = runSend({
      cwd: dir,
      type: "RESPONSE",
      threadId: "thread-1",
      to: ["windows-5080"],
      bodyText: "first\n",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    const b = runSend({
      cwd: dir,
      type: "RESPONSE",
      threadId: "thread-1",
      to: ["windows-5080"],
      bodyText: "second\n",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    expect(a.filename).toBe("RESPONSE.md");
    expect(b.filename).toBe("RESPONSE-2.md");
  });

  it("rejects an unknown message type", () => {
    expect(() =>
      runSend({
        cwd: dir,
        type: "GREETINGS",
        threadId: "thread-1",
        to: ["windows-5080"],
        noPush: true,
        stdout: () => {},
        stderr: () => {},
      }),
    ).toThrow(/unknown message type/);
  });

  it("rejects a --to with an invalid rig id (ingress validation)", () => {
    // B-ENG-003 (parallel Commands wave): send.ts now case-normalizes --to
    // ids at ingress (trim + lowercase), so "WINDOWS-5080" → "windows-5080"
    // which is valid. The test fixture must use an input that remains
    // invalid AFTER normalization to still exercise the validator-rejection
    // branch. "Bad ID!" → "bad id!" still has a space + "!" so the rig-id
    // pattern rejects it.
    expect(() =>
      runSend({
        cwd: dir,
        type: "HANDOFF",
        threadId: "thread-1",
        to: ["Bad ID!"],
        noPush: true,
        stdout: () => {},
        stderr: () => {},
      }),
    ).toThrow(/--to/);
  });

  it("rejects a status with no recognized marker", () => {
    expect(() =>
      runSend({
        cwd: dir,
        type: "HANDOFF",
        threadId: "thread-1",
        to: ["windows-5080"],
        status: "active phase 0",
        noPush: true,
        stdout: () => {},
        stderr: () => {},
      }),
    ).toThrow(/marker/);
  });

  it("accepts comma-separated and repeated --to flags", () => {
    const r = runSend({
      cwd: dir,
      type: "HANDOFF",
      threadId: "thread-1",
      to: ["windows-5080,mike-relay"],
      bodyText: "multi\n",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    const text = readFileSync(r.filePath, "utf8");
    expect(text).toContain("- windows-5080");
    expect(text).toContain("- mike-relay");
  });

  it("warns on stderr when tldr exceeds 280 chars (decision #1)", () => {
    const errs: string[] = [];
    runSend({
      cwd: dir,
      type: "HANDOFF",
      threadId: "thread-1",
      to: ["windows-5080"],
      bodyText: "x\n",
      tldr: "x".repeat(281),
      noPush: true,
      stdout: () => {},
      stderr: (s) => errs.push(s),
    });
    expect(errs.join("")).toMatch(/tldr is 281/);
  });

  it("errors when the thread directory does not exist", () => {
    expect(() =>
      runSend({
        cwd: dir,
        type: "HANDOFF",
        threadId: "no-such-thread",
        to: ["windows-5080"],
        noPush: true,
        stdout: () => {},
        stderr: () => {},
      }),
    ).toThrow(/thread directory not found/);
  });

  it("loads body from --body-file when provided", () => {
    const bf = join(dir, "scratch-body.md");
    writeFileSync(bf, "loaded from file\n", "utf8");
    const r = runSend({
      cwd: dir,
      type: "HANDOFF",
      threadId: "thread-1",
      to: ["windows-5080"],
      bodyFile: bf,
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    const text = readFileSync(r.filePath, "utf8");
    expect(text).toContain("loaded from file");
    expect(existsSync(bf)).toBe(true);
  });

  // F-TST-002 (CRITICAL by audit-agent): cross-rig CRLF-vs-LF determinism.
  // Mac and 5080 hit `core.autocrlf` drift on round-trip; per §4.1 rule 1
  // both forms must collapse to the same hash. This is the bedrock of
  // cross-rig drift detection — if it fails, every cross-rig send is a
  // false-positive drift event.
  it("F-TST-002: CRLF and LF renderings of the same body hash identically", () => {
    const crlfBody = "line A\r\nline B\r\nline C\r\n";
    const lfBody = "line A\nline B\nline C\n";
    const hCrlf = bodyHash(crlfBody);
    const hLf = bodyHash(lfBody);
    expect(hCrlf).toBe(hLf);
    expect(hCrlf).toMatch(/^[0-9a-f]{64}$/);

    // And drive both through runSend on distinct ordinals so we also prove
    // the *persisted* body_hash matches between the two renderings.
    const a = runSend({
      cwd: dir,
      type: "STATE",
      threadId: "thread-1",
      to: ["windows-5080"],
      bodyText: crlfBody,
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    const b = runSend({
      cwd: dir,
      type: "STATE",
      threadId: "thread-1",
      to: ["windows-5080"],
      bodyText: lfBody,
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    expect(a.bodyHash).toBe(b.bodyHash);
  });

  // F-TST-020: real mixed line endings (CRLF + LF + trailing spaces) on a
  // single body must yield the same hash as the fully-LF-normalized form.
  // This exercises rules 1+2 together — `core.autocrlf` can produce mixed
  // endings on a single editor save when sections are inserted from
  // different sources, and trailing whitespace drift is editor-default.
  it("F-TST-020: mixed line endings + trailing whitespace collapse to canonical hash", () => {
    const mixed = "line A\r\nline B\nline C  \n";
    const canonical = "line A\nline B\nline C\n";
    expect(bodyHash(mixed)).toBe(bodyHash(canonical));

    const r = runSend({
      cwd: dir,
      type: "RESPONSE",
      threadId: "thread-1",
      to: ["windows-5080"],
      bodyText: mixed,
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    expect(r.bodyHash).toBe(bodyHash(canonical));
    // And the persisted envelope's body_hash matches too.
    const text = readFileSync(r.filePath, "utf8");
    expect(text).toContain(`body_hash: ${bodyHash(canonical)}`);
  });

  // F-TST-006: ordinal exhaustion at the 1000-cap. send.ts caps at n < 1000
  // and throws "exhausted ordinal range". Rather than create 999 files on
  // disk (slow + flaky), exercise the internal chooseFilename helper with a
  // pre-seeded thread dir. We seed RESPONSE.md + RESPONSE-2..RESPONSE-999.md
  // and then assert chooseFilename throws.
  it("F-TST-006: chooseFilename throws on exhausted ordinal range", () => {
    const threadDir = join(dir, "thread-1");
    // Seed bare + 2..999.
    writeFileSync(join(threadDir, "RESPONSE.md"), "stub\n", "utf8");
    for (let n = 2; n < 1000; n++) {
      writeFileSync(join(threadDir, `RESPONSE-${n}.md`), "stub\n", "utf8");
    }
    expect(() =>
      _sendInternal.chooseFilename(threadDir, "RESPONSE"),
    ).toThrow(/exhausted ordinal range/);
  });
});
