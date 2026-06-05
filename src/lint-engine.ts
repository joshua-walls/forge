// src/lint-engine.ts
// Forge lint engine.
//
// Validates all vault markdown files against schema.md rules.
// Read-only — never modifies files.
//
// Rules implemented:
//   no_frontmatter         — file has no frontmatter block
//   required_field         — required field missing
//   enum_value             — field value not in allowed enum list
//   date_format            — date field doesn't match yyyy-MM-dd
//   stale_date             — date field exceeds stale_after_days
//   type_mismatch          — field value is wrong type
//   tag_namespace          — tag has no namespace (no slash)
//   unknown_tag_namespace  — tag namespace not in allowed_namespaces
//   forbidden_namespace    — tag uses a namespace in forbidden_namespaces
//   required_when          — inline field required when frontmatter field has a value
//   forbidden_when         — field forbidden when another field has a value
//   tag_consistency        — field value should have matching tag
//   invalid_shape_ref      — shapes field references unknown shape
//   inline_is_schema_field — inline metadata key matches a schema frontmatter field
//   inline_fuzzy_schema    — inline key looks like a typo of a schema field
//   inline_fuzzy_inline    — inline key looks like a typo of a known inline field
//   inline_undocumented    — inline key not in schema inline.allowed list
//   stale_note             — note's review cycle has elapsed
//   stale_inbox_note       — inbox note is older than the configured retention threshold
// Shape heading validation is handled by the separate Shape Lint service.

import { App, TFile } from "obsidian";
import type { ForgeSettings } from "./settings";
import { getVaultPaths } from "./vault-paths";
import {
  VaultSchema,
  SchemaField,
  loadSchema,
  allFrontmatterFields,
  inlineFieldNameSet,
  conditionallyRequiredInlineFields,
  reviewCycleDays,
} from "./utils/schema";
import { getTags } from "./utils/tags";
import {
  buildExemptList,
  localTimestamp,
  getMarkdownFiles,
  isExempt,
} from "./utils/files";
import { readNote, isFieldPresent, getFmString } from "./utils/frontmatter";

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface VaultAdapterWithBasePath {
  basePath?: string;
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runLint(
  app: App,
  settings: ForgeSettings
): Promise<LintRunResult | null> {
  const allFiles = getMarkdownFiles(app);
  return runLintForFiles(app, settings, allFiles);
}

export async function runLintForFile(
  app: App,
  settings: ForgeSettings,
  file: TFile
): Promise<LintRunResult | null> {
  return runLintForFiles(app, settings, [file]);
}

export async function runLintForFiles(
  app: App,
  settings: ForgeSettings,
  files: TFile[]
): Promise<LintRunResult | null> {
  const schema = await loadSchema(app, settings);
  if (!schema) return null;

  const paths = getVaultPaths(settings);
  const exemptPaths = buildExemptList(
    schema.exempt_paths,
    paths.forge,
    settings.lintExcludeInboxFolder ? [settings.inboxFolder] : []
  );

  const allFiles = uniqueMarkdownFiles(files).filter((f) => !isExempt(f.path, exemptPaths));

  const validShapes = getValidShapeNames(app, paths.shapes);

  const allResults: LintResult[] = [];

  for (const file of allFiles) {
    const fileResults = await lintFile(app, file, schema, validShapes, settings);
    allResults.push(...fileResults);
  }

  if (
    settings.staleReviewEnabled &&
    settings.staleReviewCycleField &&
    settings.staleReviewUpdatedField
  ) {
    const staleResults = await runStaleReview(app, allFiles, schema, settings);
    allResults.push(...staleResults);
  }

  if (settings.inboxRetentionAction === "warning") {
    allResults.push(...runInboxRetentionLintForFiles(allFiles, settings));
  }

  const envelope: LintRunEnvelope = {
    vault_path: (app.vault.adapter as VaultAdapterWithBasePath).basePath ?? "",
    timestamp: localTimestamp(),
    schema_version: schema.version,
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

function runInboxRetentionLintForFiles(
  files: TFile[],
  settings: ForgeSettings
): LintResult[] {
  const paths = getVaultPaths(settings);
  const cutoff = Date.now() - settings.inboxRetentionDays * 24 * 60 * 60 * 1000;

  return files
    .filter((file) => file.path.startsWith(`${paths.inbox}/`) && file.stat.mtime < cutoff)
    .map((file) => {
      const age = Math.floor((Date.now() - file.stat.mtime) / (1000 * 60 * 60 * 24));
      return newResult(
        file.path,
        "warning",
        "stale_inbox_note",
        `Inbox note is ${age} days old and exceeds the ${settings.inboxRetentionDays}-day retention threshold`
      );
    });
}

function uniqueMarkdownFiles(files: TFile[]): TFile[] {
  const seen = new Set<string>();
  const unique: TFile[] = [];

  for (const file of files) {
    if (file.extension !== "md" || seen.has(file.path)) continue;
    seen.add(file.path);
    unique.push(file);
  }

  return unique;
}

// ── Per-file lint ─────────────────────────────────────────────────────────────

async function lintFile(
  app: App,
  file: TFile,
  schema: VaultSchema,
  validShapes: string[],
  settings: ForgeSettings
): Promise<LintResult[]> {
  const note = await readNote(app, file);
  const results: LintResult[] = [];

  if (!note || !note.hasFrontmatter) {
    results.push(newResult(file.path, "error", "no_frontmatter", "No frontmatter block found"));
    return results;
  }

  const fm = note.frontmatter;
  const content = await app.vault.read(file);

  // Required frontmatter fields
  results.push(...testRequiredFields(file.path, fm, schema.frontmatter.required));
  results.push(...testBasicTypeFields(file.path, fm, schema.frontmatter.required));
  results.push(...testEnumFields(file.path, fm, schema.frontmatter.required));
  results.push(...testDateFields(file.path, fm, schema.frontmatter.required));
  results.push(...testConditionalRules(file.path, fm, schema.frontmatter.required));
  results.push(...testFieldTagConsistency(file.path, fm, schema.frontmatter.required));

  // Optional frontmatter fields — validate only if present
  const optFields = schema.frontmatter.optional.filter((f) => isFieldPresent(fm, f.name));
  results.push(...testBasicTypeFields(file.path, fm, optFields));
  results.push(...testEnumFields(file.path, fm, optFields));
  results.push(...testDateFields(file.path, fm, optFields));
  results.push(...testConditionalRules(file.path, fm, optFields));
  results.push(...testPatternFieldValues(file.path, fm, optFields, validShapes));

  // Tag namespace rules
  results.push(...testTagNamespaces(file.path, fm, schema));

  // Inline metadata
  if (settings.lintInlineMetadata) {
    results.push(...testInlineMetadata(file.path, content, schema, fm));
  }

  return results;
}

// ── Rule implementations ──────────────────────────────────────────────────────

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
        } else if (field.min_items !== undefined && val.length < field.min_items) {
          results.push(newResult(path, field.severity, "type_mismatch",
            `Field '${field.name}' must have at least ${field.min_items} item(s)`));
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
        `Field 'shapes' contains '${val}', which is not a valid shape in System/Shapes/`));
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
  const forbiddenNs = new Set(tag_rules.forbidden_namespaces);

  for (const tag of tags) {
    const slashIdx = tag.indexOf("/");

    if (slashIdx < 0) {
      results.push(newResult(path, tag_rules.severity, "tag_namespace",
        `Tag '${tag}' is not namespaced. Expected format: namespace/tag`));
      continue;
    }

    const ns = tag.substring(0, slashIdx);

    if (forbiddenNs.has(ns)) {
      results.push(newResult(path, "error", "forbidden_namespace",
        `Tag namespace '${ns}' is reserved and must not be used as a tag namespace`));
      continue;
    }

    if (tag_rules.unknown_tags !== "off" && !allowedNs.has(ns)) {
      const unknownSeverity = tag_rules.unknown_tags;
      results.push(newResult(path, unknownSeverity, "unknown_tag_namespace",
        `Tag namespace '${ns}' is not in allowed_namespaces`));
    }
  }

  return results;
}

// ── Inline metadata rules ─────────────────────────────────────────────────────

function testInlineMetadata(
  path: string,
  content: string,
  schema: VaultSchema,
  fm: Record<string, unknown>
): LintResult[] {
  const results: LintResult[] = [];
  const entries = extractInlineMetadataKeys(content);

  // Build lookup sets from new schema structure
  const schemaFieldNames = new Set(
    allFrontmatterFields(schema).map((f) => f.name.toLowerCase())
  );
  const knownInlineNames = inlineFieldNameSet(schema);
  const conditionalFields = conditionallyRequiredInlineFields(schema);

  const allSchemaNames = [...schemaFieldNames];
  const allInlineNames = [...knownInlineNames];
  const seen = new Set<string>();
  const foundInlineKeys = new Set<string>();

  for (const entry of entries) {
    const dedupeKey = `${path}|${entry.key}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const keyLower = entry.key.toLowerCase();
    foundInlineKeys.add(keyLower);

    // ERROR — exact match to a schema frontmatter field
    if (schemaFieldNames.has(keyLower)) {
      results.push(newResult(path, "error", "inline_is_schema_field",
        `Inline key '${entry.key}' is a schema frontmatter field — move to frontmatter (line ${entry.line})`));
      continue;
    }

    // SKIP — known inline field
    if (knownInlineNames.has(keyLower)) continue;

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
      `Inline key '${entry.key}' is undocumented — consider adding to inline.allowed in schema.md (line ${entry.line})`));
  }

  // Check conditionally required inline fields
  for (const field of conditionalFields) {
    if (!field.required_when) continue;
    const { field: triggerField, values: triggerValues } = field.required_when;
    const triggerVal = getFmString(fm, triggerField);
    if (!triggerVal || !triggerValues.includes(triggerVal)) continue;

    if (!foundInlineKeys.has(field.name.toLowerCase())) {
      const severity = field.severity ?? "warning";
      results.push(newResult(path, severity, "required_when",
        `Inline field '${field.name}' is required when '${triggerField}' = '${triggerVal}'`));
    }
  }

  return results;
}

interface InlineEntry {
  key: string;
  line: number;
}

function extractInlineMetadataKeys(content: string): InlineEntry[] {
  const results: InlineEntry[] = [];
  const lines = content.split(/\r?\n/);
  const inlinePattern = /^>?\s*([A-Za-z_][A-Za-z0-9_-]*)::\s*\S/;

  let inFrontmatter = false;
  let inFence = false;
  let lineNum = 0;

  for (const line of lines) {
    lineNum++;

    if (lineNum === 1 && /^---\s*$/.test(line)) { inFrontmatter = true; continue; }
    if (inFrontmatter && /^---\s*$/.test(line)) { inFrontmatter = false; continue; }
    if (inFrontmatter) continue;

    if (/^(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;

    const match = line.match(inlinePattern);
    if (match) results.push({ key: match[1], line: lineNum });
  }

  return results;
}

// ── Stale note review ─────────────────────────────────────────────────────────

async function runStaleReview(
  app: App,
  files: TFile[],
  schema: VaultSchema,
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

    if (staleReviewFilterField && staleReviewStatuses.length > 0) {
      const fieldVal = getFmString(fm, staleReviewFilterField);
      if (!fieldVal || !staleReviewStatuses.includes(fieldVal)) continue;
    }

    const cycleRaw = getFmString(fm, staleReviewCycleField).toLowerCase().trim();
    if (!cycleRaw || cycleRaw === "never") continue;

    // Read day count from schema values_meta — replaces hardcoded CYCLE_DAYS
    const cycleDays = reviewCycleDays(schema, cycleRaw);
    if (cycleDays === undefined || cycleDays === null) continue;

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function newResult(
  file: string,
  severity: LintSeverity,
  rule: string,
  message: string
): LintResult {
  return { file, severity, rule, message };
}

function getValidShapeNames(app: App, patternsPath: string): string[] {
  const files = getMarkdownFiles(app, patternsPath);
  return files.map((f) => f.basename);
}

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

  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const curr: number[] = Array.from({ length: b.length + 1 }, () => 0);
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
