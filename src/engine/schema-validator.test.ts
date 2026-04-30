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
