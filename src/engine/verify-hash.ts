// verifyHash — read an envelope file from disk and check that the
// body_hash in its frontmatter matches a freshly-computed bodyHash() of
// the (parsed) body.
//
// This is the receiver side of the body_hash contract described in
// docs/control-plane-integration.md §4.1: every wire envelope carries
// a sha256-of-§4.1-normalized-body, and on receipt the consumer re-hashes
// the body to detect drift. If the frontmatter's body_hash is missing or
// does not match the re-computed hash, the envelope has been edited in
// transit or its sender's editor introduced drift the §4.1 normalization
// didn't catch.
//
// Phase 7 commands `sync` (vetting incoming envelopes) and `thread` (when
// rendering an envelope's body it can also surface a "hash mismatch"
// warning) use this helper. It is a pure function over the file at
// `envelopePath`: it does not write, mutate, or recursively walk.

import { readFileSync } from "node:fs";
import { bodyHash } from "./body-hash.js";
import { parseEnvelope } from "./envelope.js";

export interface VerifyResult {
  ok: boolean;
  expected: string | null; // body_hash from frontmatter, if present
  actual: string; // re-computed bodyHash of the (normalized) body
  reason?: "no_body_hash_in_frontmatter" | "body_hash_mismatch";
}

export function verifyHash(envelopePath: string): VerifyResult {
  const raw = readFileSync(envelopePath, "utf8");
  const env = parseEnvelope(raw);
  // parseEnvelope already normalizes the body per §4.1 (see envelope.ts)
  // so bodyHash(env.body) produces exactly the same value the sender
  // computed at send time.
  const actual = bodyHash(env.body);
  const fmHash = env.frontmatter.body_hash;
  if (typeof fmHash !== "string" || fmHash.length === 0) {
    return {
      ok: false,
      expected: null,
      actual,
      reason: "no_body_hash_in_frontmatter",
    };
  }
  if (fmHash !== actual) {
    return {
      ok: false,
      expected: fmHash,
      actual,
      reason: "body_hash_mismatch",
    };
  }
  return { ok: true, expected: fmHash, actual };
}
