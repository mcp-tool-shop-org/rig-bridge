// Ajv-based validator for the envelope frontmatter.
//
// Loads schemas/bridge-message.schema.json once at module load. Returns a
// human-readable error string on failure so the CLI can surface a clear
// message rather than a buried stack trace.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));

// src/engine/schema-validator.ts → schemas/bridge-message.schema.json
// (engine → src → repo-root → schemas)
const SCHEMA_PATH = resolve(
  __dirname,
  "..",
  "..",
  "schemas",
  "bridge-message.schema.json",
);

let cachedValidator: ValidateFunction | undefined;
let cachedAjv: Ajv2020 | undefined;

function getValidator(): { validate: ValidateFunction; ajv: Ajv2020 } {
  if (!cachedValidator || !cachedAjv) {
    const schemaText = readFileSync(SCHEMA_PATH, "utf8");
    const schema = JSON.parse(schemaText);
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    cachedAjv = ajv;
    cachedValidator = ajv.compile(schema);
  }
  return { validate: cachedValidator, ajv: cachedAjv };
}

export interface ValidationResult {
  valid: boolean;
  errors?: ErrorObject[] | null;
  errorText?: string;
}

export function validateFrontmatter(obj: unknown): ValidationResult {
  const { validate, ajv } = getValidator();
  const valid = validate(obj);
  if (valid) return { valid: true };
  return {
    valid: false,
    errors: validate.errors,
    errorText: ajv.errorsText(validate.errors),
  };
}
