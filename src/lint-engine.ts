// src/lint-engine.ts
// Forge lint engine.
//
// Port of Invoke-VaultLint.ps1 — validates all vault markdown files
// against schema.md rules. Read-only — never modifies files.
//
// Rules implemented (matching PowerShell source exactly):
//   no_frontmatter         — file has no frontmatter block
//   required_field         — required field missing
//   enum_value             — field value not in allowed enum list
//   date_format            — date field doesn't match yyyy-MM-dd
//   stale_date             — date field exceeds stale_after_days
//   type_mismatch          — field value is wrong type
//   tag_namespace          — tag has no namespace (no slash)
//   unknown_tag_namespace  — tag namespace not in allowed_namespaces
//   required_when          — field required when another field has a value
//   forbidden_when         — field forbidden when another field has a value
//   tag_consistency        — field value should have matching tag
//   invalid_shape_ref    — patterns field references unknown pattern
//   inline_is_schema_field — inline metadata key matches a schema field
//   inline_fuzzy_schema    — inline key looks like a typo of a schema field
//   inline_fuzzy_inline    — inline key looks like a typo of a known inline field
//   inline_undocumented    — inline key not in schema inline_fields list
//   stale_note             — note's review cycle has elapsed

import { App, TFile } from "obsidian";
import type { ForgeSettings } from "./settings";
import { getVaultPaths } from "./vault-paths";
import { VaultSchema, SchemaField, loadSchema } from "./utils/schema";
import { getTags } from "./utils/tags";
import { buildExemptList, localTimestamp, getMarkdownFiles, isExempt, safeTimestamp, todayString } from "./utils/files";
import { readNote, isFieldPresent, getFmString } from "./utils/frontmatter";
import { ensureFolder } from "./utils/files";

// ── Types ────────────────────────────────────────────────────────────────────

export type LintSeverity = "error" | "warning" | "info";

export interface LintResult {
  file: string;
  severity: LintSeverity;
  rule: string;
  message: string;
}

export interface LintRunEnvelope {
  vault_path: string;
  timestamp: string;
  schema_version: string;
  notes_scanned: number;
}

export interface LintRunResult {
  envelope: LintRunEnvelope;
  results: LintResult[];
  errors: LintResult[];
  warnings: LintResult[];
  infos: LintResult[];
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Runs the full vault lint pass.
 * Read-only — never modifies files.
 */
export async function runLint(
  app: App,
  settings: ForgeSettings
): Promise<LintRunResult | null> {
  const schema = await loadSchema(app, settings);
  if (!schema) return null;

  const paths = getVaultPaths(settings);
  const exemptPaths = buildExemptList(schema.exempt_paths, paths.forge);


  const allFiles = getMarkdownFiles(app).filter(
    (f) => !isExempt(f.path, exemptPaths)
  );

  // Load valid pattern names for pattern field validation
  const validShapes = getValidShapeNames(app, paths.shapes);

  const allResults: LintResult[] = [];

  for (const file of allFiles) {
    const fileResults = await lintFile(app, file, schema, validShapes, settings);
    allResults.push(...fileResults);
  }

  // Stale note review — runs after per-file lint, uses settings not schema
  if (settings.staleReviewEnabled &&
      settings.staleReviewCycleField &&
      settings.staleReviewUpdatedField) {
    const staleResults = await runStaleReview(app, allFiles, settings);
    allResults.push(...staleResults);
  }

  const envelope: LintRunEnvelope = {
    vault_path: (app.vault.adapter as any).basePath ?? "",
    timestamp: localTimestamp(),
    schema_version: schema.meta.version,
    notes_scanned: allFiles.length,
  };

  return {
    envelope,
    results: allResults,
    errors:   allResults.filter((r) => r.severity === "error"),
    warnings: allResults.filter((r) => r.severity === "warning"),
    infos:    allResults.filter((r) => r.severity === "info"),
  };
}

// ── Per-file lint ────────────────────────────────────────────────────────────

async function lintFile(
  app: App,
  file: TFile,
  schema: VaultSchema,
  validShapes: string[],
  settings: ForgeSettings
): Promise<LintResult[]> {
  const note = await readNote(app, file);
  const results: LintResult[] = [];

  // No frontmatter
  if (!note || !note.hasFrontmatter) {
    results.push(newResult(file.path, "error", "no_frontmatter", "No frontmatter block found"));
    return results;
  }

  const fm = note.frontmatter;
  const content = await app.vault.read(file);

  // Required fields
  results.push(...testRequiredFields(file.path, fm, schema.required_fields));
  results.push(...testBasicTypeFields(file.path, fm, schema.required_fields));
  results.push(...testEnumFields(file.path, fm, schema.required_fields));
  results.push(...testDateFields(file.path, fm, schema.required_fields));
  results.push(...testConditionalRules(file.path, fm, schema.required_fields));
  results.push(...testFieldTagConsistency(file.path, fm, schema.required_fields));

  // Optional fields — validate only if present
  const optFields = schema.optional_fields.filter((f) => isFieldPresent(fm, f.name));
  results.push(...testBasicTypeFields(file.path, fm, optFields));
  results.push(...testEnumFields(file.path, fm, optFields));
  results.push(...testDateFields(file.path, fm, optFields));
  results.push(...testConditionalRules(file.path, fm, optFields));
  results.push(...testPatternFieldValues(file.path, fm, optFields, validShapes));

  // Tag namespace rules
  results.push(...testTagNamespaces(file.path, fm, schema));

  // Inline metadata
  if (settings.lintInlineMetadata) {
    results.push(...testInlineMetadata(file.path, content, schema));
  }

  return results;
}

// ── Rule implementations ─────────────────────────────────────────────────────

function testRequiredFields(
  path: string,
  fm: Record<string, unknown>,
  fields: SchemaField[]
): LintResult[] {
  return fields
    .filter((f) => !isFieldPresent(fm, f.name))
    .map((f) =>
      newResult(path, f.severity, "required_field", `Missing required field: '${f.name}'`)
    );
}

function testBasicTypeFields(
  path: string,
  fm: Record<string, unknown>,
  fields: SchemaField[]
): LintResult[] {
  const results: LintResult[] = [];

  for (const field of fields) {
    if (!isFieldPresent(fm, field.name)) continue;
    const val = fm[field.name];

    switch (field.type) {
      case "string":
        if (typeof val !== "string") {
          results.push(newResult(path, field.severity, "type_mismatch",
            `Field '${field.name}' must be a string`));
        }
        break;
      case "boolean":
        if (typeof val !== "boolean") {
          results.push(newResult(path, field.severity, "type_mismatch",
            `Field '${field.name}' must be a boolean`));
        }
        break;
      case "list":
        if (!Array.isArray(val)) {
          results.push(newResult(path, field.severity, "type_mismatch",
            `Field '${field.name}' must be a list`));
        }
        break;
      case "version":
        if (typeof val !== "string" && typeof val !== "number") {
          results.push(newResult(path, field.severity, "type_mismatch",
            `Field '${field.name}' must be a version string or number`));
        }
        break;
    }
  }

  return results;
}

function testEnumFields(
  path: string,
  fm: Record<string, unknown>,
  fields: SchemaField[]
): LintResult[] {
  const results: LintResult[] = [];

  for (const field of fields) {
    if (field.type !== "enum") continue;
    if (!isFieldPresent(fm, field.name)) continue;
    if (!field.values) continue;

    const val = String(fm[field.name]);
    if (!field.values.includes(val)) {
      results.push(newResult(path, field.severity, "enum_value",
        `Field '${field.name}' value '${val}' not allowed. Valid: ${field.values.join(", ")}`));
    }
  }

  return results;
}

function testDateFields(
  path: string,
  fm: Record<string, unknown>,
  fields: SchemaField[]
): LintResult[] {
  const results: LintResult[] = [];
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  for (const field of fields) {
    if (field.type !== "date") continue;
    if (!isFieldPresent(fm, field.name)) continue;

    const val = String(fm[field.name]);

    if (!dateRegex.test(val) || isNaN(Date.parse(val))) {
      results.push(newResult(path, field.severity, "date_format",
        `Field '${field.name}' value '${val}' does not match format yyyy-MM-dd`));
      continue;
    }

    if (field.stale_after_days) {
      const parsed = new Date(val);
      const ageDays = (Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > field.stale_after_days) {
        results.push(newResult(path, "warning", "stale_date",
          `Field '${field.name}' is ${Math.floor(ageDays)} days old (threshold: ${field.stale_after_days} days)`));
      }
    }
  }

  return results;
}

function testConditionalRules(
  path: string,
  fm: Record<string, unknown>,
  fields: SchemaField[]
): LintResult[] {
  const results: LintResult[] = [];

  for (const field of fields) {
    if (!field.lint_rules?.length) continue;
    const fieldPresent = isFieldPresent(fm, field.name);

    for (const rule of field.lint_rules) {
      if (!rule.field) continue;
      if (!isFieldPresent(fm, rule.field)) continue;

      const driverVal = String(fm[rule.field]);
      const severity = rule.severity ?? "warning";

      if (rule.rule === "required_when") {
        const matchEquals = rule.equals?.includes(driverVal) ?? false;
        if (matchEquals && !fieldPresent) {
          results.push(newResult(path, severity, "required_when",
            `Field '${field.name}' is required when '${rule.field}' = '${driverVal}'`));
        }
      }

      if (rule.rule === "forbidden_when") {
        const matchNotEquals = rule.not_equals
          ? !rule.not_equals.includes(driverVal)
          : false;
        const matchEquals = rule.equals?.includes(driverVal) ?? false;

        if ((matchNotEquals || matchEquals) && fieldPresent) {
          const label = rule.not_equals
            ? `not one of: ${rule.not_equals.join(", ")}`
            : `= '${driverVal}'`;
          results.push(newResult(path, severity, "forbidden_when",
            `Field '${field.name}' should not be present when '${rule.field}' is ${label}`));
        }
      }
    }
  }

  return results;
}

function testFieldTagConsistency(
  path: string,
  fm: Record<string, unknown>,
  fields: SchemaField[]
): LintResult[] {
  const results: LintResult[] = [];
  const tags = getTags(fm);

  for (const field of fields) {
    if (!field.lint_rules?.length) continue;

    for (const rule of field.lint_rules) {
      if (rule.rule !== "tag_consistency") continue;
      if (!rule.tag_namespace) continue;
      if (!isFieldPresent(fm, field.name)) continue;

      const fieldVal = String(fm[field.name]).toLowerCase();
      const ns = rule.tag_namespace;
      const expected = `${ns}/${fieldVal}`;
      const nsTags = tags.filter((t) => t.startsWith(`${ns}/`));

      if (nsTags.length === 0) {
        results.push(newResult(path, rule.severity ?? "warning", "tag_consistency",
          `Field '${field.name}' = '${fieldVal}' but no '${ns}/*' tag found. Expected: ${expected}`));
      } else if (!tags.includes(expected)) {
        results.push(newResult(path, rule.severity ?? "warning", "tag_consistency",
          `Field '${field.name}' = '${fieldVal}' but tag '${expected}' missing. Found: ${nsTags.join(", ")}`));
      }
    }
  }

  return results;
}

function testPatternFieldValues(
  path: string,
  fm: Record<string, unknown>,
  fields: SchemaField[],
  validShapes: string[]
): LintResult[] {
  const results: LintResult[] = [];
  const patternField = fields.find((f) => f.name === "shapes");
  if (!patternField) return results;
  if (!isFieldPresent(fm, "shapes")) return results;

  const raw = fm["shapes"];
  const list = Array.isArray(raw) ? raw : [raw];
  const validSet = new Set(validShapes.map((p) => p.toLowerCase()));

  for (const item of list) {
    if (item === null || item === undefined) continue;
    const val = String(item).trim();
    if (!val) continue;

    if (!validSet.has(val.toLowerCase())) {
      results.push(newResult(path, patternField.severity, "invalid_shape_ref",
        `Field 'shapes' contains '${val}', which is not a valid pattern in System/Shapes/`));
    }
  }

  return results;
}

function testTagNamespaces(
  path: string,
  fm: Record<string, unknown>,
  schema: VaultSchema
): LintResult[] {
  const results: LintResult[] = [];
  const tags = getTags(fm);
  const { tag_rules } = schema;
  const allowedNs = new Set(tag_rules.allowed_namespaces);

  for (const tag of tags) {
    const slashIdx = tag.indexOf("/");

    if (slashIdx < 0) {
      results.push(newResult(path, tag_rules.severity, "tag_namespace",
        `Tag '${tag}' is not namespaced. Expected format: namespace/tag`));
      continue;
    }

    const ns = tag.substring(0, slashIdx);
    if (tag_rules.unknown_tags !== "off" && !allowedNs.has(ns)) {
      results.push(newResult(path, "warning", "unknown_tag_namespace",
        `Tag namespace '${ns}' is not in allowed_namespaces`));
    }
  }

  return results;
}

// ── Inline metadata rules ────────────────────────────────────────────────────

function testInlineMetadata(
  path: string,
  content: string,
  schema: VaultSchema
): LintResult[] {
  const results: LintResult[] = [];
  const entries = extractInlineMetadataKeys(content);

  const schemaFieldNames = new Set([
    ...schema.required_fields.map((f) => f.name.toLowerCase()),
    ...schema.optional_fields.map((f) => f.name.toLowerCase()),
  ]);

  const inlineFieldNames = new Set(
    schema.inline_fields.map((f) => f.toLowerCase())
  );

  const allSchemaNames = [...schemaFieldNames];
  const allInlineNames = [...inlineFieldNames];
  const seen = new Set<string>();

  for (const entry of entries) {
    const dedupeKey = `${path}|${entry.key}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const keyLower = entry.key.toLowerCase();

    // ERROR — exact match to a schema frontmatter field
    if (schemaFieldNames.has(keyLower)) {
      results.push(newResult(path, "error", "inline_is_schema_field",
        `Inline key '${entry.key}' is a schema frontmatter field — move to frontmatter (line ${entry.line})`));
      continue;
    }

    // SKIP — known inline field
    if (inlineFieldNames.has(keyLower)) continue;

    // WARNING — fuzzy match to schema field (likely typo)
    const [schemaDist, schemaMatch] = closestMatch(entry.key, allSchemaNames, 2);
    if (schemaDist <= 2 && schemaDist > 0) {
      results.push(newResult(path, "warning", "inline_fuzzy_schema",
        `Inline key '${entry.key}' looks like a typo of schema field '${schemaMatch}' (distance ${schemaDist}, line ${entry.line})`));
      continue;
    }

    // WARNING — fuzzy match to known inline field
    const [inlineDist, inlineMatch] = closestMatch(entry.key, allInlineNames, 2);
    if (inlineDist <= 2 && inlineDist > 0) {
      results.push(newResult(path, "warning", "inline_fuzzy_inline",
        `Inline key '${entry.key}' looks like a typo of inline field '${inlineMatch}' (distance ${inlineDist}, line ${entry.line})`));
      continue;
    }

    // INFO — undocumented inline key
    results.push(newResult(path, "info", "inline_undocumented",
      `Inline key '${entry.key}' is undocumented — consider adding to inline_fields in schema.md (line ${entry.line})`));
  }

  return results;
}

interface InlineEntry {
  key: string;
  line: number;
}

/**
 * Extracts key:: value patterns from note body (excluding frontmatter and fenced blocks).
 * Port of Get-InlineMetadataKeys from Invoke-VaultLint.ps1.
 */
function extractInlineMetadataKeys(content: string): InlineEntry[] {
  const results: InlineEntry[] = [];
  const lines = content.split(/\r?\n/);
  const inlinePattern = /^>?\s*([A-Za-z_][A-Za-z0-9_-]*)::\s*\S/;

  let inFrontmatter = false;
  let inFence = false;
  let lineNum = 0;

  for (const line of lines) {
    lineNum++;

    // Frontmatter detection
    if (lineNum === 1 && /^---\s*$/.test(line)) { inFrontmatter = true; continue; }
    if (inFrontmatter && /^---\s*$/.test(line)) { inFrontmatter = false; continue; }
    if (inFrontmatter) continue;

    // Fenced block detection
    if (/^(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;

    const match = line.match(inlinePattern);
    if (match) {
      results.push({ key: match[1], line: lineNum });
    }
  }

  return results;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function newResult(
  file: string,
  severity: LintSeverity,
  rule: string,
  message: string
): LintResult {
  return { file, severity, rule, message };
}

// ── Stale note review ────────────────────────────────────────────────────────

/** Maps review cycle enum values to days. */
const CYCLE_DAYS: Record<string, number> = {
  daily:     1,
  weekly:    7,
  monthly:   30,
  quarterly: 90,
  yearly:    365,
};

async function runStaleReview(
  app: App,
  files: TFile[],
  settings: ForgeSettings
): Promise<LintResult[]> {
  const results: LintResult[] = [];
  const {
    staleReviewCycleField,
    staleReviewUpdatedField,
    staleReviewFilterField,
    staleReviewStatuses,
  } = settings;

  const now = Date.now();

  for (const file of files) {
    const note = await readNote(app, file);
    if (!note?.hasFrontmatter) continue;

    const fm = note.frontmatter;

    // Apply in-scope filter — skip if filter field is configured and value not in list
    if (staleReviewFilterField && staleReviewStatuses.length > 0) {
      const fieldVal = getFmString(fm, staleReviewFilterField);
      if (!fieldVal || !staleReviewStatuses.includes(fieldVal)) continue;
    }

    // Read cycle value
    const cycleRaw = getFmString(fm, staleReviewCycleField).toLowerCase().trim();
    if (!cycleRaw || cycleRaw === "never") continue;

    const cycleDays = CYCLE_DAYS[cycleRaw];
    if (!cycleDays) continue; // unknown value — skip silently

    // Read last updated date
    const updatedRaw = getFmString(fm, staleReviewUpdatedField);
    if (!updatedRaw) continue;

    const updated = new Date(updatedRaw);
    if (isNaN(updated.getTime())) continue;

    const ageDays = (now - updated.getTime()) / (1000 * 60 * 60 * 24);

    if (ageDays > cycleDays) {
      results.push(newResult(
        file.path,
        "warning",
        "stale_note",
        `Note is overdue for review — cycle: ${cycleRaw} (${cycleDays}d), last updated: ${updatedRaw} (${Math.floor(ageDays)} days ago)`
      ));
    }
  }

  return results;
}

function getValidShapeNames(app: App, patternsPath: string): string[] {
  const folder = app.vault.getAbstractFileByPath(patternsPath);
  if (!folder) return [];

  const files = getMarkdownFiles(app, patternsPath);
  return files.map((f) => f.basename);
}

/**
 * Levenshtein distance — port of Get-LevenshteinDistance from Invoke-VaultLint.ps1.
 * Returns [distance, matchedName].
 */
function closestMatch(
  input: string,
  candidates: string[],
  maxDist: number
): [number, string] {
  let bestDist = maxDist + 1;
  let bestMatch = "";
  const inputLower = input.toLowerCase();

  for (const candidate of candidates) {
    if (Math.abs(inputLower.length - candidate.length) > maxDist) continue;
    const dist = levenshtein(inputLower, candidate, maxDist);
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = candidate;
    }
  }

  return [bestDist, bestMatch];
}

function levenshtein(a: string, b: string, maxDist: number): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const curr = new Array(b.length + 1).fill(0);
    curr[0] = i;
    let rowMin = i;

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }

    if (rowMin > maxDist) return maxDist + 1;
    prev = curr;
  }

  return prev[b.length];
}
