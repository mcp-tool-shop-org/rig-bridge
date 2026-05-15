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

// F-TST-003: Unicode-marker edge cases. The five markers are entered by
// humans on Mac/Windows/Linux through different IMEs that may emit
// variation selectors (U+FE0F) after the base glyph to force an emoji
// rendering. The first-code-point algorithm in firstGlyph() yields the
// base glyph; the variation selector becomes the second iterator value
// and is implicitly part of the status prose. This pins that behavior.
describe("markerToStatusClass — Unicode marker variation (F-TST-003)", () => {
  it("▶ + U+FE0F variation selector resolves to active", () => {
    // U+25B6 BLACK RIGHT-POINTING TRIANGLE + U+FE0F EMOJI VARIATION SELECTOR.
    // Many IMEs emit this two-code-point form when the user picks the
    // emoji-style rendering. firstGlyph yields just U+25B6 and the rest
    // (including U+FE0F) is treated as part of the status prose.
    const withVS = "▶️ active phase";
    expect(markerToStatusClass(withVS)).toBe("active");
  });

  it("✅ + U+FE0F variation selector resolves to completed", () => {
    const withVS = "✅️ shipped";
    expect(markerToStatusClass(withVS)).toBe("completed");
  });

  it("❌ + U+FE0F variation selector resolves to cancelled", () => {
    const withVS = "❌️ cancelled";
    expect(markerToStatusClass(withVS)).toBe("cancelled");
  });

  it("⏸ + U+FE0F variation selector resolves to pending", () => {
    const withVS = "⏸️ awaiting peer";
    expect(markerToStatusClass(withVS)).toBe("pending");
  });

  it("🎯 (multi-code-unit emoji, surrogate pair) resolves to targeted", () => {
    // 🎯 (U+1F3AF DIRECT HIT) is OUTSIDE the BMP and is encoded as two
    // UTF-16 code units (a surrogate pair). The string iterator yields it
    // as a single code-point — this is why firstGlyph cannot use
    // charCodeAt-based indexing. Pin that behavior.
    const marker = "🎯";
    expect([...marker].length).toBe(1);
    expect(markerToStatusClass("🎯 decisive moment")).toBe("targeted");
    // With trailing variation selector, the first code point is still 🎯.
    const withVS = "\u{1F3AF}️";
    expect(markerToStatusClass(`${withVS} decisive`)).toBe("targeted");
  });

  it("rejects an unrelated emoji even when it would otherwise look like a marker", () => {
    // ⏯ (U+23EF PLAY-PAUSE BUTTON) is a confusable for ▶ / ⏸ but is not
    // one of the five supported markers. Must throw, not silently coerce.
    expect(() => markerToStatusClass("⏯ playing")).toThrow(
      UnrecognizedMarkerError,
    );
  });
});
