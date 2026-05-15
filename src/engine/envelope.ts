// Envelope (frontmatter + body) parser and renderer.
//
// Per docs/envelope-spec.md §3: every message file begins with a YAML
// frontmatter block delimited by `---` lines, immediately followed by the
// markdown body. The frontmatter is the envelope; the body is freeform.

import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { normalizeBody } from "./body-hash.js";

const FENCE = "---";

// 50 MB body-size guard for parseEnvelope. Envelopes are intended for
// short, structured handoffs; anything larger almost certainly means an
// operator accidentally piped a binary or a giant log into --body-file.
// Surfacing the cap with a clear ceiling + workaround beats letting Node
// run out of memory inside the parser. See B-ENG-001.
const MAX_ENVELOPE_BYTES = 50 * 1024 * 1024;

export interface Envelope {
  frontmatter: Record<string, unknown>;
  body: string;
}

export class EnvelopeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvelopeParseError";
  }
}

export function parseEnvelope(raw: string): Envelope {
  // Body-size guard (B-ENG-001). Measure UTF-8 byte length so the cap is
  // physical, not character-count: a 50MB cap on string.length would let
  // a 100MB-on-disk file slip through if it's full of 2-byte chars. Use
  // Buffer.byteLength to avoid building an intermediate Buffer.
  const byteLength = Buffer.byteLength(raw, "utf8");
  if (byteLength > MAX_ENVELOPE_BYTES) {
    const sizeMB = (byteLength / (1024 * 1024)).toFixed(1);
    throw new EnvelopeParseError(
      `body exceeds 50MB cap (got ${sizeMB}MB). For large payloads, ` +
        `store externally and reference by URL or commit SHA in the ` +
        `envelope tldr.`,
    );
  }

  // Tolerate a leading BOM (per §4.1, BOMs are normalized away in body
  // hashing — but a frontmatter parse that hits a BOM-prefixed file will
  // otherwise fail to match the opening fence).
  const text = raw.startsWith("﻿") ? raw.slice(1) : raw;

  const lf = text.replace(/\r\n?/g, "\n");
  const lines = lf.split("\n");

  if (lines[0] !== FENCE) {
    throw new EnvelopeParseError(
      "envelope must begin with a '---' frontmatter fence",
    );
  }

  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === FENCE) {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) {
    throw new EnvelopeParseError(
      "envelope frontmatter has no closing '---' fence",
    );
  }

  const yamlBlock = lines.slice(1, closeIdx).join("\n");
  let frontmatter: unknown;
  try {
    frontmatter = yamlParse(yamlBlock);
  } catch (e) {
    throw new EnvelopeParseError(
      `frontmatter YAML parse failed: ${(e as Error).message}`,
    );
  }
  if (frontmatter === null || frontmatter === undefined) {
    throw new EnvelopeParseError("frontmatter is empty");
  }
  if (typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    throw new EnvelopeParseError("frontmatter must be a YAML mapping");
  }

  // Body-side normalization is delegated to the canonical normalizeBody
  // implementation (per docs/control-plane-integration.md §4.1) so parse
  // and hash agree on a single source of truth. The whole-file BOM /
  // CRLF handling above is only what's needed to land on the body slice;
  // beyond that, normalization is centralized.
  const rawBody = lines.slice(closeIdx + 1).join("\n");
  const body = normalizeBody(rawBody);
  return { frontmatter: frontmatter as Record<string, unknown>, body };
}

export function renderEnvelope(env: Envelope): string {
  const yamlText = yamlStringify(env.frontmatter, {
    lineWidth: 0,
    defaultStringType: "PLAIN",
    defaultKeyType: "PLAIN",
  });
  const yamlBlock = yamlText.endsWith("\n")
    ? yamlText.slice(0, -1)
    : yamlText;
  // Apply §4.1 normalization to the body before emitting. This makes the
  // round-trip invariant hold by construction: a sender that runs the body
  // through bodyHash() and then renderEnvelope() writes the exact bytes the
  // hash was taken over. normalizeBody guarantees exactly one terminal
  // newline, so no separate trailing-newline fix-up is needed.
  const body = normalizeBody(env.body);
  return `${FENCE}\n${yamlBlock}\n${FENCE}\n${body}`;
}
