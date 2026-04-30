import { describe, it, expect } from "vitest";
import {
  markerToStatusClass,
  UnrecognizedMarkerError,
  isSupportedMarker,
  SUPPORTED_MARKERS,
} from "./status.js";

describe("markerToStatusClass", () => {
  it("maps each of the 5 markers", () => {
    expect(markerToStatusClass("▶ Phase 0 ready")).toBe("active");
    expect(markerToStatusClass("⏸ Awaiting peer")).toBe("pending");
    expect(markerToStatusClass("🎯 Decisions captured")).toBe("targeted");
    expect(markerToStatusClass("✅ Cutover complete")).toBe("completed");
    expect(markerToStatusClass("❌ Cancelled — premise gone")).toBe(
      "cancelled",
    );
  });

  it("ignores leading whitespace", () => {
    expect(markerToStatusClass("  ✅ done")).toBe("completed");
    expect(markerToStatusClass("\t❌ cancelled")).toBe("cancelled");
  });

  it("throws UnrecognizedMarkerError for an unknown leading glyph", () => {
    let caught: unknown;
    try {
      markerToStatusClass("⚠ warning");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnrecognizedMarkerError);
    expect((caught as UnrecognizedMarkerError).marker).toBe("⚠");
  });

  it("throws on empty input", () => {
    expect(() => markerToStatusClass("")).toThrow(UnrecognizedMarkerError);
  });

  it("throws on a status with only whitespace", () => {
    expect(() => markerToStatusClass("   ")).toThrow(UnrecognizedMarkerError);
  });

  it("throws when a plain word leads with no marker", () => {
    expect(() => markerToStatusClass("active phase 0")).toThrow(
      UnrecognizedMarkerError,
    );
  });
});

describe("isSupportedMarker", () => {
  it("returns true for the 5 supported markers", () => {
    for (const m of SUPPORTED_MARKERS) {
      expect(isSupportedMarker(m)).toBe(true);
    }
  });
  it("returns false for unrelated glyphs", () => {
    expect(isSupportedMarker("X")).toBe(false);
    expect(isSupportedMarker("⚠")).toBe(false);
  });
});
