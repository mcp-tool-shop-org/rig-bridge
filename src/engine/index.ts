// rig-bridge engine — v1.1 control-plane consumer surface.
//
// This module is the stable, public engine API for rig-bridge. External
// consumers (control-plane writers, future status-class derivers, the
// planned `@mcptoolshop/rig-bridge-engine` package extraction) import from
// this single entry point rather than reaching into individual modules:
//
//   import { bodyHash, normalizeRigId, parseEnvelope } from
//     "@mcptoolshop/rig-bridge/engine";
//
// What ships here is the v1.0 engine's pure-function surface plus the few
// classes (errors, config types) callers need to do precise catch-blocks.
// Phase 7 (sync/status/thread/relay) added five additional helpers
// (listThreads, findPeerRigs, gitDiffSinceLastSync, verifyHash,
// validateEnvelopeFile) that the Phase 7 commands compose to deliver
// their surface — those are re-exported here too.
//
// Nothing in this file should ever import from src/cli.ts or
// src/commands/* — engine helpers are framework-agnostic and must remain
// usable from a worker, a test harness, or a downstream tool with no CLI
// context. If you find yourself wanting to re-export a CLI helper here,
// that helper belongs in engine/ first.
//
// Stability contract: every export below is part of the v1.1 readiness
// surface. Renames or signature changes are breaking. Add-only is the
// rule until v2.

// body-hash — canonical §4.1 normalization + sha256 over the envelope body.
export { bodyHash, normalizeBody } from "./body-hash.js";

// envelope — frontmatter+body parse/render with the §4.1 contract.
export { parseEnvelope, renderEnvelope, EnvelopeParseError } from "./envelope.js";
export type { Envelope } from "./envelope.js";

// rig-id — canonical rig-identifier validation + the case-normalize helper
// commands compose at ingress to auto-fix operator typos.
export { validateRigId, normalizeRigId, assertRigId } from "./rig-id.js";
export type { RigIdResult } from "./rig-id.js";

// status — envelope-marker → status_class lookup for v1.1 CP integration.
export {
  markerToStatusClass,
  isSupportedMarker,
  SUPPORTED_MARKERS,
  UnrecognizedMarkerError,
} from "./status.js";
export type { StatusClass } from "./status.js";

// schema-validator — Ajv-backed validateFrontmatter at the wire boundary.
export { validateFrontmatter } from "./schema-validator.js";
export type { ValidationResult } from "./schema-validator.js";

// config — .bridge/config.yaml read/write.
export {
  readConfig,
  writeConfig,
  configPath,
  BRIDGE_DIR,
  CONFIG_FILENAME,
  ConfigError,
} from "./config.js";
export type { BridgeConfig } from "./config.js";

// Phase 7 helpers — composable building blocks the four new commands
// (status, thread, sync, relay) and v1.1 control-plane consumers use.
// Each helper is a pure-ish function; none of them mutate the working
// tree or push to remotes. See Phase 7 architectural locks L1-L16 in
// docs/phase7-research-grounding.md for the design constraints these
// helpers honor.

// threads — per-thread directory-scan summaries (L10 ordering, L12 shape).
export { listThreads } from "./threads.js";
export type { ThreadSummary, EnvelopeRef } from "./threads.js";

// peer-rigs — discover non-self counterpart rig-ids across the bridge.
export { findPeerRigs } from "./peer-rigs.js";
export type { RigCount } from "./peer-rigs.js";

// git-diff — read-only local-vs-remote inspection for `sync` (L1, L2, L4).
export { gitDiffSinceLastSync } from "./git-diff.js";
export type { SyncDiff, NewEnvelope, ChangedEnvelope } from "./git-diff.js";

// verify-hash — receiver-side body_hash check.
export { verifyHash } from "./verify-hash.js";
export type { VerifyResult } from "./verify-hash.js";

// validate-file — multi-error-collecting envelope file validation.
export { validateEnvelopeFile } from "./validate-file.js";
export type {
  ValidationReport,
  ValidationError,
  ValidationWarning,
  ParsedEnvelope,
  AjvErrorText,
} from "./validate-file.js";
