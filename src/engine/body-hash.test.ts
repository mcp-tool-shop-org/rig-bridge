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

// F-TST-001: §4.1 normalization edge cases. Each block targets a single
// rule (1-4) at the boundary, with a few combinations to confirm the rules
// compose. Per docs/control-plane-integration.md §4.1, rule order is:
//   1. Line endings: CRLF/CR -> LF
//   2. Trailing whitespace per line: stripped (spaces + tabs)
//   3. Trailing newlines: collapsed to exactly one terminal "\n"
//   4. Encoding: leading BOM stripped (UTF-8, no BOM)
// Rule 5 says NO other normalization — markdown content + internal
// whitespace (incl. Unicode U+00A0) is preserved as authored.
describe("normalizeBody — §4.1 edge cases (F-TST-001)", () => {
  describe("rule 1: line-ending normalization", () => {
    it("collapses mixed CRLF + LF + lone CR in one body", () => {
      // CRLF then LF then lone CR — three different drift forms in one body.
      expect(normalizeBody("a\r\nb\nc\rd")).toBe("a\nb\nc\nd\n");
    });

    it("hashes mixed CRLF + LF + lone CR identically to pure LF", () => {
      expect(bodyHash("a\r\nb\nc\rd\n")).toBe(bodyHash("a\nb\nc\nd\n"));
    });

    it("preserves a literal '\\r' written inside a code fence as content drift", () => {
      // Sanity: rule 1 acts on byte 0x0D regardless of context (there is no
      // markdown awareness in §4.1). A literal CR inside the body collapses
      // to LF — that is the documented behavior.
      const withCr = "```\nline\rcontinues\n```\n";
      const noCr = "```\nline\ncontinues\n```\n";
      expect(bodyHash(withCr)).toBe(bodyHash(noCr));
    });
  });

  describe("rule 2: trailing-whitespace stripping", () => {
    it("strips trailing tabs", () => {
      expect(normalizeBody("a\t\t\n")).toBe("a\n");
    });

    it("strips mixed trailing tabs + spaces", () => {
      expect(normalizeBody("a \t \t\n")).toBe("a\n");
    });

    it("preserves internal tabs (only TRAILING tabs are stripped)", () => {
      expect(normalizeBody("a\tb\n")).toBe("a\tb\n");
    });

    it("preserves Unicode U+00A0 non-breaking space (NOT ASCII whitespace)", () => {
      // §4.1 rule 2 strips trailing ASCII whitespace (space + tab) per the
      // reference algorithm. U+00A0 is "internal whitespace inside lines"
      // (rule 5 — preserve as authored), and a trailing U+00A0 is NOT
      // stripped: it is part of message intent (markdown rendering treats
      // it specially). This pins the current behavior.
      const nbsp = " ";
      expect(normalizeBody(`a${nbsp}\n`)).toBe(`a${nbsp}\n`);
      expect(bodyHash(`a${nbsp}\n`)).not.toBe(bodyHash("a\n"));
    });
  });

  describe("rule 3: trailing-newline canonicalization", () => {
    it("empty body produces a single terminal newline", () => {
      expect(normalizeBody("")).toBe("\n");
    });

    it("whitespace-only body collapses to a single terminal newline", () => {
      // "   \n  \n\t\n" → after rule 1 same; rule 2 strips trailing space/tab
      // on each line giving "\n\n\n"; rule 3 collapses to "\n".
      expect(normalizeBody("   \n  \n\t\n")).toBe("\n");
      expect(bodyHash("   \n  \n\t\n")).toBe(bodyHash(""));
    });

    it("body without terminal newline gains exactly one", () => {
      expect(normalizeBody("hello")).toBe("hello\n");
    });

    it("body with many terminal newlines collapses to exactly one", () => {
      expect(normalizeBody("hello\n\n\n\n\n")).toBe("hello\n");
    });

    it("body with trailing CRLF stretches collapses correctly", () => {
      // After rule 1: "hello\n\n\n\n"; after rule 3: "hello\n".
      expect(normalizeBody("hello\r\n\r\n\r\n")).toBe("hello\n");
    });
  });

  describe("rule 4: BOM handling", () => {
    it("body with no BOM is unchanged at start", () => {
      expect(normalizeBody("hello\n").startsWith("hello")).toBe(true);
    });

    it("strips a single leading BOM", () => {
      expect(normalizeBody("﻿hello\n")).toBe("hello\n");
    });

    it("does NOT strip a BOM that appears mid-body (only leading is rule 4)", () => {
      // A BOM character literally inside the body (not at byte 0) is
      // "internal content" and must not be stripped — that would silently
      // erase real content drift.
      const mid = "line A\n﻿still content\n";
      expect(normalizeBody(mid)).toBe(mid);
    });

    it("BOM at start + CRLF + trailing whitespace all collapse together", () => {
      // Combined edge: BOM + CRLF + trailing spaces + multiple trailing CRLFs.
      const raw = "﻿hello   \r\nworld  \r\n\r\n\r\n";
      const canonical = "hello\nworld\n";
      expect(normalizeBody(raw)).toBe(canonical);
      expect(bodyHash(raw)).toBe(bodyHash(canonical));
    });
  });
});
