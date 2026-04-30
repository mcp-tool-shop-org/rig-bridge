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
  const noBom = raw.startsWith(BOM) ? raw.slice(1) : raw;
  const lf = noBom.replace(/\r\n?/g, "\n");
  const lines = lf.split("\n").map((line) => line.replace(/[ \t]+$/, ""));
  const joined = lines.join("\n");
  return joined.replace(/\n+$/, "") + "\n";
}

export function bodyHash(raw: string): string {
  return createHash("sha256")
    .update(normalizeBody(raw), "utf8")
    .digest("hex");
}
