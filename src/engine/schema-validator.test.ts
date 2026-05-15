import { describe, it, expect } from "vitest";
import { validateFrontmatter } from "./schema-validator.js";

const VALID_MIN: Record<string, unknown> = {
  from: "mac-m5max",
  to: "windows-5080",
  date: "2026-04-29",
  status: "▶ Phase 6 begins",
  type: "REQUEST",
  thread: "swarm-rig-bridge-001",
};

describe("validateFrontmatter", () => {
  it("accepts a minimal valid envelope", () => {
    const r = validateFrontmatter(VALID_MIN);
    expect(r.valid).toBe(true);
  });

  it("accepts a multi-recipient envelope", () => {
    const r = validateFrontmatter({
      ...VALID_MIN,
      to: ["mac-m5max", "mike-relay"],
    });
    expect(r.valid).toBe(true);
  });

  it("accepts optional tldr + references + display_name", () => {
    const r = validateFrontmatter({
      ...VALID_MIN,
      tldr: "Phase 6 wave 1 dispatch",
      references: ["abc1234", "deadbeef"],
      display_name: "Mac Claude",
    });
    expect(r.valid).toBe(true);
  });

  it("rejects an envelope missing a required field", () => {
    const { thread, ...rest } = VALID_MIN;
    void thread;
    const r = validateFrontmatter(rest);
    expect(r.valid).toBe(false);
    expect(r.errorText).toMatch(/thread/);
  });

  it("rejects a from with uppercase", () => {
    const r = validateFrontmatter({ ...VALID_MIN, from: "Mac-M5max" });
    expect(r.valid).toBe(false);
  });

  it("rejects an unknown type", () => {
    const r = validateFrontmatter({ ...VALID_MIN, type: "GREETINGS" });
    expect(r.valid).toBe(false);
  });

  it("rejects status without a marker", () => {
    const r = validateFrontmatter({ ...VALID_MIN, status: "in progress" });
    expect(r.valid).toBe(false);
  });

  it("rejects unknown frontmatter keys (additionalProperties: false)", () => {
    const r = validateFrontmatter({ ...VALID_MIN, surprise: "🍰" });
    expect(r.valid).toBe(false);
  });
});

// F-TST-005: schema-validator failure cases. These pin the bouncer's
// behavior at the boundary between an envelope that round-trips cleanly
// and one that must be rejected before it's persisted or pushed.
describe("validateFrontmatter — failure-mode coverage (F-TST-005)", () => {
  it("rejects an invalid date with slashes (2026/05/15)", () => {
    const r = validateFrontmatter({ ...VALID_MIN, date: "2026/05/15" });
    expect(r.valid).toBe(false);
    expect(r.errorText).toMatch(/date/);
  });

  it("rejects an invalid date with two-digit year", () => {
    const r = validateFrontmatter({ ...VALID_MIN, date: "26-05-15" });
    expect(r.valid).toBe(false);
  });

  it("rejects a date that is just a year", () => {
    const r = validateFrontmatter({ ...VALID_MIN, date: "2026" });
    expect(r.valid).toBe(false);
  });

  it("rejects references entries with fewer than 7 hex chars", () => {
    const r = validateFrontmatter({
      ...VALID_MIN,
      references: ["abc12"],
    });
    expect(r.valid).toBe(false);
    expect(r.errorText).toMatch(/references/);
  });

  it("rejects references entries with more than 40 hex chars", () => {
    const tooLong = "a".repeat(41);
    const r = validateFrontmatter({
      ...VALID_MIN,
      references: [tooLong],
    });
    expect(r.valid).toBe(false);
    expect(r.errorText).toMatch(/references/);
  });

  it("rejects references entries with non-hex characters", () => {
    const r = validateFrontmatter({
      ...VALID_MIN,
      references: ["zzzz1234"],
    });
    expect(r.valid).toBe(false);
    expect(r.errorText).toMatch(/references/);
  });

  it("rejects body_hash that is fewer than 64 hex chars", () => {
    const r = validateFrontmatter({
      ...VALID_MIN,
      body_hash: "abc123",
    });
    expect(r.valid).toBe(false);
    expect(r.errorText).toMatch(/body_hash/);
  });

  it("rejects body_hash that is more than 64 hex chars", () => {
    const r = validateFrontmatter({
      ...VALID_MIN,
      body_hash: "a".repeat(65),
    });
    expect(r.valid).toBe(false);
    expect(r.errorText).toMatch(/body_hash/);
  });

  it("rejects body_hash with non-hex characters", () => {
    const r = validateFrontmatter({
      ...VALID_MIN,
      body_hash: "Z".repeat(64),
    });
    expect(r.valid).toBe(false);
    expect(r.errorText).toMatch(/body_hash/);
  });

  it("rejects body_hash with uppercase hex (pattern is lowercase only)", () => {
    const r = validateFrontmatter({
      ...VALID_MIN,
      body_hash: "A".repeat(64),
    });
    expect(r.valid).toBe(false);
  });

  it("accepts a valid 64-char lowercase-hex body_hash", () => {
    const r = validateFrontmatter({
      ...VALID_MIN,
      body_hash: "a".repeat(64),
    });
    expect(r.valid).toBe(true);
  });

  it("rejects a `to` array containing an empty string", () => {
    const r = validateFrontmatter({
      ...VALID_MIN,
      to: ["mac-m5max", ""],
    });
    expect(r.valid).toBe(false);
    expect(r.errorText).toMatch(/to/);
  });

  it("rejects a `to` array with a single empty string", () => {
    const r = validateFrontmatter({
      ...VALID_MIN,
      to: [""],
    });
    expect(r.valid).toBe(false);
  });

  it("rejects an empty `to` array (minItems: 1)", () => {
    const r = validateFrontmatter({
      ...VALID_MIN,
      to: [],
    });
    expect(r.valid).toBe(false);
  });

  it("rejects `to` as an empty string scalar", () => {
    const r = validateFrontmatter({
      ...VALID_MIN,
      to: "",
    });
    expect(r.valid).toBe(false);
  });
});
