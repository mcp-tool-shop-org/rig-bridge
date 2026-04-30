// Envelope-marker → status_class derivation per
// docs/control-plane-integration.md §4.2.
//
// v1.0.0 does NOT write status_class anywhere (Path B-2 — no CP integration
// in this release). The helper exists, is exercised at envelope-construction
// time inside `bridge send`, and is fully tested so v1.1's CP write becomes
// a one-line drop-in. The five-marker set is the design surface; if a corpus
// envelope ever surfaces a sixth marker we want to fail loudly here, not
// silently coerce, because that's a hole in §4.2 the design needs to know
// about.

export type StatusClass =
  | "active"
  | "pending"
  | "targeted"
  | "completed"
  | "cancelled";

export class UnrecognizedMarkerError extends Error {
  readonly marker: string;
  constructor(marker: string, statusText: string) {
    super(
      `unrecognized status marker ${JSON.stringify(marker)} ` +
        `at start of status ${JSON.stringify(statusText)}; ` +
        `expected one of ▶ ⏸ 🎯 ✅ ❌ per ` +
        `docs/control-plane-integration.md §4.2`,
    );
    this.name = "UnrecognizedMarkerError";
    this.marker = marker;
  }
}

const MARKER_TO_CLASS: Record<string, StatusClass> = {
  "▶": "active",
  "⏸": "pending",
  "🎯": "targeted",
  "✅": "completed",
  "❌": "cancelled",
};

export const SUPPORTED_MARKERS = Object.keys(MARKER_TO_CLASS);

// Return the first non-whitespace "character" of a status string. Emoji
// markers can occupy multiple UTF-16 code units (🎯 is two), so we use the
// string iterator (which yields code points) rather than indexing by
// charCodeAt.
function firstGlyph(s: string): string {
  const trimmed = s.replace(/^\s+/, "");
  if (trimmed.length === 0) return "";
  const iter = trimmed[Symbol.iterator]();
  const first = iter.next();
  return first.done ? "" : first.value;
}

export function markerToStatusClass(status: string): StatusClass {
  if (typeof status !== "string" || status.length === 0) {
    throw new UnrecognizedMarkerError("", String(status));
  }
  const glyph = firstGlyph(status);
  const cls = MARKER_TO_CLASS[glyph];
  if (!cls) {
    throw new UnrecognizedMarkerError(glyph, status);
  }
  return cls;
}

export function isSupportedMarker(glyph: string): boolean {
  return Object.prototype.hasOwnProperty.call(MARKER_TO_CLASS, glyph);
}
