import { describe, it, expect, beforeEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  utimesSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listThreads } from "./threads.js";

// Mirror the surface-teardown discipline established for the engine
// suite (B-TST-001).
function cleanupTempDir(p: string): void {
  try {
    rmSync(p, { recursive: true, force: true, maxRetries: 3 });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("temp cleanup failed for", p, e);
  }
}

// Helper to render a full envelope file with frontmatter+body. Keeps
// the test inputs realistic so the parseEnvelope+markerToStatusClass
// path is exercised on actual canonical content.
function writeEnvelope(
  threadDir: string,
  filename: string,
  fm: Record<string, unknown>,
  body: string,
  mtimeUnixSeconds?: number,
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
  const full = join(threadDir, filename);
  writeFileSync(full, text, "utf8");
  if (typeof mtimeUnixSeconds === "number") {
    utimesSync(full, mtimeUnixSeconds, mtimeUnixSeconds);
  }
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rig-bridge-threads-"));
  return () => cleanupTempDir(root);
});

describe("listThreads — happy path", () => {
  it("returns an empty array on a fresh bridge root", () => {
    expect(listThreads(root)).toEqual([]);
  });

  it("returns one summary for a single-envelope thread", () => {
    const t1 = join(root, "thread-1");
    mkdirSync(t1);
    writeEnvelope(
      t1,
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ Phase 7 begins",
        type: "REQUEST",
        thread: "thread-1",
      },
      "# REQUEST body\n\nStanding by.\n",
    );
    const result = listThreads(root);
    expect(result).toHaveLength(1);
    expect(result[0].thread_id).toBe("thread-1");
    expect(result[0].envelope_count).toBe(1);
    expect(result[0].is_closed).toBe(false);
    expect(result[0].status_class).toBe("active");
    expect(result[0].latest_envelope.filename).toBe("REQUEST.md");
    expect(result[0].latest_envelope.type).toBe("REQUEST");
    expect(result[0].latest_envelope.from).toBe("mac-m5max");
    expect(result[0].latest_envelope.to).toBe("windows-5080");
  });

  it("counts multiple envelopes within a thread", () => {
    const t1 = join(root, "thread-multi");
    mkdirSync(t1);
    writeEnvelope(
      t1,
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ open",
        type: "REQUEST",
        thread: "thread-multi",
      },
      "body\n",
    );
    writeEnvelope(
      t1,
      "HANDOFF.md",
      {
        from: "windows-5080",
        to: "mac-m5max",
        date: "2026-05-15",
        status: "▶ handed off",
        type: "HANDOFF",
        thread: "thread-multi",
      },
      "body\n",
    );
    writeEnvelope(
      t1,
      "RESPONSE.md",
      {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ responded",
        type: "RESPONSE",
        thread: "thread-multi",
      },
      "body\n",
    );
    const result = listThreads(root);
    expect(result).toHaveLength(1);
    expect(result[0].envelope_count).toBe(3);
  });

  it("flags a closed thread when RESOLUTION.md exists", () => {
    const t1 = join(root, "closed-thread");
    mkdirSync(t1);
    writeEnvelope(
      t1,
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ open",
        type: "REQUEST",
        thread: "closed-thread",
      },
      "body\n",
    );
    writeEnvelope(
      t1,
      "RESOLUTION.md",
      {
        from: "windows-5080",
        to: "mac-m5max",
        date: "2026-05-15",
        status: "✅ Cutover complete",
        type: "RESOLUTION",
        thread: "closed-thread",
      },
      "Standing by.\n",
    );
    const result = listThreads(root);
    expect(result).toHaveLength(1);
    expect(result[0].is_closed).toBe(true);
    expect(result[0].status_class).toBe("completed");
  });

  it("maps each of the five status markers to its status_class", () => {
    const cases: Array<{ marker: string; cls: string; folder: string }> = [
      { marker: "▶ active phase", cls: "active", folder: "thread-a" },
      { marker: "⏸ awaiting peer", cls: "pending", folder: "thread-b" },
      { marker: "🎯 targeted", cls: "targeted", folder: "thread-c" },
      { marker: "✅ shipped", cls: "completed", folder: "thread-d" },
      { marker: "❌ cancelled", cls: "cancelled", folder: "thread-e" },
    ];
    for (const c of cases) {
      const dir = join(root, c.folder);
      mkdirSync(dir);
      writeEnvelope(
        dir,
        "REQUEST.md",
        {
          from: "mac-m5max",
          to: "windows-5080",
          date: "2026-05-15",
          status: c.marker,
          type: "REQUEST",
          thread: c.folder,
        },
        "body\n",
      );
    }
    const result = listThreads(root);
    expect(result).toHaveLength(5);
    for (const c of cases) {
      const s = result.find((r) => r.thread_id === c.folder);
      expect(s?.status_class).toBe(c.cls);
    }
  });
});

describe("listThreads — ordering (L10)", () => {
  it("sorts by last_modified descending (recency first)", () => {
    const older = join(root, "thread-older");
    const newer = join(root, "thread-newer");
    mkdirSync(older);
    mkdirSync(newer);
    // Make older's envelope physically older by an hour.
    const olderMtime = 1_700_000_000; // arbitrary fixed epoch in 2023
    const newerMtime = olderMtime + 3600; // +1h
    writeEnvelope(
      older,
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ open",
        type: "REQUEST",
        thread: "thread-older",
      },
      "body\n",
      olderMtime,
    );
    writeEnvelope(
      newer,
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ open",
        type: "REQUEST",
        thread: "thread-newer",
      },
      "body\n",
      newerMtime,
    );
    const result = listThreads(root);
    expect(result.map((r) => r.thread_id)).toEqual([
      "thread-newer",
      "thread-older",
    ]);
  });

  it("picks the most-recent envelope per thread as latest_envelope", () => {
    const t = join(root, "thread-recent");
    mkdirSync(t);
    const older = 1_700_000_000;
    const newer = older + 3600;
    writeEnvelope(
      t,
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ open",
        type: "REQUEST",
        thread: "thread-recent",
      },
      "body\n",
      older,
    );
    writeEnvelope(
      t,
      "RESPONSE.md",
      {
        from: "windows-5080",
        to: "mac-m5max",
        date: "2026-05-15",
        status: "🎯 targeted",
        type: "RESPONSE",
        thread: "thread-recent",
      },
      "body\n",
      newer,
    );
    const result = listThreads(root);
    expect(result).toHaveLength(1);
    expect(result[0].latest_envelope.filename).toBe("RESPONSE.md");
    expect(result[0].status_class).toBe("targeted");
    expect(result[0].latest_envelope.type).toBe("RESPONSE");
  });

  it("uses lexicographic filename tiebreaker for equal-mtime envelopes", () => {
    const t = join(root, "thread-tie");
    mkdirSync(t);
    const mt = 1_700_000_000;
    writeEnvelope(
      t,
      "AAA.md",
      {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ a",
        type: "STATE",
        thread: "thread-tie",
      },
      "body\n",
      mt,
    );
    writeEnvelope(
      t,
      "ZZZ.md",
      {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "⏸ z",
        type: "STATE",
        thread: "thread-tie",
      },
      "body\n",
      mt,
    );
    const result = listThreads(root);
    // ZZZ > AAA lexicographically, so it wins the equal-mtime tie.
    expect(result[0].latest_envelope.filename).toBe("ZZZ.md");
  });

  it("uses thread_id alphabetic tiebreaker when last_modified is equal", () => {
    const a = join(root, "alpha");
    const b = join(root, "bravo");
    mkdirSync(a);
    mkdirSync(b);
    const mt = 1_700_000_000;
    writeEnvelope(
      a,
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ open",
        type: "REQUEST",
        thread: "alpha",
      },
      "body\n",
      mt,
    );
    writeEnvelope(
      b,
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ open",
        type: "REQUEST",
        thread: "bravo",
      },
      "body\n",
      mt,
    );
    const result = listThreads(root);
    expect(result.map((r) => r.thread_id)).toEqual(["alpha", "bravo"]);
  });
});

describe("listThreads — filtering", () => {
  it("skips dot-prefixed directories (.git, .bridge)", () => {
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, ".bridge"));
    // Put a "fake envelope" in .bridge to prove we don't walk into it.
    writeEnvelope(
      join(root, ".bridge"),
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ open",
        type: "REQUEST",
        thread: "fake-thread",
      },
      "body\n",
    );
    expect(listThreads(root)).toEqual([]);
  });

  it("skips node_modules and dist", () => {
    mkdirSync(join(root, "node_modules"));
    mkdirSync(join(root, "dist"));
    expect(listThreads(root)).toEqual([]);
  });

  it("skips directories whose name violates the thread-id pattern", () => {
    // Uppercase, underscores, leading hyphen all fail the schema-thread pattern.
    mkdirSync(join(root, "ThreadOne"));
    mkdirSync(join(root, "thread_two"));
    mkdirSync(join(root, "-leading-hyphen"));
    mkdirSync(join(root, "trailing-hyphen-"));
    expect(listThreads(root)).toEqual([]);
  });

  it("skips files at the bridge root (only directories are threads)", () => {
    writeFileSync(join(root, "README.md"), "# readme\n", "utf8");
    expect(listThreads(root)).toEqual([]);
  });

  it("skips a thread directory that contains no parseable .md envelopes", () => {
    const t = join(root, "no-envelopes");
    mkdirSync(t);
    // Only a non-md file present.
    writeFileSync(join(t, "scratch.txt"), "not an envelope\n", "utf8");
    expect(listThreads(root)).toEqual([]);
  });

  it("silently skips a corrupt .md file but still surfaces good ones in the same thread", () => {
    const t = join(root, "thread-mixed");
    mkdirSync(t);
    writeFileSync(join(t, "BROKEN.md"), "not a frontmatter\n", "utf8");
    writeEnvelope(
      t,
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "▶ open",
        type: "REQUEST",
        thread: "thread-mixed",
      },
      "body\n",
    );
    const result = listThreads(root);
    expect(result).toHaveLength(1);
    expect(result[0].envelope_count).toBe(1);
    expect(result[0].latest_envelope.filename).toBe("REQUEST.md");
  });

  it("returns [] when bridgeRoot does not exist", () => {
    expect(listThreads(join(root, "no-such-dir"))).toEqual([]);
  });
});

describe("listThreads — frontmatter shapes", () => {
  it("preserves array `to` field on the EnvelopeRef", () => {
    const t = join(root, "thread-array-to");
    mkdirSync(t);
    writeEnvelope(
      t,
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: ["windows-5080", "mike-relay"],
        date: "2026-05-15",
        status: "▶ open",
        type: "REQUEST",
        thread: "thread-array-to",
      },
      "body\n",
    );
    const result = listThreads(root);
    expect(result).toHaveLength(1);
    expect(result[0].latest_envelope.to).toEqual(["windows-5080", "mike-relay"]);
  });

  it("falls back to 'active' when status marker is unknown", () => {
    // Pre-schema corpus envelopes can carry non-canonical markers. The
    // helper degrades gracefully — render path never throws.
    const t = join(root, "thread-bad-marker");
    mkdirSync(t);
    writeEnvelope(
      t,
      "REQUEST.md",
      {
        from: "mac-m5max",
        to: "windows-5080",
        date: "2026-05-15",
        status: "⚠ warning",
        type: "REQUEST",
        thread: "thread-bad-marker",
      },
      "body\n",
    );
    const result = listThreads(root);
    expect(result).toHaveLength(1);
    expect(result[0].status_class).toBe("active");
  });
});
