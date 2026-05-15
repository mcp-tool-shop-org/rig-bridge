import { describe, it, expect, beforeEach } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runInit } from "./init.js";
import { runNew } from "./new.js";
import { runRelay } from "./relay.js";
import { parseEnvelope } from "../engine/envelope.js";
import { bodyHash } from "../engine/body-hash.js";

let dir: string;

// B-TST-001 (Stage C wave 1): surface teardown failures and tolerate
// transient Windows file-locks via maxRetries.
function cleanupTempDir(p: string): void {
  try {
    rmSync(p, { recursive: true, force: true, maxRetries: 3 });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("temp cleanup failed for", p, e);
  }
}

// Install a stub gpg-like signer at <repoDir>/.git/fake-gpg.sh and
// configure git to use it. The stub emits a deterministic ASCII-armor
// block on stdout and the SIG_CREATED status line on stderr — enough
// for git commit -S to treat the signing operation as successful.
// Without this, `git commit -S` would call the real gpg, fail on
// every test machine without a configured GPG keyring, and we'd lose
// the ability to test the L7/L8/L9 surface entirely. The fake-gpg
// approach mirrors what real CI environments use to test signing
// pipelines without real keys.
function installFakeGpgSigner(repoDir: string): void {
  const fakeGpgPath = join(repoDir, ".git", "fake-gpg.sh");
  const stub = `#!/bin/sh
# Fake gpg signer for rig-bridge relay tests.
# Drains stdin (the content git is signing), emits a placeholder
# ASCII-armored signature on stdout, and writes the SIG_CREATED
# status line on stderr that git looks for.
cat > /dev/null
cat << 'SIG'
-----BEGIN PGP SIGNATURE-----

iQFAKETESTSIGNATUREv1+placeholderText==
=ABCD
-----END PGP SIGNATURE-----
SIG
printf "[GNUPG:] SIG_CREATED " >&2
printf "S 1 8 00 0 1700000000 FAKE_KEY\\n" >&2
exit 0
`;
  writeFileSync(fakeGpgPath, stub, "utf8");
  try {
    chmodSync(fakeGpgPath, 0o755);
  } catch {
    // Some FS layers (Windows non-bash) don't support chmod; the
    // shebang launcher will still execute under git-bash on Windows.
  }
  spawnSync("git", ["config", "gpg.program", fakeGpgPath], {
    cwd: repoDir,
    encoding: "utf8",
  });
}

// Set up an init'd bridge in a tmp dir. The default rigId is the
// relay-suffix variant so relay-happy-path tests can use it
// immediately; tests that exercise the non-relay refusal pass a
// non-suffix rigId explicitly.
function setupBridge(rigId = "mike-relay"): string {
  const d = mkdtempSync(join(tmpdir(), "rig-bridge-relay-"));
  spawnSync("git", ["init", "-b", "main", d], { encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "operator@example.com"], { cwd: d, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "Operator Test"], { cwd: d, encoding: "utf8" });
  spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: d, encoding: "utf8" });
  runInit({
    cwd: d,
    rigId,
    displayName: `Relay (${rigId})`,
    stdout: () => {},
    stderr: () => {},
  });
  runNew({ cwd: d, threadId: "thread-1", stdout: () => {} });
  return d;
}

// Configure the signing key + fake signer so the relay's commit -S
// succeeds. Tests that exercise the L9 refusal path SKIP this step.
function enableSigning(repoDir: string, signingKey = "FAKE_TEST_KEY_ID"): void {
  spawnSync("git", ["config", "user.signingkey", signingKey], { cwd: repoDir, encoding: "utf8" });
  installFakeGpgSigner(repoDir);
}

beforeEach(() => {
  dir = setupBridge();
  return () => cleanupTempDir(dir);
});

describe("runRelay — input validation (refusal paths)", () => {
  it("refuses an unknown --type (not in DECISIONS|RESPONSE|ACK)", async () => {
    enableSigning(dir);
    await expect(
      runRelay({
        cwd: dir,
        threadId: "thread-1",
        type: "REQUEST",
        inReplyTo: "a".repeat(64),
        body: "x\n",
        noPush: true,
        stdout: () => {},
        stderr: () => {},
      }),
    ).rejects.toThrow(/unknown type/);
  });

  it("L5: refuses when rig_id does NOT end in -relay", async () => {
    // Re-init with a peer-rig id (no -relay suffix). The thread dir
    // already exists from the default setup, but the underlying
    // .bridge/config.yaml gets rewritten on --force.
    cleanupTempDir(dir);
    dir = setupBridge("mac-m5max");
    enableSigning(dir);
    await expect(
      runRelay({
        cwd: dir,
        threadId: "thread-1",
        type: "DECISIONS",
        inReplyTo: "b".repeat(64),
        body: "x\n",
        noPush: true,
        stdout: () => {},
        stderr: () => {},
      }),
    ).rejects.toThrow(/not a relay rig|MUST end in/);
  });

  it("L6: refuses when git user.name is missing", async () => {
    // Unset user.name AT THE LOCAL LEVEL and override git's
    // config-search to ignore global + system so a test machine with
    // a globally-set user.name doesn't mask the local refusal. The
    // cleanest path is GIT_CONFIG_NOSYSTEM=1 + HOME pointing to an
    // empty dir, which is exactly what runGit inherits via env.
    spawnSync("git", ["config", "--local", "--unset", "user.name"], {
      cwd: dir,
      encoding: "utf8",
    });
    // Force git to ignore global + system config for the duration of
    // this test by routing HOME to a fresh empty dir and disabling
    // system config. process.env mutation is reverted after the test
    // via finally.
    const tmpHome = mkdtempSync(join(tmpdir(), "rig-bridge-relay-home-"));
    const prevHome = process.env.HOME;
    const prevUserprofile = process.env.USERPROFILE;
    const prevNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
    const prevGlobal = process.env.GIT_CONFIG_GLOBAL;
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    // GIT_CONFIG_GLOBAL takes a path; pointing to /dev/null on POSIX or
    // NUL on Windows tells git "no global config." Using a fresh tmp
    // file in the empty home is cross-platform — git treats a missing
    // file as empty global config.
    process.env.GIT_CONFIG_GLOBAL = join(tmpHome, ".gitconfig");
    try {
      enableSigning(dir);
      await expect(
        runRelay({
          cwd: dir,
          threadId: "thread-1",
          type: "DECISIONS",
          inReplyTo: "c".repeat(64),
          body: "x\n",
          noPush: true,
          stdout: () => {},
          stderr: () => {},
        }),
      ).rejects.toThrow(/user\.name and user\.email/);
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevUserprofile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = prevUserprofile;
      if (prevNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
      else process.env.GIT_CONFIG_NOSYSTEM = prevNoSystem;
      if (prevGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = prevGlobal;
      cleanupTempDir(tmpHome);
    }
  });

  it("L9: refuses when user.signingkey is missing (no soft-fail)", async () => {
    // Notably we do NOT call enableSigning() here, so user.signingkey
    // stays unset and the relay command must refuse before any file
    // write. The error must mention signing key explicitly.
    await expect(
      runRelay({
        cwd: dir,
        threadId: "thread-1",
        type: "DECISIONS",
        inReplyTo: "d".repeat(64),
        body: "x\n",
        noPush: true,
        stdout: () => {},
        stderr: () => {},
      }),
    ).rejects.toThrow(/signing key/);
  });

  it("L8: refuses when --in-reply-to is missing", async () => {
    enableSigning(dir);
    await expect(
      runRelay({
        cwd: dir,
        threadId: "thread-1",
        type: "DECISIONS",
        // inReplyTo intentionally omitted.
        body: "x\n",
        noPush: true,
        stdout: () => {},
        stderr: () => {},
      }),
    ).rejects.toThrow(/in-reply-to/);
  });

  it("L8: refuses when --in-reply-to is not a valid sha256 hex string", async () => {
    enableSigning(dir);
    await expect(
      runRelay({
        cwd: dir,
        threadId: "thread-1",
        type: "DECISIONS",
        inReplyTo: "not-a-real-hash",
        body: "x\n",
        noPush: true,
        stdout: () => {},
        stderr: () => {},
      }),
    ).rejects.toThrow(/body_hash|hex/);
  });

  it("L8: refuses when --in-reply-to is 63 chars (one short of 64)", async () => {
    enableSigning(dir);
    await expect(
      runRelay({
        cwd: dir,
        threadId: "thread-1",
        type: "DECISIONS",
        inReplyTo: "a".repeat(63),
        body: "x\n",
        noPush: true,
        stdout: () => {},
        stderr: () => {},
      }),
    ).rejects.toThrow(/body_hash|hex/);
  });

  it("refuses when the thread directory does not exist", async () => {
    enableSigning(dir);
    await expect(
      runRelay({
        cwd: dir,
        threadId: "no-such-thread",
        type: "DECISIONS",
        inReplyTo: "e".repeat(64),
        body: "x\n",
        noPush: true,
        stdout: () => {},
        stderr: () => {},
      }),
    ).rejects.toThrow(/thread directory not found/);
  });
});

describe("runRelay — happy path (signed envelope)", () => {
  // git-bash sh stub needed; on raw Windows powershell the fake-gpg.sh
  // shebang launcher might not be found. We gate the happy-path tests
  // on bash availability — if not present, skip rather than fail.
  // (The vast majority of contributor machines have bash via git-bash
  // or Linux/macOS.)
  function hasBash(): boolean {
    const r = spawnSync("sh", ["-c", "exit 0"], { encoding: "utf8" });
    return r.status === 0;
  }

  const maybeIt = hasBash() ? it : it.skip;

  maybeIt("writes RELAY-<nonce>.md with attestation block and signs the commit", async () => {
    enableSigning(dir, "OPERATOR_TEST_KEY_ABC123");
    const priorHash = "a".repeat(64);
    const r = await runRelay({
      cwd: dir,
      threadId: "thread-1",
      type: "DECISIONS",
      inReplyTo: priorHash,
      body: "# DECISIONS\n\nProceed with wave 2.\n",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    expect(r.filename).toMatch(/^RELAY-[0-9A-Z]+\.md$/);
    expect(r.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(r.bodyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.attestation.attested_by).toBe("OPERATOR_TEST_KEY_ABC123");
    expect(r.attestation.attested_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.attestation.nonce).toMatch(/^[0-9A-Z]+-[0-9A-Z]+$/);
    expect(existsSync(r.filePath)).toBe(true);

    // Parse the written envelope and verify the attestation block.
    const text = readFileSync(r.filePath, "utf8");
    const env = parseEnvelope(text);
    expect(env.frontmatter.from).toBe("mike-relay");
    expect(env.frontmatter.type).toBe("DECISIONS");
    expect(env.frontmatter.thread).toBe("thread-1");
    expect(env.frontmatter.in_reply_to).toBe(priorHash);
    expect(env.frontmatter.attested_by).toBe("OPERATOR_TEST_KEY_ABC123");
    expect(env.frontmatter.attested_at).toBe(r.attestation.attested_at);
    expect(env.frontmatter.nonce).toBe(r.attestation.nonce);
    expect(env.frontmatter.body_hash).toBe(r.bodyHash);
    // display_name should carry the operator's git user.name (L6 — the
    // human attests, not the bridge-default).
    expect(env.frontmatter.display_name).toBe("Operator Test");
  });

  maybeIt("commit author is the operator's git config (L6 — not bridge-default)", async () => {
    enableSigning(dir);
    const r = await runRelay({
      cwd: dir,
      threadId: "thread-1",
      type: "DECISIONS",
      inReplyTo: "b".repeat(64),
      body: "body\n",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    // Read the commit's author + committer via git log.
    const log = spawnSync(
      "git",
      ["log", "-1", "--format=%an|%ae|%cn|%ce", r.commitSha],
      { cwd: dir, encoding: "utf8" },
    );
    expect(log.status).toBe(0);
    const [an, ae, cn, ce] = log.stdout.trim().split("|");
    expect(an).toBe("Operator Test");
    expect(ae).toBe("operator@example.com");
    expect(cn).toBe("Operator Test");
    expect(ce).toBe("operator@example.com");
  });

  maybeIt("commit is signed (carries gpgsig in raw object — L9)", async () => {
    enableSigning(dir);
    const r = await runRelay({
      cwd: dir,
      threadId: "thread-1",
      type: "DECISIONS",
      inReplyTo: "c".repeat(64),
      body: "body\n",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    // Inspect the raw commit object. A signed commit carries a
    // `gpgsig` header before the commit body.
    const raw = spawnSync("git", ["cat-file", "commit", r.commitSha], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(raw.status).toBe(0);
    expect(raw.stdout).toContain("gpgsig");
    expect(raw.stdout).toContain("BEGIN PGP SIGNATURE");
  });

  maybeIt("stdout contract: nonce + key=value pairs (L14)", async () => {
    enableSigning(dir);
    const outs: string[] = [];
    await runRelay({
      cwd: dir,
      threadId: "thread-1",
      type: "RESPONSE",
      inReplyTo: "d".repeat(64),
      body: "body\n",
      noPush: true,
      stdout: (s) => outs.push(s),
      stderr: () => {},
    });
    const stdout = outs.join("");
    expect(stdout).toMatch(/rig-bridge: relayed/);
    expect(stdout).toMatch(/type=RESPONSE/);
    expect(stdout).toMatch(/thread=thread-1/);
    expect(stdout).toMatch(/file=thread-1\/RELAY-/);
    expect(stdout).toMatch(/commit=[0-9a-f]{7}/);
    expect(stdout).toMatch(/nonce=[0-9A-Z]+-[0-9A-Z]+/);
  });

  maybeIt("body_hash in rendered envelope round-trips against re-computation", async () => {
    enableSigning(dir);
    const body = "# ACK\n\nReceived and acknowledged.\n";
    const r = await runRelay({
      cwd: dir,
      threadId: "thread-1",
      type: "ACK",
      inReplyTo: "e".repeat(64),
      body,
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    const text = readFileSync(r.filePath, "utf8");
    const env = parseEnvelope(text);
    expect(env.frontmatter.body_hash).toBe(r.bodyHash);
    expect(bodyHash(env.body)).toBe(env.frontmatter.body_hash);
  });

  maybeIt("--no-push respected: commit lands locally but is not pushed", async () => {
    enableSigning(dir);
    // No remote configured, so push WOULD fail. --no-push must not
    // attempt the push, which we prove by the absence of any thrown
    // error (a push attempt would throw because origin is unset).
    const r = await runRelay({
      cwd: dir,
      threadId: "thread-1",
      type: "DECISIONS",
      inReplyTo: "f".repeat(64),
      body: "body\n",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    expect(r.commitSha).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("runRelay — internal: nonce shape", () => {
  // The generated nonce must be a single token suitable for filename
  // embedding. On every call the timestamp portion is a 10-char
  // base32-Crockford encoding that sorts lex-asc by attest-time, and
  // the random portion is 10 chars of base32 randomness.
  it("nonce is base32-Crockford with a timestamp prefix and random suffix", async () => {
    if (spawnSync("sh", ["-c", "exit 0"], { encoding: "utf8" }).status !== 0) {
      // Skip when bash unavailable — we can't reach signing.
      return;
    }
    enableSigning(dir);
    const r1 = await runRelay({
      cwd: dir,
      threadId: "thread-1",
      type: "DECISIONS",
      inReplyTo: "0".repeat(64),
      body: "body 1\n",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    // Wait one ms to ensure timestamp difference (the rig clock has
    // ms resolution; without a delay two back-to-back nonces would
    // share a timestamp prefix).
    await new Promise((res) => setTimeout(res, 2));
    const r2 = await runRelay({
      cwd: dir,
      threadId: "thread-1",
      type: "DECISIONS",
      inReplyTo: "1".repeat(64),
      body: "body 2\n",
      noPush: true,
      stdout: () => {},
      stderr: () => {},
    });
    expect(r1.attestation.nonce).not.toBe(r2.attestation.nonce);
    expect(r1.attestation.nonce).toMatch(/^[0-9A-Z]{10}-[0-9A-Z]{10}$/);
    expect(r2.attestation.nonce).toMatch(/^[0-9A-Z]{10}-[0-9A-Z]{10}$/);
    // Lex order should match attest-time order.
    expect(r1.attestation.nonce < r2.attestation.nonce).toBe(true);
  });
});
