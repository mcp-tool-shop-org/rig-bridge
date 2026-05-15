import { describe, it, expect } from "vitest";
import { validateRigId, assertRigId } from "./rig-id.js";

describe("validateRigId", () => {
  it("accepts canonical founding rigs", () => {
    expect(validateRigId("mac-m5max")).toEqual({ ok: true });
    expect(validateRigId("windows-5080")).toEqual({ ok: true });
    expect(validateRigId("mike-relay")).toEqual({ ok: true });
  });

  it("accepts a single-letter slug (boundary)", () => {
    expect(validateRigId("a")).toEqual({ ok: true });
  });

  it("rejects an empty string", () => {
    const r = validateRigId("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/empty/);
  });

  it("rejects a leading digit", () => {
    const r = validateRigId("5080-windows");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/start with a letter/);
  });

  it("rejects uppercase characters", () => {
    const r = validateRigId("Mac-Claude");
    expect(r.ok).toBe(false);
  });

  it("rejects whitespace", () => {
    expect(validateRigId("mac claude").ok).toBe(false);
    expect(validateRigId(" mac").ok).toBe(false);
  });

  it("rejects underscores and other punctuation", () => {
    expect(validateRigId("mac_m5max").ok).toBe(false);
    expect(validateRigId("mac.m5max").ok).toBe(false);
    expect(validateRigId("mac/m5max").ok).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(validateRigId(undefined as unknown).ok).toBe(false);
    expect(validateRigId(123 as unknown).ok).toBe(false);
    expect(validateRigId(null as unknown).ok).toBe(false);
  });

  it("assertRigId throws on invalid", () => {
    expect(() => assertRigId("Mac")).toThrow(/Mac/);
    expect(assertRigId("mac-m5max")).toBe("mac-m5max");
  });
});

// F-TST-017: edge-case shapes around the canonical kebab-case rig-id
// pattern (`/^[a-z][a-z0-9-]*$/`). The pattern is intentionally permissive
// inside the [a-z0-9-] class — these tests pin the actual surface so any
// future tightening is intentional, not accidental.
describe("validateRigId — edge cases (F-TST-017)", () => {
  it("accepts consecutive hyphens (the pattern does not collapse them)", () => {
    // The regex character class allows `-` anywhere after position 0, so
    // "mac--m5max" is a valid id today. If this is judged confusing later,
    // tighten the pattern; this test will then surface the change.
    expect(validateRigId("mac--m5max")).toEqual({ ok: true });
    expect(validateRigId("mac---m5max")).toEqual({ ok: true });
  });

  it("accepts a trailing hyphen (no anchored last-char rule)", () => {
    // Distinct from the thread-id pattern which requires alphanumeric at
    // both ends. The rig-id pattern does not — pin this asymmetry so it's
    // visible to any future audit.
    expect(validateRigId("mac-")).toEqual({ ok: true });
    expect(validateRigId("mac--")).toEqual({ ok: true });
  });

  it("accepts very long IDs (no documented maxLength) — 1000 chars", () => {
    // No maxLength is enforced anywhere in the rig-id pipeline today. If
    // we later add one (filesystem path limits, schema length cap, etc.)
    // this test will surface the change.
    const longId = "a" + "a".repeat(999);
    expect(longId.length).toBe(1000);
    expect(validateRigId(longId)).toEqual({ ok: true });
  });

  it("accepts a 10_000-char ID (pin no-cap behavior)", () => {
    const massive = "a" + "b".repeat(9999);
    expect(validateRigId(massive)).toEqual({ ok: true });
  });

  it("rejects Cyrillic 'а' (U+0430) that visually matches Latin 'a'", () => {
    // Homoglyph attack surface: the regex anchors on ASCII [a-z]; any
    // non-ASCII lookalike fails. Pin this — the wire MUST NOT carry
    // homoglyph-confused rig identifiers.
    const cyrillic = "а"; // U+0430, visually identical to "a"
    const r = validateRigId(cyrillic);
    expect(r.ok).toBe(false);
  });

  it("rejects Cyrillic-prefixed kebab-case lookalike", () => {
    const cyrillicPrefixed = "аmac-m5max"; // first 'а' is Cyrillic
    expect(validateRigId(cyrillicPrefixed).ok).toBe(false);
  });

  it("rejects 'café' (Unicode é in either composed or decomposed form)", () => {
    expect(validateRigId("café").ok).toBe(false); // NFC composed
    expect(validateRigId("café").ok).toBe(false); // NFD decomposed
  });

  it("rejects a lone hyphen", () => {
    expect(validateRigId("-").ok).toBe(false);
  });

  it("rejects a string of hyphens", () => {
    expect(validateRigId("----").ok).toBe(false);
  });
});
