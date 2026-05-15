import { describe, it, expect, beforeEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findPeerRigs } from "./peer-rigs.js";

function cleanupTempDir(p: string): void {
  try {
    rmSync(p, { recursive: true, force: true, maxRetries: 3 });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("temp cleanup failed for", p, e);
  }
}

function writeEnvelope(
  threadDir: string,
  filename: string,
  fm: Record<string, unknown>,
  body: string,
): void {
  const yamlLines: string[] = [];
  for (const [k, v] of Object.entries(fm)) {
    if (Array.isArray(v)) {
      yamlLines.push(`${k}:`);
      for (const item of v) {
        yamlLines.push(`  - ${item}`);
      }
    } else {
      yamlLines.push(`${k}: ${v}`);
    }
  }
  const text = `---\n${yamlLines.join("\n")}\n---\n\n${body}`;
  writeFileSync(join(threadDir, filename), text, "utf8");
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rig-bridge-peer-"));
  return () => cleanupTempDir(root);
});

describe("findPeerRigs — happy path", () => {
  it("returns [] on an empty bridge root", () => {
    expect(findPeerRigs(root, "mac-m5max")).toEqual([]);
  });

  it("finds a single peer from a single envelope", () => {
    const t = join(root, "thread-1");
    mkdirSync(t);
    writeEnvelope(
      t,
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ open",
        type: "REQUEST",
        thread: "thread-1",
      },
      "body\n",
    );
    const result = findPeerRigs(root, "mac-m5max");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ rig_id: "windows-5080", envelope_count: 1 });
  });

  it("counts both from and to across envelopes", () => {
    const t = join(root, "thread-1");
    mkdirSync(t);
    writeEnvelope(
      t,
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ a",
        type: "REQUEST",
        thread: "thread-1",
      },
      "body\n",
    );
    writeEnvelope(
      t,
      "RESPONSE.md",
      {
        from: "windows-5080",
        to: "mac-m5max",
        date: "2026-05-15",
        status: "▶ b",
        type: "RESPONSE",
        thread: "thread-1",
      },
      "body\n",
    );
    // Self appearances (mac-m5max as either from or to) get filtered out.
    // windows-5080 appears as `to` in REQUEST + `from` in RESPONSE = 2.
    const result = findPeerRigs(root, "mac-m5max");
    expect(result).toEqual([{ rig_id: "windows-5080", envelope_count: 2 }]);
  });

  it("ranks multiple peers by descending envelope_count", () => {
    const t = join(root, "thread-1");
    mkdirSync(t);
    // 3 envelopes mentioning windows-5080 + 1 envelope mentioning mike-relay
    writeEnvelope(
      t,
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ a",
        type: "REQUEST",
        thread: "thread-1",
      },
      "body\n",
    );
    writeEnvelope(
      t,
      "HANDOFF.md",
      {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ b",
        type: "HANDOFF",
        thread: "thread-1",
      },
      "body\n",
    );
    writeEnvelope(
      t,
      "RESPONSE.md",
      {
        from: "windows-5080",
        to: ["mac-m5max", "mike-relay"],
        date: "2026-05-15",
        status: "▶ c",
        type: "RESPONSE",
        thread: "thread-1",
      },
      "body\n",
    );
    const result = findPeerRigs(root, "mac-m5max");
    expect(result).toEqual([
      { rig_id: "windows-5080", envelope_count: 3 },
      { rig_id: "mike-relay", envelope_count: 1 },
    ]);
  });

  it("walks multiple thread directories", () => {
    const t1 = join(root, "thread-1");
    const t2 = join(root, "thread-2");
    mkdirSync(t1);
    mkdirSync(t2);
    writeEnvelope(
      t1,
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ a",
        type: "REQUEST",
        thread: "thread-1",
      },
      "body\n",
    );
    writeEnvelope(
      t2,
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: "mike-relay",
        date: "2026-05-15",
        status: "▶ b",
        type: "REQUEST",
        thread: "thread-2",
      },
      "body\n",
    );
    const result = findPeerRigs(root, "mac-m5max");
    expect(result).toEqual([
      { rig_id: "mike-relay", envelope_count: 1 },
      { rig_id: "windows-5080", envelope_count: 1 },
    ]);
  });
});

describe("findPeerRigs — filtering and normalization", () => {
  it("filters out self (in either from or to)", () => {
    const t = join(root, "thread-1");
    mkdirSync(t);
    writeEnvelope(
      t,
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: "mac-m5max",
        date: "2026-05-15",
        status: "▶ self-send",
        type: "STATE",
        thread: "thread-1",
      },
      "body\n",
    );
    expect(findPeerRigs(root, "mac-m5max")).toEqual([]);
  });

  it("normalizes uppercase rig-ids in stored envelopes (B-ENG-003)", () => {
    // YAML parses "Windows-5080" as a string; the helper normalizes
    // before validateRigId. After normalization, the id becomes
    // "windows-5080" which passes the pattern.
    const t = join(root, "thread-norm");
    mkdirSync(t);
    writeEnvelope(
      t,
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: "Windows-5080",
        date: "2026-05-15",
        status: "▶ a",
        type: "REQUEST",
        thread: "thread-norm",
      },
      "body\n",
    );
    const result = findPeerRigs(root, "mac-m5max");
    expect(result).toEqual([{ rig_id: "windows-5080", envelope_count: 1 }]);
  });

  it("skips invalid rig-ids without crashing", () => {
    // The schema would reject this on the wire, but on-disk envelopes
    // from a pre-schema corpus may carry shapes the validator rejects.
    // The helper should not crash; it just skips the invalid id.
    const t = join(root, "thread-bad");
    mkdirSync(t);
    writeEnvelope(
      t,
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: "BAD ID WITH SPACES",
        date: "2026-05-15",
        status: "▶ a",
        type: "REQUEST",
        thread: "thread-bad",
      },
      "body\n",
    );
    // No peer found — only mac-m5max (self) and the invalid id.
    expect(findPeerRigs(root, "mac-m5max")).toEqual([]);
  });

  it("skips a malformed envelope file silently", () => {
    const t = join(root, "thread-corrupt");
    mkdirSync(t);
    writeFileSync(join(t, "BROKEN.md"), "this is not yaml\n", "utf8");
    writeEnvelope(
      t,
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ a",
        type: "REQUEST",
        thread: "thread-corrupt",
      },
      "body\n",
    );
    const result = findPeerRigs(root, "mac-m5max");
    expect(result).toEqual([{ rig_id: "windows-5080", envelope_count: 1 }]);
  });

  it("skips dot-prefixed directories (.bridge, .git)", () => {
    mkdirSync(join(root, ".bridge"));
    writeEnvelope(
      join(root, ".bridge"),
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ a",
        type: "REQUEST",
        thread: "fake",
      },
      "body\n",
    );
    expect(findPeerRigs(root, "mac-m5max")).toEqual([]);
  });

  it("skips directories that violate the thread-id pattern", () => {
    mkdirSync(join(root, "Bad_Name"));
    writeEnvelope(
      join(root, "Bad_Name"),
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ a",
        type: "REQUEST",
        thread: "bad-name",
      },
      "body\n",
    );
    expect(findPeerRigs(root, "mac-m5max")).toEqual([]);
  });

  it("returns [] when bridgeRoot does not exist", () => {
    expect(findPeerRigs(join(root, "no-such-dir"), "mac-m5max")).toEqual([]);
  });
});

describe("findPeerRigs — ordering", () => {
  it("uses rig_id ascending as a tiebreaker when counts are equal", () => {
    const t = join(root, "thread-tie");
    mkdirSync(t);
    writeEnvelope(
      t,
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ a",
        type: "REQUEST",
        thread: "thread-tie",
      },
      "body\n",
    );
    writeEnvelope(
      t,
      "HANDOFF.md",
      {
        from: "mac-m5max",
        to: "mike-relay",
        date: "2026-05-15",
        status: "▶ b",
        type: "HANDOFF",
        thread: "thread-tie",
      },
      "body\n",
    );
    const result = findPeerRigs(root, "mac-m5max");
    // Both have count 1; alphabetic order: mike-relay < windows-5080.
    expect(result).toEqual([
      { rig_id: "mike-relay", envelope_count: 1 },
      { rig_id: "windows-5080", envelope_count: 1 },
    ]);
  });

  it("handles an array `to` field", () => {
    const t = join(root, "thread-multi-to");
    mkdirSync(t);
    writeEnvelope(
      t,
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: ["windows-5080", "mike-relay"],
        date: "2026-05-15",
        status: "▶ a",
        type: "REQUEST",
        thread: "thread-multi-to",
      },
      "body\n",
    );
    const result = findPeerRigs(root, "mac-m5max");
    expect(result).toEqual([
      { rig_id: "mike-relay", envelope_count: 1 },
      { rig_id: "windows-5080", envelope_count: 1 },
    ]);
  });

  it("normalizes self with trailing whitespace + uppercase before filtering", () => {
    const t = join(root, "thread-self-norm");
    mkdirSync(t);
    writeEnvelope(
      t,
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ a",
        type: "REQUEST",
        thread: "thread-self-norm",
      },
      "body\n",
    );
    // Self id passed in with whitespace + uppercase — should still
    // filter out self counts cleanly.
    const result = findPeerRigs(root, "  MAC-M5max  ");
    expect(result).toEqual([{ rig_id: "windows-5080", envelope_count: 1 }]);
  });
});
