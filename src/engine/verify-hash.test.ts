import { describe, it, expect, beforeEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bodyHash } from "./body-hash.js";
import { renderEnvelope } from "./envelope.js";
import { verifyHash } from "./verify-hash.js";

function cleanupTempDir(p: string): void {
  try {
    rmSync(p, { recursive: true, force: true, maxRetries: 3 });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("temp cleanup failed for", p, e);
  }
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rig-bridge-verify-"));
  return () => cleanupTempDir(root);
});

describe("verifyHash — happy path", () => {
  it("returns ok=true when frontmatter body_hash matches the body", () => {
    const body = "# Standing by.\n\nReady for handoff.\n";
    const hash = bodyHash(body);
    const text = renderEnvelope({
      frontmatter: {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ ready",
        type: "REQUEST",
        thread: "thread-verify",
        body_hash: hash,
      },
      body,
    });
    const p = join(root, "REQUEST.md");
    writeFileSync(p, text, "utf8");
    const r = verifyHash(p);
    expect(r.ok).toBe(true);
    expect(r.expected).toBe(hash);
    expect(r.actual).toBe(hash);
    expect(r.reason).toBeUndefined();
  });

  it("returns ok=true for an empty body (canonical hash of '\\n')", () => {
    const body = "";
    const hash = bodyHash(body);
    const text = renderEnvelope({
      frontmatter: {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ empty",
        type: "STATE",
        thread: "thread-empty",
        body_hash: hash,
      },
      body,
    });
    const p = join(root, "STATE.md");
    writeFileSync(p, text, "utf8");
    const r = verifyHash(p);
    expect(r.ok).toBe(true);
  });

  it("ok=true even when on-disk body has CRLF (§4.1 normalizes before hashing)", () => {
    const body = "line one\nline two\n";
    const hash = bodyHash(body);
    // Render with LF, then manually rewrite to CRLF to simulate a
    // round-trip through a Windows editor that mangled line endings.
    const text = renderEnvelope({
      frontmatter: {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ crlf",
        type: "STATE",
        thread: "thread-crlf",
        body_hash: hash,
      },
      body,
    });
    const crlf = text.replace(/\n/g, "\r\n");
    const p = join(root, "STATE.md");
    writeFileSync(p, crlf, "utf8");
    const r = verifyHash(p);
    expect(r.ok).toBe(true);
  });

  it("ok=true even when the body has trailing-whitespace drift", () => {
    const body = "hello world\n";
    const hash = bodyHash(body);
    // Insert trailing spaces — §4.1 normalization should strip them
    // before the hash check.
    const text = renderEnvelope({
      frontmatter: {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ trail",
        type: "STATE",
        thread: "thread-trail",
        body_hash: hash,
      },
      body: "hello world   \n",
    });
    const p = join(root, "STATE.md");
    writeFileSync(p, text, "utf8");
    const r = verifyHash(p);
    expect(r.ok).toBe(true);
  });
});

describe("verifyHash — failure paths", () => {
  it("returns ok=false with reason='no_body_hash_in_frontmatter' when the field is absent", () => {
    const body = "no hash\n";
    const text = renderEnvelope({
      frontmatter: {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ no-hash",
        type: "STATE",
        thread: "thread-no-hash",
        // body_hash deliberately omitted
      },
      body,
    });
    const p = join(root, "STATE.md");
    writeFileSync(p, text, "utf8");
    const r = verifyHash(p);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_body_hash_in_frontmatter");
    expect(r.expected).toBeNull();
    expect(r.actual).toBe(bodyHash(body));
  });

  it("returns ok=false with reason='body_hash_mismatch' when the body has been edited", () => {
    const originalBody = "original body\n";
    const hash = bodyHash(originalBody);
    // Render with the ORIGINAL hash, but write a DIFFERENT body.
    const text = renderEnvelope({
      frontmatter: {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ drift",
        type: "STATE",
        thread: "thread-drift",
        body_hash: hash,
      },
      body: "tampered body\n",
    });
    const p = join(root, "STATE.md");
    writeFileSync(p, text, "utf8");
    const r = verifyHash(p);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("body_hash_mismatch");
    expect(r.expected).toBe(hash);
    expect(r.actual).toBe(bodyHash("tampered body\n"));
    expect(r.expected).not.toBe(r.actual);
  });

  it("returns ok=false when body_hash is the empty string", () => {
    const body = "x\n";
    const text = renderEnvelope({
      frontmatter: {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ empty-hash",
        type: "STATE",
        thread: "thread-eh",
        body_hash: "",
      },
      body,
    });
    const p = join(root, "STATE.md");
    writeFileSync(p, text, "utf8");
    const r = verifyHash(p);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_body_hash_in_frontmatter");
  });

  it("returns ok=false when body_hash is a non-string (e.g. a number)", () => {
    // Schema would reject this on the wire, but the helper has to
    // handle on-disk drift defensively — treat anything non-string as
    // "absent."
    const body = "x\n";
    const yaml = [
      "from: mac-m5max",
      "to: windows-5080",
      "date: 2026-05-15",
      "status: '▶ numeric-hash'",
      "type: STATE",
      "thread: thread-num",
      "body_hash: 12345",
    ].join("\n");
    const text = `---\n${yaml}\n---\n\n${body}`;
    const p = join(root, "STATE.md");
    writeFileSync(p, text, "utf8");
    const r = verifyHash(p);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_body_hash_in_frontmatter");
  });

  it("returns a clean mismatch with both expected + actual populated", () => {
    // Pin the helper's contract: on a mismatch, the caller can render
    // both values for the operator to inspect.
    const body = "real body\n";
    const text = renderEnvelope({
      frontmatter: {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ mm",
        type: "STATE",
        thread: "thread-mm",
        body_hash: "f".repeat(64), // valid pattern, wrong value
      },
      body,
    });
    const p = join(root, "STATE.md");
    writeFileSync(p, text, "utf8");
    const r = verifyHash(p);
    expect(r.ok).toBe(false);
    expect(r.expected).toBe("f".repeat(64));
    expect(r.actual).toMatch(/^[0-9a-f]{64}$/);
    expect(r.actual).not.toBe("f".repeat(64));
  });
});

describe("verifyHash — error propagation", () => {
  it("throws when the file does not exist", () => {
    expect(() => verifyHash(join(root, "missing.md"))).toThrow();
  });

  it("throws an EnvelopeParseError-style failure when the file has no frontmatter", () => {
    const p = join(root, "not-an-envelope.md");
    writeFileSync(p, "just text, no frontmatter\n", "utf8");
    expect(() => verifyHash(p)).toThrow(/frontmatter/);
  });
});
