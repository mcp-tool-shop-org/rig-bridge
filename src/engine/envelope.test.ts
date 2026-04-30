import { describe, it, expect } from "vitest";
import { parseEnvelope, renderEnvelope, EnvelopeParseError } from "./envelope.js";

const SAMPLE = `---
from: windows-5080
to: mac-m5max
date: 2026-04-29
status: ✅ Cutover complete
type: ACK
thread: swarm-rig-bridge-001
---

# 5080-ACK — repoint executed

Standing by.
`;

describe("parseEnvelope", () => {
  it("splits frontmatter from body", () => {
    const env = parseEnvelope(SAMPLE);
    expect(env.frontmatter.from).toBe("windows-5080");
    expect(env.frontmatter.type).toBe("ACK");
    expect(env.body).toContain("Standing by.");
  });

  it("tolerates leading BOM", () => {
    const env = parseEnvelope("﻿" + SAMPLE);
    expect(env.frontmatter.from).toBe("windows-5080");
  });

  it("tolerates CRLF line endings", () => {
    const env = parseEnvelope(SAMPLE.replace(/\n/g, "\r\n"));
    expect(env.frontmatter.thread).toBe("swarm-rig-bridge-001");
  });

  it("throws when the file has no opening fence", () => {
    expect(() => parseEnvelope("hello")).toThrow(EnvelopeParseError);
  });

  it("throws when frontmatter has no closing fence", () => {
    expect(() => parseEnvelope("---\nfrom: a\n")).toThrow(EnvelopeParseError);
  });

  it("throws on an empty frontmatter block", () => {
    expect(() => parseEnvelope("---\n---\nbody\n")).toThrow(EnvelopeParseError);
  });

  it("parses arrays in `to` field", () => {
    const text = `---
from: windows-5080
to:
  - mac-m5max
  - mike-relay
date: 2026-04-29
status: ▶ active
type: HANDOFF
thread: t1
---

body
`;
    const env = parseEnvelope(text);
    expect(env.frontmatter.to).toEqual(["mac-m5max", "mike-relay"]);
  });
});

describe("renderEnvelope", () => {
  it("round-trips a parsed envelope without losing fields", () => {
    const env = parseEnvelope(SAMPLE);
    const rendered = renderEnvelope(env);
    const reparsed = parseEnvelope(rendered);
    expect(reparsed.frontmatter).toEqual(env.frontmatter);
    expect(reparsed.body.trim()).toBe(env.body.trim());
  });

  it("ends with a single trailing newline", () => {
    const env: { frontmatter: Record<string, unknown>; body: string } = {
      frontmatter: { from: "a", to: "b" },
      body: "no trailing newline",
    };
    const rendered = renderEnvelope(env);
    expect(rendered.endsWith("\n")).toBe(true);
  });

  it("preserves multi-line body content", () => {
    const env = {
      frontmatter: { from: "a", to: "b", thread: "t1" },
      body: "# Heading\n\nParagraph one.\n\nParagraph two.\n",
    };
    const rendered = renderEnvelope(env);
    expect(rendered).toContain("# Heading");
    expect(rendered).toContain("Paragraph two.");
  });
});
