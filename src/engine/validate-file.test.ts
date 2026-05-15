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
import { validateEnvelopeFile } from "./validate-file.js";

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
  root = mkdtempSync(join(tmpdir(), "rig-bridge-validate-"));
  return () => cleanupTempDir(root);
});

function writeValidEnvelope(filename: string, overrides: Record<string, unknown> = {}, body = "Standing by.\n"): string {
  const hash = bodyHash(body);
  const fm: Record<string, unknown> = {
    from: "mac-m5max",
    to: "windows-5080",
    date: "2026-05-15",
    status: "▶ ready",
    type: "REQUEST",
    thread: "thread-valid",
    body_hash: hash,
    ...overrides,
  };
  const text = renderEnvelope({ frontmatter: fm, body });
  const p = join(root, filename);
  writeFileSync(p, text, "utf8");
  return p;
}

describe("validateEnvelopeFile — happy path", () => {
  it("returns valid=true with no errors or warnings on a canonical envelope", () => {
    const p = writeValidEnvelope("REQUEST.md");
    const r = validateEnvelopeFile(p);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.envelope?.frontmatter.from).toBe("mac-m5max");
    expect(r.envelope?.body).toMatch(/Standing by\./);
  });

  it("returns valid=true for a multi-recipient envelope (array `to`)", () => {
    const p = writeValidEnvelope("REQUEST.md", {
      to: ["windows-5080", "mike-relay"],
    });
    const r = validateEnvelopeFile(p);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("preserves the parsed envelope on the report (for downstream rendering)", () => {
    const p = writeValidEnvelope("REQUEST.md");
    const r = validateEnvelopeFile(p);
    expect(r.envelope).toBeDefined();
    expect(r.envelope?.frontmatter.thread).toBe("thread-valid");
  });
});

describe("validateEnvelopeFile — parse failures", () => {
  it("surfaces a parse_failed error and stops further checks", () => {
    const p = join(root, "broken.md");
    writeFileSync(p, "this is not an envelope\n", "utf8");
    const r = validateEnvelopeFile(p);
    expect(r.valid).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].kind).toBe("parse_failed");
    // The other checks were skipped (we don't see schema_invalid here).
    const kinds = r.errors.map((e) => e.kind);
    expect(kinds).not.toContain("schema_invalid");
    expect(r.envelope).toBeUndefined();
  });

  it("surfaces a parse_failed error when frontmatter has no closing fence", () => {
    const p = join(root, "no-fence.md");
    writeFileSync(p, "---\nfrom: mac-m5max\n", "utf8");
    const r = validateEnvelopeFile(p);
    expect(r.valid).toBe(false);
    expect(r.errors[0].kind).toBe("parse_failed");
  });
});

describe("validateEnvelopeFile — schema failures", () => {
  it("surfaces a schema_invalid error when a required field is missing", () => {
    // Render a file with no `thread`. parseEnvelope will succeed (the
    // YAML is structurally valid) but the schema rejects it.
    const fm = {
      from: "mac-m5max",
      to: "windows-5080",
      date: "2026-05-15",
      status: "▶ ready",
      type: "REQUEST",
      // thread missing
    };
    const text = renderEnvelope({ frontmatter: fm, body: "body\n" });
    const p = join(root, "missing-thread.md");
    writeFileSync(p, text, "utf8");
    const r = validateEnvelopeFile(p);
    expect(r.valid).toBe(false);
    const schemaErrs = r.errors.filter((e) => e.kind === "schema_invalid");
    expect(schemaErrs).toHaveLength(1);
    expect(JSON.stringify(schemaErrs[0])).toMatch(/thread/);
  });

  it("surfaces multiple schema errors in a single report (allErrors: true)", () => {
    // Missing both `thread` AND `type`.
    const fm = {
      from: "mac-m5max",
      to: "windows-5080",
      date: "2026-05-15",
      status: "▶ ready",
      // type + thread both missing
    };
    const text = renderEnvelope({ frontmatter: fm, body: "body\n" });
    const p = join(root, "multi-missing.md");
    writeFileSync(p, text, "utf8");
    const r = validateEnvelopeFile(p);
    expect(r.valid).toBe(false);
    const schemaErr = r.errors.find((e) => e.kind === "schema_invalid");
    expect(schemaErr).toBeDefined();
    if (schemaErr && schemaErr.kind === "schema_invalid") {
      // Both missing-property errors surface.
      expect(schemaErr.errors.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("validateEnvelopeFile — body_hash checks", () => {
  it("surfaces a body_hash_mismatch error when the body has been edited", () => {
    const correctBody = "original\n";
    const correctHash = bodyHash(correctBody);
    const text = renderEnvelope({
      frontmatter: {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ drift",
        type: "STATE",
        thread: "thread-drift",
        body_hash: correctHash,
      },
      body: "tampered\n",
    });
    const p = join(root, "drift.md");
    writeFileSync(p, text, "utf8");
    const r = validateEnvelopeFile(p);
    expect(r.valid).toBe(false);
    const mismatch = r.errors.find((e) => e.kind === "body_hash_mismatch");
    expect(mismatch).toBeDefined();
    if (mismatch && mismatch.kind === "body_hash_mismatch") {
      expect(mismatch.expected).toBe(correctHash);
      expect(mismatch.actual).toBe(bodyHash("tampered\n"));
    }
  });

  it("surfaces a body_hash_absent warning (NOT an error) when body_hash is missing", () => {
    const fm = {
      from: "mac-m5max",
      to: "windows-5080",
      date: "2026-05-15",
      status: "▶ no-hash",
      type: "STATE",
      thread: "thread-no-hash",
      // body_hash omitted — schema allows it (it's optional)
    };
    const text = renderEnvelope({ frontmatter: fm, body: "x\n" });
    const p = join(root, "no-hash.md");
    writeFileSync(p, text, "utf8");
    const r = validateEnvelopeFile(p);
    expect(r.valid).toBe(true); // missing body_hash is a warning, not an error
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].kind).toBe("body_hash_absent");
  });
});

describe("validateEnvelopeFile — rig-id validation", () => {
  it("surfaces rig_id_invalid when `from` is non-canonical", () => {
    // YAML literal `BAD ID` is parsed as a 6-char string; schema
    // (pattern ^[a-z][a-z0-9-]*$) would also reject. validateRigId
    // also rejects. Both surface.
    const yaml = [
      "from: BAD-ID",
      "to: windows-5080",
      "date: 2026-05-15",
      "status: '▶ bad'",
      "type: STATE",
      "thread: thread-bad",
    ].join("\n");
    const text = `---\n${yaml}\n---\n\nbody\n`;
    const p = join(root, "bad-from.md");
    writeFileSync(p, text, "utf8");
    const r = validateEnvelopeFile(p);
    expect(r.valid).toBe(false);
    const rigErr = r.errors.find((e) => e.kind === "rig_id_invalid");
    expect(rigErr).toBeDefined();
    if (rigErr && rigErr.kind === "rig_id_invalid") {
      expect(rigErr.field).toBe("from");
      expect(rigErr.value).toBe("BAD-ID");
      expect(rigErr.suggestion).toBe("bad-id");
    }
  });

  it("surfaces rig_id_invalid for each bad `to` recipient in an array", () => {
    const yaml = [
      "from: mac-m5max",
      "to:",
      "  - windows-5080",
      "  - BAD",
      "  - alsoBAD",
      "date: 2026-05-15",
      "status: '▶ multi-bad'",
      "type: STATE",
      "thread: thread-multi-bad",
    ].join("\n");
    const text = `---\n${yaml}\n---\n\nbody\n`;
    const p = join(root, "multi-bad-to.md");
    writeFileSync(p, text, "utf8");
    const r = validateEnvelopeFile(p);
    expect(r.valid).toBe(false);
    const rigErrs = r.errors.filter((e) => e.kind === "rig_id_invalid");
    expect(rigErrs).toHaveLength(2);
    const values = rigErrs.map((e) => (e as { value: string }).value).sort();
    expect(values).toEqual(["BAD", "alsoBAD"]);
  });

  it("returns valid=true with no rig-id errors for canonical recipients", () => {
    const p = writeValidEnvelope("ok.md");
    const r = validateEnvelopeFile(p);
    const rigErrs = r.errors.filter((e) => e.kind === "rig_id_invalid");
    expect(rigErrs).toEqual([]);
  });
});

describe("validateEnvelopeFile — multi-error collection", () => {
  it("surfaces schema + body_hash + rig-id errors in a single report", () => {
    // An envelope that is broken on three axes simultaneously.
    // The wrong-hash value must START with a hex letter (not a digit)
    // so YAML keeps it as a string scalar — otherwise YAML coerces an
    // all-digits literal into a number, the body_hash typeof check
    // treats it as absent, and the helper emits a body_hash_absent
    // WARNING instead of a body_hash_mismatch ERROR. Real wire
    // envelopes always carry hex hashes (mixed letters + digits) so
    // this matches the real-world shape.
    const body = "real body\n";
    const wrongHash = "f".repeat(64);
    const yaml = [
      "from: BAD-FROM",
      "to: windows-5080",
      "date: 2026-05-15",
      "status: '▶ multi-error'",
      "type: GREETINGS", // not in enum
      "thread: thread-multi-error",
      `body_hash: ${wrongHash}`,
    ].join("\n");
    const text = `---\n${yaml}\n---\n\n${body}`;
    const p = join(root, "multi-error.md");
    writeFileSync(p, text, "utf8");
    const r = validateEnvelopeFile(p);
    expect(r.valid).toBe(false);
    const kinds = new Set(r.errors.map((e) => e.kind));
    expect(kinds.has("schema_invalid")).toBe(true);
    expect(kinds.has("body_hash_mismatch")).toBe(true);
    expect(kinds.has("rig_id_invalid")).toBe(true);
    // At least 3 errors collected — the helper does not stop at the
    // first failure.
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });

  it("treats a non-string body_hash (YAML-coerced number) as absent, emitting a warning not an error", () => {
    // YAML coerces all-digit literals into numbers. The helper's
    // typeof-string guard catches this and surfaces it as a
    // body_hash_absent warning, not a body_hash_mismatch error —
    // because there's no canonical 64-hex-char string to compare
    // against in the first place.
    const body = "x\n";
    const yaml = [
      "from: mac-m5max",
      "to: windows-5080",
      "date: 2026-05-15",
      "status: '▶ numeric-hash'",
      "type: STATE",
      "thread: thread-num",
      `body_hash: ${"0".repeat(64)}`,
    ].join("\n");
    const text = `---\n${yaml}\n---\n\n${body}`;
    const p = join(root, "numeric-hash.md");
    writeFileSync(p, text, "utf8");
    const r = validateEnvelopeFile(p);
    // body_hash schema rejection still surfaces (the helper does not
    // swallow it), but no body_hash_mismatch is emitted.
    const kinds = new Set(r.errors.map((e) => e.kind));
    expect(kinds.has("body_hash_mismatch")).toBe(false);
    expect(r.warnings.some((w) => w.kind === "body_hash_absent")).toBe(true);
  });
});

describe("validateEnvelopeFile — warnings", () => {
  it("surfaces tldr_too_long when tldr exceeds 280 chars", () => {
    const longTldr = "x".repeat(281);
    const p = writeValidEnvelope("long-tldr.md", { tldr: longTldr });
    const r = validateEnvelopeFile(p);
    expect(r.valid).toBe(true); // tldr length is a warning, not an error
    const w = r.warnings.find((x) => x.kind === "tldr_too_long");
    expect(w).toBeDefined();
    if (w && w.kind === "tldr_too_long") {
      expect(w.length).toBe(281);
      expect(w.cap).toBe(280);
    }
  });

  it("no tldr_too_long warning when tldr is exactly at the cap", () => {
    const exactTldr = "x".repeat(280);
    const p = writeValidEnvelope("exact-tldr.md", { tldr: exactTldr });
    const r = validateEnvelopeFile(p);
    expect(r.warnings.filter((w) => w.kind === "tldr_too_long")).toEqual([]);
  });
});
