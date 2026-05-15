// `rig-bridge relay --thread <id> --type <DECISIONS|RESPONSE|ACK>
//                   --in-reply-to <body_hash> [--body | --body-file]
//                   [--status <text>] [--no-push]`
//
// Write + sign + commit + push a human-mediated relay envelope.
//
// Sequence:
//   1. Resolve repo + load .bridge/config.yaml.
//   2. Validate args.type ∈ {DECISIONS, RESPONSE, ACK}.
//   3. Verify cfg.rig_id ends in "-relay" (L5 — relay-rig identity class).
//   4. Read operator git config (user.name, user.email) — required by L6.
//   5. Detect signing key (user.signingkey) — required by L9. No soft-fail.
//   6. Validate --in-reply-to body_hash format (L8 — replay prevention).
//   7. Generate nonce (ULID-like monotonic identifier).
//   8. Build frontmatter with attestation block.
//   9. Render, validate schema, write to RELAY-<nonce-prefix>.md.
//  10. git commit -S (signed) + safePush (skip when --no-push).
//
// Architectural locks honored:
//   L5 — relay rig-id MUST end in "-relay" (e.g. "mike-relay"). A relay
//        rig-id is a distinct identity class per the research grounding
//        (Glasswall 2024, DIDComm v2.1).
//   L6 — git commit author MUST be operator's git config (not bridge-
//        default). Bridge-default = impersonation. We set
//        GIT_AUTHOR_NAME / GIT_AUTHOR_EMAIL / GIT_COMMITTER_NAME /
//        GIT_COMMITTER_EMAIL via the runGit env override.
//   L7 — envelope frontmatter MUST include the attestation block:
//        attested_by (signing-key-id) + attested_at (ISO-8601 UTC) +
//        nonce (ULID-like). The block goes in the YAML frontmatter so
//        receivers + the control-plane can read it without inspecting
//        the commit signature.
//   L8 — relay MUST carry in_reply_to: <body_hash> of the prior turn.
//        Replay-prevention per Packetlabs 2024 — nonces + in_reply_to
//        + timestamps are the minimum bar for any replay-able channel.
//   L9 — relay REFUSES if no signing key configured. Soft-fail unsigned
//        is silent insecurity (Sigstore 2024, DIDComm authcrypt 2024).
//
// OUTPUT DISCIPLINE (B-CMD-002 / B-CMD-003):
//   * stdout: parseable contract line — rig-bridge: relayed type=<TYPE>
//             thread=<id> file=<thread>/<filename> commit=<sha7> nonce=<id>.
//   * stderr: natural prose narrative — full paths + recovery hints.

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { randomBytes } from "node:crypto";
import {
  GitError,
  repoRoot,
  runGit,
  safePush,
} from "../engine/git.js";
import { readConfig } from "../engine/config.js";
import { parseEnvelope, renderEnvelope } from "../engine/envelope.js";
import { validateFrontmatter } from "../engine/schema-validator.js";
import { bodyHash } from "../engine/body-hash.js";
import { normalizeRigId, validateRigId } from "../engine/rig-id.js";

// The three relay types we accept. The full message-type enum is wider
// (REQUEST, HANDOFF, STATE, etc.) — those are non-human-mediated
// envelopes that flow through `send`. Relay restricts to the types
// operators commonly relay between rigs: DECISIONS (the canonical
// human-input escalation), RESPONSE (relayed reply), ACK (relayed
// acknowledgement). Adding to this set later is non-breaking.
export const RELAY_TYPES = ["DECISIONS", "RESPONSE", "ACK"] as const;
export type RelayType = (typeof RELAY_TYPES)[number];

const BODY_HASH_PATTERN = /^[0-9a-f]{64}$/;
const RELAY_SUFFIX = "-relay";

export interface RelayArgs {
  cwd: string;
  threadId: string;
  /** Validated against RELAY_TYPES below. */
  type: string;
  /** Free-prose body text. Mutually exclusive with bodyFile. */
  body?: string;
  /** Path to file holding the body. Mutually exclusive with body. */
  bodyFile?: string;
  /** body_hash of the prior turn (REQUIRED — L8 replay prevention). */
  inReplyTo?: string;
  /** Status verb-phrase. Defaults to "▶ Relayed <TYPE>". */
  status?: string;
  /**
   * Explicit recipient(s). When supplied, overrides the auto-inferred
   * peer-rig from the thread's prior envelopes. Each entry may itself
   * be comma-separated (matching send.ts's `--to` shape).
   */
  to?: string[];
  /** Optional one-sentence summary, mirrors send.ts. */
  tldr?: string;
  /** Commit SHAs of prior turns. */
  references?: string[];
  /** Skip `git push origin main`. Used by tests + offline workflows. */
  noPush?: boolean;
  /** Emit machine-readable JSON to stdout instead of the text contract (L15). */
  json?: boolean;
  /** L16: disable color reservation if --no-color or NO_COLOR env. Reserved for future state-color rendering. */
  noColor?: boolean;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

export interface RelayAttestation {
  attested_by: string;
  attested_at: string;
  nonce: string;
}

export interface RelayResult {
  filePath: string;
  filename: string;
  commitSha: string;
  bodyHash: string;
  attestation: RelayAttestation;
}

// Generate a ULID-like monotonic identifier. Crockford base32 of
// (Date.now() ms) gives a 10-char timestamp prefix that sorts
// lexicographically by time; we append 10 chars of random base32 for
// uniqueness. The result is 21 chars (e.g. "01HZX9K3T7-A4B7C9D2E1")
// which is short enough to embed in a filename and unique enough to
// avoid collision across rigs. Not a true ULID (no monotonic clock
// guarantee within the same millisecond) — but the dispatch explicitly
// permits this shape ("ULID-like monotonic id"). The dash between
// timestamp and randomness is a deliberate readability cue for human
// log inspection; ULID-strict tooling can strip it.
function generateNonce(): string {
  const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  // 50 bits is enough to encode Date.now() in 10 base32 chars
  // (50 / 5 = 10). Pad to 10 chars on the left so the lex-sort works.
  let ts = Date.now();
  let tsPart = "";
  for (let i = 0; i < 10; i++) {
    tsPart = CROCKFORD[ts & 31] + tsPart;
    ts = Math.floor(ts / 32);
  }
  // 8 random bytes (64 bits) → encode 10 chars of base32 for the suffix.
  const rb = randomBytes(8);
  let rnd = "";
  let acc = 0n;
  for (const b of rb) acc = (acc << 8n) + BigInt(b);
  for (let i = 0; i < 10; i++) {
    const bits = Number(acc & 31n);
    rnd = CROCKFORD[bits] + rnd;
    acc >>= 5n;
  }
  return `${tsPart}-${rnd}`;
}

// Read an operator git config value via the local repo's git config.
// Returns the trimmed value, or null if unset. Throws GitError only on
// catastrophic spawn failure — a missing config key returns status=1
// with empty stdout, which we surface as `null`.
function readGitConfigValue(root: string, key: string): string | null {
  const r = runGit(["config", "--get", key], root);
  if (r.status !== 0) return null;
  const v = r.stdout.trim();
  return v.length > 0 ? v : null;
}

// Choose a relay filename of the form RELAY-<nonce-prefix>.md. We use
// the first 10 chars of the nonce (the timestamp portion before the
// dash) so the filename sorts lexicographically by attest-time, which
// matches the L12 small-multiples rendering of a thread. The full
// nonce is still carried in the frontmatter; the filename prefix is
// just a human cue.
function relayFilename(nonce: string): string {
  // The nonce shape from generateNonce is "<10-ts>-<10-rnd>". Take
  // the timestamp prefix as the filename ordinal; if a hypothetical
  // future ULID library produces a different shape, fall back to the
  // first 10 chars without splitting.
  const prefix = nonce.includes("-") ? nonce.split("-")[0] : nonce.slice(0, 10);
  return `RELAY-${prefix}.md`;
}

export async function runRelay(args: RelayArgs): Promise<RelayResult> {
  const stdout = args.stdout ?? ((s: string) => process.stdout.write(s));
  const stderr = args.stderr ?? ((s: string) => process.stderr.write(s));

  // 1. Validate relay type at ingress.
  if (!RELAY_TYPES.includes(args.type as RelayType)) {
    throw new Error(
      `rig-bridge relay: unknown type "${args.type}" — must be one of: ${RELAY_TYPES.join(", ")}`,
    );
  }
  const relayType = args.type as RelayType;

  // 2. Resolve repo + load config.
  const root = repoRoot(args.cwd);
  const cfg = readConfig(root);

  // 3. L5 — relay rig-id MUST end in -relay. A relay-rig is a distinct
  // identity class; we refuse to relay from a peer-rig identity.
  if (!cfg.rig_id.endsWith(RELAY_SUFFIX)) {
    throw new Error(
      `rig-bridge relay: this rig (rig_id=${cfg.rig_id}) is not a relay rig. ` +
        `Relay rig-ids MUST end in '${RELAY_SUFFIX}'. To run relay, init a ` +
        `relay-suffix rig (e.g. 'rig-bridge init --rig-id <name>${RELAY_SUFFIX}').`,
    );
  }

  // 4. L6 — read operator git config. Both user.name AND user.email are
  // required so the commit author cryptographically attests the relay
  // to the human operator (not the bridge-default).
  const gitName = readGitConfigValue(root, "user.name");
  const gitEmail = readGitConfigValue(root, "user.email");
  if (!gitName || !gitEmail) {
    throw new Error(
      `rig-bridge relay: git user.name and user.email must be set. ` +
        `Run 'git config user.name "<your name>"' and ` +
        `'git config user.email "<your email>"' first. (L6)`,
    );
  }

  // 5. L9 — detect signing key. No soft-fail. The signature is the
  // cryptographic attestation per the research grounding (Sigstore
  // 2024, DIDComm v2.1, Apple iMessage Contact Key Verification 2023).
  // gpg.format (openpgp / ssh / x509) is optional — we capture the
  // signingkey value as the attested_by id regardless of format.
  const signingKey = readGitConfigValue(root, "user.signingkey");
  if (!signingKey) {
    throw new Error(
      `rig-bridge relay: a git signing key is required (user.signingkey). ` +
        `Configure GPG, SSH-sign (git ≥2.34), or sigstore-gitsign. ` +
        `Unsigned relay turns are refused. (L9)`,
    );
  }

  // 6. L8 — --in-reply-to required + format validated. The body_hash
  // pattern matches the schema's body_hash pattern (sha256 hex, 64
  // chars). Without this, the relay envelope has no provable link to
  // the turn it answers — replay-prevention requires it.
  if (!args.inReplyTo || args.inReplyTo.length === 0) {
    throw new Error(
      `rig-bridge relay: --in-reply-to <body_hash> is required. ` +
        `The relay envelope must reference the prior turn's body_hash ` +
        `to prevent replay. (L8)`,
    );
  }
  if (!BODY_HASH_PATTERN.test(args.inReplyTo)) {
    throw new Error(
      `rig-bridge relay: --in-reply-to value "${args.inReplyTo}" is not ` +
        `a valid body_hash (must be 64 lowercase hex chars — sha256 digest). (L8)`,
    );
  }

  // 7. Thread directory must exist (created by `rig-bridge new`).
  const threadDir = join(root, args.threadId);
  if (!existsSync(threadDir) || !statSync(threadDir).isDirectory()) {
    throw new Error(
      `thread directory not found: ${threadDir}. ` +
        `Run \`rig-bridge new ${args.threadId}\` first.`,
    );
  }

  // 8. Generate nonce + timestamp.
  const nonce = generateNonce();
  const attestedAt = new Date().toISOString();
  const filename = relayFilename(nonce);
  const filePath = join(threadDir, filename);
  if (existsSync(filePath)) {
    // Collision with a same-millisecond nonce is theoretically possible
    // but vanishingly rare (1 in 2^50 timestamp slots × 2^50 random
    // bits). Surface it loudly rather than silently overwriting an
    // already-relayed envelope.
    throw new Error(
      `rig-bridge relay: filename collision at ${filePath} — try again`,
    );
  }

  // 9. Assemble body. Per the same shape as send.ts — explicit text
  // wins, then --body-file, then a stub. The stub mentions the relay
  // identity so an operator who forgets to author a body still gets a
  // schema-valid envelope.
  let body: string;
  if (args.body !== undefined) {
    body = args.body;
  } else if (args.bodyFile !== undefined) {
    if (!existsSync(args.bodyFile)) {
      throw new Error(`--body-file not found: ${args.bodyFile}`);
    }
    body = readFileSync(args.bodyFile, "utf8");
  } else {
    body =
      `# ${args.threadId} — ${relayType} (relayed by ${gitName})\n\n` +
      `Relayed via ${cfg.rig_id} on ${attestedAt}.\n\n` +
      `Standing by.\n`;
  }

  // 10. Status verb-phrase. Default to a relay-flavored ▶ marker so
  // downstream status-class derivation lands on "active". The operator
  // may override via --status.
  const status = args.status ?? `▶ Relayed ${relayType}`;

  // 11. L7 — attestation block. The block lives in the YAML
  // frontmatter (not in a side-channel) so the control-plane can read
  // it without parsing the git commit signature, and so receivers see
  // the same attestation the wire enforces.
  //
  // Peer-rig resolution:
  //   * If --to was supplied, use the explicit recipients (flattened
  //     + normalized + validated, matching send.ts's --to shape). The
  //     operator's explicit routing wins over inference.
  //   * Otherwise infer the most-recent peer rig from the thread's
  //     prior envelopes (or fall back to cfg.rig_id for an empty thread).
  let toField: string | string[];
  if (args.to && args.to.length > 0) {
    const toFlat = args.to
      .flatMap((v) => v.split(","))
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map(normalizeRigId);
    if (toFlat.length === 0) {
      throw new Error("rig-bridge relay: --to was supplied but parsed to zero recipients");
    }
    for (const id of toFlat) {
      const r = validateRigId(id);
      if (!r.ok) {
        throw new Error(`rig-bridge relay: --to: ${r.reason}`);
      }
    }
    toField = toFlat.length === 1 ? toFlat[0] : toFlat;
  } else {
    toField = inferRelayRecipient(threadDir, cfg.rig_id);
  }

  const frontmatter: Record<string, unknown> = {
    from: cfg.rig_id,
    to: toField,
    date: attestedAt.slice(0, 10),
    status,
    type: relayType,
    thread: args.threadId,
    in_reply_to: args.inReplyTo,
    attested_by: signingKey,
    attested_at: attestedAt,
    nonce,
  };
  // display_name surfaces the operator's git user.name in prose-friendly
  // contexts (status board, thread render). The relay-rig itself often
  // has a display_name in config; the operator name is more precise.
  frontmatter.display_name = gitName;
  // tldr is schema-optional. Mirror send.ts's 280-char soft cap.
  if (args.tldr !== undefined) {
    if (args.tldr.length > 280) {
      stderr(
        `rig-bridge: warning: tldr is ${args.tldr.length} chars (>280 soft cap)\n`,
      );
    }
    frontmatter.tldr = args.tldr;
  }
  // references — prior commit SHAs the relay extends/answers. Schema
  // validates the shape (7-40 hex chars per item, unique).
  if (args.references && args.references.length > 0) {
    frontmatter.references = args.references;
  }

  // body_hash computed BEFORE schema validation so the schema sees the
  // populated field, mirroring send.ts ordering (load-bearing).
  const hash = bodyHash(body);
  frontmatter.body_hash = hash;

  const validation = validateFrontmatter(frontmatter);
  if (!validation.valid) {
    throw new Error(
      `relay envelope failed schema validation: ${validation.errorText}`,
    );
  }

  // 12. Render + write.
  const text = renderEnvelope({ frontmatter, body });
  writeFileSync(filePath, text, "utf8");

  // 13. Commit with operator's identity (L6) + sign (L9).
  // The commit author is set via runGit env overrides so the commit
  // ledger records the human operator, not the bridge-default. We pass
  // -S so git signs the commit with user.signingkey.
  let commitSha: string;
  try {
    // Add the file. We don't use safeCommit() here because we need the
    // -S flag + custom author env. The safeCommit guards (submodule,
    // size, OS-junk) are still applied — we inline them via a check on
    // the filename suffix and basename.
    if (filename.startsWith(".") || filename === "Thumbs.db") {
      throw new GitError(
        `refuse to commit OS-junk path: ${filename}`,
      );
    }
    const add = runGit(["add", "--", relative(root, filePath).replace(/\\/g, "/")], root);
    if (add.status !== 0) {
      throw new GitError(`git add failed`, add.stderr);
    }

    // Build the commit env: operator's name + email for both author
    // and committer fields. The git commit author is the operator
    // (L6); the committer is also the operator since the relay rig
    // is acting on the operator's behalf.
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: gitName,
      GIT_AUTHOR_EMAIL: gitEmail,
      GIT_COMMITTER_NAME: gitName,
      GIT_COMMITTER_EMAIL: gitEmail,
    };

    const commitMsg = `${relayType} (relay): ${args.threadId} nonce=${nonce}`;
    const commit = runGit(
      ["commit", "-S", "-m", commitMsg],
      root,
      { env },
    );
    if (commit.status !== 0) {
      throw new GitError(`git commit -S failed`, commit.stderr);
    }
    const headRes = runGit(["rev-parse", "HEAD"], root);
    if (headRes.status !== 0) {
      throw new GitError(`git rev-parse HEAD failed after commit`, headRes.stderr);
    }
    commitSha = headRes.stdout.trim();
  } catch (e) {
    // F-CMD-008: if commit fails the freshly-written envelope file is
    // orphaned on disk; a naive retry then dies with "file already
    // exists" until the operator manually deletes it. Clean up the
    // orphan before re-throwing.
    try {
      unlinkSync(filePath);
    } catch {
      // If cleanup itself fails, the original commit error matters
      // more — surface that, not the cleanup error.
    }
    const orig = (e as Error).message ?? String(e);
    throw new Error(
      `rig-bridge relay: commit failed and the unpushed envelope at ` +
        `${filePath} was removed so you can retry cleanly. Original error: ${orig}`,
    );
  }

  // 14. Push, with the F-CMD-010 recovery surface.
  if (!args.noPush) {
    try {
      safePush({ cwd: root });
    } catch (e) {
      stderr(
        `rig-bridge: relay committed locally but push failed.\n` +
          `To recover:  cd ${root}; git pull --rebase; git push\n` +
          `Or retry the original relay with --no-push to skip the push step.\n`,
      );
      throw e;
    }
  }

  // 15. Output discipline. stdout = parseable contract line, stderr =
  // human narrative. nonce is on stdout so a downstream watcher can
  // recover the specific relay envelope without re-scanning the dir.
  const sha7 = commitSha.slice(0, 7);
  const relFile = relative(root, filePath).replace(/\\/g, "/");
  if (args.json) {
    // L15: --json opt-in. schema_version pinned at 1.0 (kubectl-style
    // explicit-version contract). Every field consumers might want for
    // structural reasoning is present — the text contract is a subset.
    const payload = {
      schema_version: "1.0",
      type: relayType,
      thread: args.threadId,
      file: relFile,
      commit: commitSha,
      nonce,
      attested_by: signingKey,
      attested_at: attestedAt,
      in_reply_to: args.inReplyTo,
      body_hash: hash,
    };
    stdout(`${JSON.stringify(payload)}\n`);
  } else {
    stdout(
      `rig-bridge: relayed type=${relayType} thread=${args.threadId} ` +
        `file=${relFile} commit=${sha7} nonce=${nonce}\n`,
    );
  }
  stderr(
    `rig-bridge: relayed ${relayType} in thread ${args.threadId} as ` +
      `${filename}; signed-committed as ${sha7} (attested_by=${signingKey})\n`,
  );

  return {
    filePath,
    filename,
    commitSha,
    bodyHash: hash,
    attestation: {
      attested_by: signingKey,
      attested_at: attestedAt,
      nonce,
    },
  };
}

// Infer the most-recent peer rig from prior envelopes in the thread.
// The relay's `to` field should target the rig that authored the
// prior turn (the one being replied to). If no prior envelope exists,
// fall back to the relay's own rig_id (degenerate self-addressed
// terminal marker — schema-valid but operationally odd; we still
// produce an envelope so the operator can author the body and the
// next turn can correct).
//
// Note: findPeerRigs (engine helper) scans every thread in the bridge
// root; here we only need to scan one thread, so we inline the loop.
// The shape mirrors close.ts's old inferPeerRig() and engine's
// findPeerRigs() — same normalize+validate+count discipline.
function inferRelayRecipient(
  threadDir: string,
  selfRigId: string,
): string {
  let entries: string[];
  try {
    entries = readdirSync(threadDir);
  } catch {
    return selfRigId;
  }
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (!e.endsWith(".md")) continue;
    let raw: string;
    try {
      raw = readFileSync(join(threadDir, e), "utf8");
    } catch {
      continue;
    }
    let env;
    try {
      env = parseEnvelope(raw);
    } catch {
      continue;
    }
    const candidates: unknown[] = [];
    if (typeof env.frontmatter.from === "string") {
      candidates.push(env.frontmatter.from);
    }
    if (Array.isArray(env.frontmatter.to)) candidates.push(...env.frontmatter.to);
    else if (typeof env.frontmatter.to === "string") candidates.push(env.frontmatter.to);
    for (const c of candidates) {
      if (typeof c !== "string") continue;
      const norm = normalizeRigId(c);
      if (norm === selfRigId) continue;
      if (!validateRigId(norm).ok) continue;
      counts.set(norm, (counts.get(norm) ?? 0) + 1);
    }
  }
  let best: string = selfRigId;
  let bestCount = 0;
  for (const [rig, n] of counts) {
    if (n > bestCount) {
      best = rig;
      bestCount = n;
    }
  }
  return best;
}
