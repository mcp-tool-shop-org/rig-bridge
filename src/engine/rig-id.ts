// Canonical rig-identifier validation.
//
// Per docs/envelope-spec.md §3.4: rig identifiers are kebab-case slugs that
// start with a lowercase letter and contain only [a-z0-9-]. The schema
// enforces this on the wire, but the CLI validates at every entrypoint that
// accepts a rig id (init's --rig-id, send's --to, config load) so users get
// a clear error before any file write / commit / push.

const RIG_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export type RigIdResult =
  | { ok: true }
  | { ok: false; reason: string };

// Pure normalization: trim outer whitespace + lowercase. No validation —
// just produces the canonical form for ingress points to suggest. The
// composition (normalize-then-validate) is deliberately the caller's
// choice so the helpers stay independently testable and reusable.
//
// Per B-ENG-003: validateRigId stays a pure predicate; the helper is
// available for Commands-layer ingress to compose into a real auto-fix.
export function normalizeRigId(s: string): string {
  return s.trim().toLowerCase();
}

export function validateRigId(id: unknown): RigIdResult {
  if (typeof id !== "string") {
    return { ok: false, reason: "rig id must be a string" };
  }
  if (id.length === 0) {
    return { ok: false, reason: "rig id must not be empty" };
  }
  if (!RIG_ID_PATTERN.test(id)) {
    // Build the base failure reason, then offer a suggestion if the
    // normalized form (trim + lowercase) would itself validate. The
    // suggestion is informational only — validateRigId does NOT call
    // normalizeRigId on the input; that auto-fix is the caller's call.
    const base =
      `rig id "${id}" is not a canonical kebab-case slug ` +
      `(must match /^[a-z][a-z0-9-]*$/ — start with a letter, ` +
      `lowercase letters/digits/hyphens only)`;
    const normalized = normalizeRigId(id);
    if (normalized !== id && RIG_ID_PATTERN.test(normalized)) {
      return {
        ok: false,
        reason: `${base}. Did you mean "${normalized}"?`,
      };
    }
    return { ok: false, reason: base };
  }
  return { ok: true };
}

// Convenience throw-on-fail wrapper for hot paths that have already
// reported the structured result (or for tests).
export function assertRigId(id: unknown, label = "rig id"): string {
  const r = validateRigId(id);
  if (!r.ok) {
    throw new Error(`${label}: ${r.reason}`);
  }
  return id as string;
}
