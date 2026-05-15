// body_hash — sha256 over the canonically-normalized envelope BODY.
//
// Implements the reference algorithm in
// docs/control-plane-integration.md §4.1 verbatim. The normalization rule
// is normative: per-rig editor drift in line endings, trailing whitespace,
// trailing blank lines, and BOMs all collapse to one canonical form so the
// hash signals real content drift, not editor drift.
//
// Rule 3 ("exactly one terminal newline, always") means an empty body and
// a body that is only "\n" hash identically. Tests pin this.

import { createHash } from "node:crypto";

const BOM = "﻿";

export function normalizeBody(raw: string): string {
  // §4.1 normalization, applied in the spec's prose order:
  //   1. Line endings: CRLF/CR -> LF
  //   2. Trailing whitespace per line: stripped
  //   3. Trailing newlines: collapse to exactly one
  //   4. Encoding: strip a leading BOM if present
  // The four steps commute in observable output (the BOM stays at the start
  // through 1-3), so this ordering matches the spec's prose without changing
  // behavior on any input.
  const lf = raw.replace(/\r\n?/g, "\n");
  const lines = lf.split("\n").map((line) => line.replace(/[ \t]+$/, ""));
  const joined = lines.join("\n");
  const withTerminal = joined.replace(/\n+$/, "") + "\n";
  return withTerminal.startsWith(BOM) ? withTerminal.slice(1) : withTerminal;
}

export function bodyHash(raw: string): string {
  // Runtime type guard (B-ENG-002). TypeScript's static type system is
  // erased at runtime; if any caller (or future caller) passes a non-string
  // by mistake, fail at the engine boundary with a clear error rather than
  // letting the bad value reach normalizeBody → String.prototype.replace
  // and surface as an opaque crypto stack trace.
  if (typeof raw !== "string") {
    throw new TypeError("bodyHash: body must be a string, got " + typeof raw);
  }
  return createHash("sha256")
    .update(normalizeBody(raw), "utf8")
    .digest("hex");
}
