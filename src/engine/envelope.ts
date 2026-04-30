// Envelope (frontmatter + body) parser and renderer.
//
// Per docs/envelope-spec.md §3: every message file begins with a YAML
// frontmatter block delimited by `---` lines, immediately followed by the
// markdown body. The frontmatter is the envelope; the body is freeform.

import { parse as yamlParse, stringify as yamlStringify } from "yaml";

const FENCE = "---";

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

  const body = lines.slice(closeIdx + 1).join("\n");
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
  const body = env.body.replace(/\r\n?/g, "\n");
  const trailing = body.endsWith("\n") ? "" : "\n";
  return `${FENCE}\n${yamlBlock}\n${FENCE}\n${body}${trailing}`;
}
