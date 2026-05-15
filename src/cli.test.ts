// F-TST-024: focused unit tests for parseArgs in src/cli.ts.
//
// CONTEXT — Stage A wave 5 closure:
// =================================
// Wave 4 surfaced these tests as 23 `it.skip` placeholders because
// parseArgs was a module-private function in src/cli.ts (no `export`)
// and the Tests amend agent's domain did not include cli.ts. Wave 5
// (single amend agent, owns BOTH cli.ts AND cli.test.ts) exports
// parseArgs and un-skips the suite.
//
// In the same wave, the HIGH `--force` silent-disable bug (F-TST-024.13
// findings #5 in wave 4) was fixed in parseArgs by adding a
// BOOLEAN_FLAGS allowlist. Test 24.13 below is rewritten to match the
// POST-FIX behavior; the OLD pre-fix expectation is documented inline
// so anyone reading the history can see what changed and why.
//
// PARSEARGS CONTRACT (post-fix, src/cli.ts):
// - Signature: parseArgs(argv: string[]) → { positional: string[],
//   flags: Record<string, string | boolean>, multi: Record<string, string[]> }
// - argv is the post-command slice (e.g. for `send HANDOFF --to mac`,
//   argv would be ["HANDOFF", "--to", "mac"]). The first positional is
//   the type/subcommand if present; the caller (main) is what splits
//   the top-level command off.
// - A token starting with "--" is a flag. Its value-handling depends on
//   its identity:
//     • If the flag is in MULTI_FLAGS ({"--to", "--ref"}): the next
//       token MUST exist and not start with "--"; it is appended to
//       out.multi[flag]. Otherwise throw "flag --X requires a value".
//     • If the flag is in BOOLEAN_FLAGS ({"--force", "--no-push"}): set
//       out.flags[flag] = true unconditionally; do NOT consume the
//       next token. The next token is then either the next flag or a
//       positional. This is the F-CMD-001-class fix.
//     • Otherwise (any other --flag): if the next token exists and does
//       not start with "--", it becomes the flag's string value;
//       otherwise the flag is boolean true.
// - Repeated single-value flags OVERWRITE (last write wins) because of
//   straight assignment.
// - The current parser does NOT support `--flag=value` syntax — equals
//   signs are not split.
// - The current parser does NOT split comma-separated values for multi
//   flags.
// - The current parser does NOT reject unknown flags.
//
// These four "current behavior" quirks (=value not split, commas not
// split, last-write-wins, unknown flags accepted) are MEDIUM design
// findings deferred to Stage B. The tests below document the CURRENT
// behavior so Stage B can flip them deliberately if/when the design
// changes. Each carries a TODO comment with the design-finding label.

import { describe, it, expect } from "vitest";
import { parseArgs } from "./cli.js";

describe("F-TST-024: parseArgs unit tests", () => {
  it("F-TST-024.1: empty argv yields no command, no flags, no positionals", () => {
    const out = parseArgs([]);
    expect(out.positional).toEqual([]);
    expect(out.flags).toEqual({});
    expect(out.multi).toEqual({});
  });

  it("F-TST-024.2: single positional argument is captured", () => {
    const out = parseArgs(["HANDOFF"]);
    expect(out.positional).toEqual(["HANDOFF"]);
    expect(out.flags).toEqual({});
    expect(out.multi).toEqual({});
  });

  it("F-TST-024.3: two positional arguments are captured in order", () => {
    const out = parseArgs(["new", "test-thread"]);
    expect(out.positional).toEqual(["new", "test-thread"]);
    expect(out.flags).toEqual({});
    expect(out.multi).toEqual({});
  });

  it("F-TST-024.4: single-value flag with space separator", () => {
    const out = parseArgs(["--rig-id", "mac-m5max"]);
    expect(out.positional).toEqual([]);
    expect(out.flags).toEqual({ "--rig-id": "mac-m5max" });
    expect(out.multi).toEqual({});
  });

  it("F-TST-024.5: --flag=value syntax is NOT split (current behavior — treated as boolean flag with literal name)", () => {
    // TODO (Stage B, design finding: equals-syntax not split): parseArgs
    // does not split on `=`. `--rig-id=mac-m5max` becomes a single token
    // starting with "--" and (because there is no next token) becomes a
    // boolean true flag named literally "--rig-id=mac-m5max". This is
    // consistent with the CLI's documented usage (which only shows
    // `--flag value` form) and matches every existing integration-test
    // call site in the repo. Stage B may add `=`-splitting.
    const out = parseArgs(["--rig-id=mac-m5max"]);
    expect(out.positional).toEqual([]);
    expect(out.flags).toEqual({ "--rig-id=mac-m5max": true });
    expect(out.multi).toEqual({});
  });

  it("F-TST-024.6: repeated boolean flag is idempotent (last write wins, value stays true)", () => {
    const out = parseArgs(["--force", "--force"]);
    expect(out.positional).toEqual([]);
    expect(out.flags).toEqual({ "--force": true });
    expect(out.multi).toEqual({});
  });

  it("F-TST-024.7: repeated single-value flag overwrites (last write wins)", () => {
    // TODO (Stage B, design finding: last-write-wins on repeated
    // single-value flag): `out.flags[a] = next` is straight assignment,
    // so the second occurrence overwrites the first. No accumulation,
    // no error. Stage B may reject repeats or accumulate them.
    const out = parseArgs([
      "--rig-id",
      "first-value",
      "--rig-id",
      "second-value",
    ]);
    expect(out.flags["--rig-id"]).toBe("second-value");
  });

  it("F-TST-024.8: multi-value flag via repetition accumulates into ordered array", () => {
    const out = parseArgs(["--to", "mac-m5max", "--to", "windows-5080"]);
    expect(out.positional).toEqual([]);
    expect(out.flags).toEqual({});
    expect(out.multi).toEqual({
      "--to": ["mac-m5max", "windows-5080"],
    });
  });

  it("F-TST-024.9: comma-separated values for multi flag are NOT split by parseArgs", () => {
    // TODO (Stage B, design finding: comma not split inside parseArgs):
    // parseArgs treats the post-flag token as a single opaque string.
    // `--to a,b` produces ["a,b"], not ["a", "b"]. Comma-splitting (if
    // it happens) is the responsibility of the command handler that
    // consumes parsed.multi["--to"]. This matches the current send.ts
    // integration-test fixtures.
    const out = parseArgs(["--to", "mac-m5max,windows-5080"]);
    expect(out.multi).toEqual({
      "--to": ["mac-m5max,windows-5080"],
    });
  });

  it("F-TST-024.10: mixed repetition + comma — each occurrence is one element verbatim", () => {
    // TODO (Stage B, design finding: comma not split inside parseArgs):
    // a mix of repetition and comma keeps comma-clusters intact as
    // single elements. `--to a,b --to c` yields multi["--to"] =
    // ["a,b", "c"], not ["a", "b", "c"].
    const out = parseArgs(["--to", "a,b", "--to", "c"]);
    expect(out.multi).toEqual({
      "--to": ["a,b", "c"],
    });
  });

  it("F-TST-024.11: unknown flag does NOT throw (current behavior — no allowlist)", () => {
    // TODO (Stage B, design finding: no unknown-flag rejection):
    // parseArgs has no concept of "known" vs "unknown" flags. It accepts
    // any `--whatever` token. Per-command validation in main() decides
    // which flags it cares about. Stage B may add an allowlist.
    const out = parseArgs(["--definitely-not-a-real-flag", "some-value"]);
    expect(out.flags).toEqual({
      "--definitely-not-a-real-flag": "some-value",
    });
  });

  it("F-TST-024.12a: multi flag without a value throws 'flag --X requires a value' (terminal position)", () => {
    // The error path is explicit in parseArgs: if a MULTI_FLAGS member
    // has no following token (or the following token starts with "--"),
    // throw. This case is the terminal-position variant.
    expect(() => parseArgs(["--to"])).toThrow(/flag --to requires a value/);
  });

  it("F-TST-024.12b: multi flag immediately followed by another flag throws", () => {
    // Same error path, different trigger: the next token starts with
    // "--", so the multi flag is detected as boolean → throw.
    expect(() => parseArgs(["--to", "--force"])).toThrow(
      /flag --to requires a value/,
    );
  });

  it("F-TST-024.12c: single-value flag without a value becomes boolean (NO throw — different contract from multi)", () => {
    // TODO (Stage B, design finding: asymmetric no-value handling for
    // non-boolean single-value flags): single-value flags and multi
    // flags diverge here. Non-boolean single-value flags silently
    // become boolean true when no value follows. The per-command switch
    // in main() is what raises "init: --rig-id <id> is required" via a
    // typeof check. This test locks the parseArgs-layer contract; the
    // command-layer required-flag checks are tested in init.test.ts /
    // send.test.ts / close.test.ts.
    const out = parseArgs(["--rig-id"]);
    expect(out.flags).toEqual({ "--rig-id": true });
  });

  it("F-TST-024.13: allowlisted boolean flag (--force) followed by a non-flag token does NOT consume that token (POST-FIX behavior)", () => {
    // BUG FIX (wave-5, F-CMD-001 class): pre-fix, `--force somevalue` was
    // parsed as `{ --force: "somevalue" }` — a string value, NOT true.
    // Downstream `parsed.flags["--force"] === true` checks then silently
    // disabled the --force semantics. A careless operator typing
    // `rig-bridge init --force somevalue` had safety silently bypassed.
    //
    // Post-fix, --force is on the BOOLEAN_FLAGS allowlist. It is always
    // set to `true` and does NOT consume the next token. The next token
    // becomes a positional (or, if it starts with "--", the next flag).
    //
    // OLD (pre-fix, wave 4 placeholder) expectation was:
    //   expect(out.flags).toEqual({ "--force": "somevalue" });
    //   expect(out.positional).toEqual([]);
    // NEW (post-fix) expectation is below.
    const out = parseArgs(["--force", "somevalue"]);
    expect(out.flags).toEqual({ "--force": true });
    expect(out.positional).toEqual(["somevalue"]);
  });

  it("F-TST-024.14a: flag order is independent for the same flag set — boolean then single-value", () => {
    const a = parseArgs(["--force", "--rig-id", "mac"]);
    expect(a.flags).toEqual({ "--force": true, "--rig-id": "mac" });
    expect(a.positional).toEqual([]);
    expect(a.multi).toEqual({});
  });

  it("F-TST-024.14b: flag order is independent for the same flag set — single-value then boolean", () => {
    const b = parseArgs(["--rig-id", "mac", "--force"]);
    expect(b.flags).toEqual({ "--rig-id": "mac", "--force": true });
    expect(b.positional).toEqual([]);
    expect(b.multi).toEqual({});
  });

  it("F-TST-024.14c: order independence — output objects compare equal regardless of order", () => {
    const a = parseArgs(["--force", "--rig-id", "mac"]);
    const b = parseArgs(["--rig-id", "mac", "--force"]);
    expect(a.flags).toEqual(b.flags);
    expect(a.multi).toEqual(b.multi);
    expect(a.positional).toEqual(b.positional);
  });

  it("F-TST-024.15a: empty string as flag value is preserved verbatim", () => {
    // The caller (e.g. shell) is responsible for any quoting. parseArgs
    // receives whatever Node.js puts in process.argv. An empty string
    // value should not be coerced to boolean — it is a real token.
    const out = parseArgs(["--tldr", ""]);
    expect(out.flags).toEqual({ "--tldr": "" });
  });

  it("F-TST-024.15b: whitespace-only flag value is preserved verbatim", () => {
    // parseArgs does NOT trim. Trimming (if desired) is the command
    // handler's job.
    const out = parseArgs(["--tldr", "   "]);
    expect(out.flags).toEqual({ "--tldr": "   " });
  });

  it("F-TST-024.15c: value containing spaces (already a single argv token) is preserved", () => {
    // When the shell hands Node a single argv element with spaces in
    // it, that element stays one element. parseArgs does not split it.
    const out = parseArgs(["--status", "▶ Smoke test"]);
    expect(out.flags).toEqual({ "--status": "▶ Smoke test" });
  });

  it("F-TST-024.16: realistic send-command argv yields the expected three-bucket split", () => {
    // End-to-end check that mirrors how main() calls parseArgs on the
    // post-command slice. Mirrors the smoke test's runSend call shape.
    const out = parseArgs([
      "HANDOFF",
      "--thread",
      "test-thread",
      "--to",
      "windows-5080",
      "--status",
      "▶ wave 4",
      "--tldr",
      "tests amend",
      "--no-push",
    ]);
    expect(out.positional).toEqual(["HANDOFF"]);
    expect(out.flags).toEqual({
      "--thread": "test-thread",
      "--status": "▶ wave 4",
      "--tldr": "tests amend",
      "--no-push": true,
    });
    expect(out.multi).toEqual({ "--to": ["windows-5080"] });
  });

  it("F-TST-024.17: realistic send-command argv with multiple --ref and --to repetitions", () => {
    // Stress the multi-flag path with both MULTI_FLAGS members exercised.
    const out = parseArgs([
      "HANDOFF",
      "--thread",
      "t1",
      "--to",
      "mac-m5max",
      "--to",
      "windows-5080",
      "--ref",
      "abc1234",
      "--ref",
      "def5678",
    ]);
    expect(out.positional).toEqual(["HANDOFF"]);
    expect(out.flags).toEqual({ "--thread": "t1" });
    expect(out.multi).toEqual({
      "--to": ["mac-m5max", "windows-5080"],
      "--ref": ["abc1234", "def5678"],
    });
  });
});
