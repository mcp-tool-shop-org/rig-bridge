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
