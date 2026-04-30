import { describe, it, expect } from "vitest";
import { bodyHash, normalizeBody } from "./body-hash.js";

describe("normalizeBody", () => {
  it("collapses CRLF to LF", () => {
    expect(normalizeBody("a\r\nb\r\n")).toBe("a\nb\n");
  });

  it("collapses lone CR to LF", () => {
    expect(normalizeBody("a\rb")).toBe("a\nb\n");
  });

  it("strips trailing spaces and tabs from lines", () => {
    expect(normalizeBody("a   \nb\t\t\nc")).toBe("a\nb\nc\n");
  });

  it("collapses multiple trailing newlines to exactly one", () => {
    expect(normalizeBody("body\n\n\n\n")).toBe("body\n");
  });

  it("appends a terminal newline when none exists", () => {
    expect(normalizeBody("body")).toBe("body\n");
  });

  it("strips BOM at start", () => {
    expect(normalizeBody("﻿body")).toBe("body\n");
  });

  it("preserves internal whitespace inside lines", () => {
    expect(normalizeBody("a  b\n")).toBe("a  b\n");
  });
});

describe("bodyHash", () => {
  it("returns a 64-char lowercase hex string", () => {
    const h = bodyHash("hello");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes empty body and lone-newline body identically (§4.1 rule 3)", () => {
    expect(bodyHash("")).toBe(bodyHash("\n"));
    expect(bodyHash("")).toBe(bodyHash("\n\n\n"));
  });

  it("CRLF and LF round-trip identically", () => {
    expect(bodyHash("line1\r\nline2\r\n")).toBe(bodyHash("line1\nline2\n"));
  });

  it("trailing-space drift collapses to the same hash", () => {
    expect(bodyHash("hello world\n")).toBe(bodyHash("hello world   \n"));
  });

  it("BOM-prefixed body matches BOM-stripped body", () => {
    expect(bodyHash("﻿hello\n")).toBe(bodyHash("hello\n"));
  });

  it("real content drift produces a different hash", () => {
    expect(bodyHash("hello\n")).not.toBe(bodyHash("hello!\n"));
  });
});
