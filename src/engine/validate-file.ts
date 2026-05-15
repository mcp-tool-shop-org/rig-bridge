// validateEnvelopeFile — multi-error-collecting validation of an
// on-disk envelope file. Combines four checks in one pass:
//
//   1. parseEnvelope (frontmatter + body extraction, §4.1 normalization)
//   2. validateFrontmatter (Ajv schema check against
//      schemas/bridge-message.schema.json)
//   3. verifyHash (body_hash matches re-computed bodyHash)
//   4. validateRigId on `from` and each `to` recipient
//
// Phase 7's `sync` command uses this to vet every incoming envelope at
// the boundary before committing the pull. A future `rig-bridge
// validate <path>` CLI command (out of scope for v1.0.0; on the v1.1
// roadmap) would also call this helper.
//
// The contract is "collect everything that's wrong" — we do NOT bail
// on the first error. Reason: an operator looking at a stale envelope
// wants to see every problem at once (4 errors in one render pass
// beats whack-a-mole across 4 sync attempts). The single exception is
// a parse failure: if parseEnvelope throws, schema validation is moot
// (there's nothing to validate against), so we surface only the parse
// error in that case.

import { readFileSync } from "node:fs";
import { bodyHash } from "./body-hash.js";
import {
  EnvelopeParseError,
  parseEnvelope,
  type Envelope,
} from "./envelope.js";
import { validateRigId } from "./rig-id.js";
import { validateFrontmatter } from "./schema-validator.js";

// Public shape — matches the dispatch contract verbatim so commands
// can rely on the discriminated-union for catch-blocks.
export interface AjvErrorText {
  message: string;
}

export type ValidationError =
  | { kind: "parse_failed"; message: string }
  | { kind: "schema_invalid"; errors: AjvErrorText[] }
  | { kind: "body_hash_mismatch"; expected: string; actual: string }
  | {
      kind: "rig_id_invalid";
      field: "from" | "to";
      value: string;
      suggestion?: string;
    };

export type ValidationWarning =
  | { kind: "body_hash_absent"; message: string }
  | { kind: "tldr_too_long"; length: number; cap: 280 };

export interface ParsedEnvelope {
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface ValidationReport {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  envelope?: ParsedEnvelope;
}

// tldr cap mirrors the cap used by `send.ts` for stderr warnings —
// 280 chars (decision #1 in the send-command surface). We surface it
// as a warning, not an error, because the schema does not enforce the
// cap on the wire (it's a discipline knob, not a contract).
const TLDR_CAP = 280;

export function validateEnvelopeFile(
  envelopePath: string,
): ValidationReport {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Read the file. I/O errors propagate — the caller knows whether
  // the file was supposed to exist (otherwise sync would not be
  // attempting to validate it).
  const raw = readFileSync(envelopePath, "utf8");

  let env: Envelope;
  try {
    env = parseEnvelope(raw);
  } catch (e) {
    const msg =
      e instanceof EnvelopeParseError ? e.message : (e as Error).message;
    return {
      valid: false,
      errors: [{ kind: "parse_failed", message: msg }],
      warnings: [],
    };
  }

  const parsed: ParsedEnvelope = {
    frontmatter: env.frontmatter,
    body: env.body,
  };

  // 1. Schema validation. Ajv collects all errors (allErrors: true is
  // set in schema-validator.ts) — we map them to AjvErrorText[].
  const v = validateFrontmatter(env.frontmatter);
  if (!v.valid && v.errors) {
    errors.push({
      kind: "schema_invalid",
      errors: v.errors.map((e) => ({
        message: `${e.instancePath || "/"} ${e.message ?? ""}`.trim(),
      })),
    });
  }

  // 2. body_hash verification (skipped if frontmatter omits it — we
  // surface that as a WARNING, not an error, because §4.1 makes the
  // field schema-optional even though canonical wire envelopes carry
  // it. A pre-v1.0.0 corpus message without body_hash is "lossy" but
  // not "invalid").
  const fmHash = env.frontmatter.body_hash;
  if (typeof fmHash === "string" && fmHash.length > 0) {
    const actual = bodyHash(env.body);
    if (fmHash !== actual) {
      errors.push({
        kind: "body_hash_mismatch",
        expected: fmHash,
        actual,
      });
    }
  } else {
    warnings.push({
      kind: "body_hash_absent",
      message:
        "envelope has no body_hash in frontmatter; receivers cannot verify drift",
    });
  }

  // 3. rig-id validation on from + each to. We collect ONE
  // rig_id_invalid per offending value so the report enumerates each
  // bad id by name + field. Suggestion lifted from validateRigId's
  // existing "Did you mean …?" surface when present.
  const fromVal = env.frontmatter.from;
  if (typeof fromVal === "string") {
    const fr = validateRigId(fromVal);
    if (!fr.ok) {
      const m = /Did you mean "([^"]+)"\?/.exec(fr.reason);
      errors.push({
        kind: "rig_id_invalid",
        field: "from",
        value: fromVal,
        ...(m ? { suggestion: m[1] } : {}),
      });
    }
  }
  const toVal = env.frontmatter.to;
  const toCandidates: string[] = [];
  if (typeof toVal === "string") toCandidates.push(toVal);
  else if (Array.isArray(toVal)) {
    for (const x of toVal) {
      if (typeof x === "string") toCandidates.push(x);
    }
  }
  for (const t of toCandidates) {
    const tr = validateRigId(t);
    if (!tr.ok) {
      const m = /Did you mean "([^"]+)"\?/.exec(tr.reason);
      errors.push({
        kind: "rig_id_invalid",
        field: "to",
        value: t,
        ...(m ? { suggestion: m[1] } : {}),
      });
    }
  }

  // 4. tldr length warning. Schema does not enforce a cap, but the
  // send command warns at 280 chars; mirror that here so a validate
  // command surfaces the same operator hint.
  const tldr = env.frontmatter.tldr;
  if (typeof tldr === "string" && tldr.length > TLDR_CAP) {
    warnings.push({ kind: "tldr_too_long", length: tldr.length, cap: 280 });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    envelope: parsed,
  };
}
