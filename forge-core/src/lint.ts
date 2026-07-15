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
//   pattern_mismatch       — field value doesn't match schema-defined regex pattern
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
//   unique_field           — frontmatter field value must be unique across scanned notes
//   stale_note             — note's review cycle has elapsed; review item, not lint warning
//   stale_inbox_note       — inbox note is older than the configured retention threshold; review item, not lint warning
// Shape heading validation is handled by the separate Shape Lint service.

import type { ForgeSettings } from "./settings.js";
import { isInboxRetentionReviewAction } from "./settings.js";
import { buildLintExemptList, getVaultPaths, isExempt, localTimestamp } from "./paths.js";
import type { DashboardIssue } from "./dashboard.js";
import {
  type VaultSchema,
  type SchemaField,
  allFrontmatterFields,
  inlineFieldNameSet,
  conditionallyRequiredInlineFields,
  reviewCycleDays,
} from "./schema.js";
import { collectShapeNamesFromDocuments } from "./shape-lint.js";
import { getTags } from "./tags.js";
import { isFieldPresent, getFmString } from "./frontmatter.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type LintSeverity = "error" | "warning" | "info" | "review";

export interface ForgePosition {
  line: number;
  character: number;
}

export interface ForgeRange {
  start: ForgePosition;
  end: ForgePosition;
}

export interface LintResult {
  file: string;
  severity: LintSeverity;
  rule: string;
  message: string;
  range?: ForgeRange;
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
  reviewItems: LintResult[];
}

export interface ForgeDocument {
  path: string;
  basename: string;
  extension: string;
  content: string;
  frontmatter: Record<string, unknown>;
  hasFrontmatter: boolean;
  stat?: {
    ctime?: number;
    mtime?: number;
  };
}

export interface RunLintForDocumentsInput {
  documents: ForgeDocument[];
  schema: VaultSchema;
  settings: ForgeSettings;
  validShapes?: string[];
  vaultPath?: string;
  timestamp?: string;
  now?: number;
}

export function lintResultToDashboardIssue(result: LintResult): DashboardIssue {
  return {
    file_path: result.file,
    issue_type: result.rule,
    severity: result.severity === "error" ? "critical" : result.severity === "review" ? "info" : result.severity,
    message: result.message,
    suggested_action: suggestedActionForLintRule(result.rule),
    source_command: "run-vault-lint",
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function runLintForDocuments(input: RunLintForDocumentsInput): LintRunResult {
  const { documents, schema, settings } = input;
  const paths = getVaultPaths(settings);
  const exemptPaths = buildLintExemptList(settings, schema.exempt_paths);

  const allDocuments = uniqueMarkdownDocuments(documents).filter((document) => !isExempt(document.path, exemptPaths));
  const validShapes = input.validShapes ?? collectShapeNamesFromDocuments(documents, paths.shapes);

  const allResults: LintResult[] = [];

  for (const document of allDocuments) {
    allResults.push(...lintDocument(document, schema, validShapes, settings, paths.shapes));
  }

  allResults.push(...testUniqueFields(allDocuments, schema));

  if (
    settings.staleReviewEnabled &&
    settings.staleReviewCycleField &&
    settings.staleReviewUpdatedField
  ) {
    const staleResults = runStaleReview(allDocuments, schema, settings, input.now ?? Date.now());
    allResults.push(...staleResults);
  }

  if (isInboxRetentionReviewAction(settings.inboxRetentionAction)) {
    allResults.push(...runInboxRetentionLintForDocuments(allDocuments, settings, input.now ?? Date.now()));
  }

  const envelope: LintRunEnvelope = {
    vault_path: input.vaultPath ?? "",
    timestamp: input.timestamp ?? localTimestamp(),
    schema_version: schema.version,
    notes_scanned: allDocuments.length,
  };

  return {
    envelope,
    results: allResults,
    errors:   allResults.filter((r) => r.severity === "error"),
    warnings: allResults.filter((r) => r.severity === "warning"),
    infos:    allResults.filter((r) => r.severity === "info"),
    reviewItems: allResults.filter((r) => r.severity === "review"),
  };
}

function runInboxRetentionLintForDocuments(
  documents: ForgeDocument[],
  settings: ForgeSettings,
  now: number
): LintResult[] {
  const paths = getVaultPaths(settings);
  const cutoff = now - settings.inboxRetentionDays * 24 * 60 * 60 * 1000;

  return documents
    .filter((document) => document.path.startsWith(`${paths.inbox}/`) && (document.stat?.mtime ?? 0) < cutoff)
    .map((document) => {
      const age = Math.floor((now - (document.stat?.mtime ?? now)) / (1000 * 60 * 60 * 24));
      return newResult(
        document.path,
        "review",
        "stale_inbox_note",
        `Inbox note is ${age} days old and exceeds the ${settings.inboxRetentionDays}-day retention threshold`
      );
    });
}

function uniqueMarkdownDocuments(documents: ForgeDocument[]): ForgeDocument[] {
  const seen = new Set<string>();
  const unique: ForgeDocument[] = [];

  for (const document of documents) {
    if (document.extension.toLowerCase() !== "md" || seen.has(document.path)) continue;
    seen.add(document.path);
    unique.push(document);
  }

  return unique;
}

// ── Per-file lint ─────────────────────────────────────────────────────────────

function lintDocument(
  document: ForgeDocument,
  schema: VaultSchema,
  validShapes: string[],
  settings: ForgeSettings,
  shapesPath: string
): LintResult[] {
  const results: LintResult[] = [];
  const ranges = buildDocumentRangeIndex(document.content);

  if (!document.hasFrontmatter) {
    results.push(newResult(document.path, "error", "no_frontmatter", "No frontmatter block found", ranges.top));
    return results;
  }

  const fm = document.frontmatter;

  // Required frontmatter fields
  results.push(...testRequiredFields(document.path, fm, schema.frontmatter.required, ranges));
  results.push(...testBasicTypeFields(document.path, fm, schema.frontmatter.required, ranges));
  results.push(...testEnumFields(document.path, fm, schema.frontmatter.required, ranges));
  results.push(...testDateFields(document.path, fm, schema.frontmatter.required, ranges));
  results.push(...testSchemaPatternFields(document.path, fm, schema.frontmatter.required, ranges));
  results.push(...testConditionalRules(document.path, fm, schema.frontmatter.required, ranges));
  results.push(...testFieldTagConsistency(document.path, fm, schema.frontmatter.required, ranges));

  // Optional frontmatter fields — validate only if present
  const optFields = schema.frontmatter.optional.filter((f) => isFieldPresent(fm, f.name));
  results.push(...testBasicTypeFields(document.path, fm, optFields, ranges));
  results.push(...testEnumFields(document.path, fm, optFields, ranges));
  results.push(...testDateFields(document.path, fm, optFields, ranges));
  results.push(...testSchemaPatternFields(document.path, fm, optFields, ranges));
  results.push(...testConditionalRules(document.path, fm, optFields, ranges));
  results.push(...testPatternFieldValues(document.path, fm, optFields, validShapes, ranges, shapesPath));

  // Tag namespace rules
  results.push(...testTagNamespaces(document.path, fm, schema, ranges));

  // Inline metadata
  if (settings.lintInlineMetadata) {
    results.push(...testInlineMetadata(document.path, document.content, schema, fm));
  }

  return results;
}

// ── Rule implementations ──────────────────────────────────────────────────────

function testRequiredFields(
  path: string,
  fm: Record<string, unknown>,
  fields: SchemaField[],
  ranges: DocumentRangeIndex
): LintResult[] {
  return fields
    .filter((f) => !isFieldPresent(fm, f.name))
    .map((f) =>
      newResult(path, f.severity, "required_field", `Missing required field: '${f.name}'`, ranges.frontmatter)
    );
}

function testUniqueFields(
  documents: ForgeDocument[],
  schema: VaultSchema
): LintResult[] {
  const fields = allFrontmatterFields(schema).filter(isUniqueField);
  if (fields.length === 0) return [];

  const results: LintResult[] = [];
  const rangesByPath = new Map<string, DocumentRangeIndex>();

  for (const field of fields) {
    const byValue = new Map<string, Array<{ path: string; value: string }>>();

    for (const document of documents) {
      if (!document.hasFrontmatter) continue;
      if (!isFieldPresent(document.frontmatter, field.name)) continue;

      const value = getFmString(document.frontmatter, field.name).trim();
      if (!value) continue;

      const key = value.toLowerCase();
      const records = byValue.get(key) ?? [];
      records.push({ path: document.path, value });
      byValue.set(key, records);
    }

    for (const records of byValue.values()) {
      if (records.length < 2) continue;
      const paths = records.map((record) => record.path).sort((left, right) => left.localeCompare(right));
      const displayValue = records[0]?.value ?? "";
      for (const record of records) {
        let ranges = rangesByPath.get(record.path);
        if (!ranges) {
          const document = documents.find((candidate) => candidate.path === record.path);
          ranges = buildDocumentRangeIndex(document?.content ?? "");
          rangesByPath.set(record.path, ranges);
        }
        results.push(newResult(
          record.path,
          field.severity,
          "unique_field",
          `Field '${field.name}' value '${displayValue}' must be unique; also used by ${paths.filter((path) => path !== record.path).join(", ")}`,
          rangeForField(ranges, field.name)
        ));
      }
    }
  }

  return results;
}

function isUniqueField(field: SchemaField): boolean {
  return field.unique === true;
}

function testBasicTypeFields(
  path: string,
  fm: Record<string, unknown>,
  fields: SchemaField[],
  ranges: DocumentRangeIndex
): LintResult[] {
  const results: LintResult[] = [];

  for (const field of fields) {
    if (!isFieldPresent(fm, field.name)) continue;
    const val = fm[field.name];

    switch (field.type) {
      case "string":
        if (typeof val !== "string") {
          results.push(newResult(path, field.severity, "type_mismatch",
            `Field '${field.name}' must be a string`,
            rangeForField(ranges, field.name)));
        }
        break;
      case "boolean":
        if (typeof val !== "boolean") {
          results.push(newResult(path, field.severity, "type_mismatch",
            `Field '${field.name}' must be a boolean`,
            rangeForField(ranges, field.name)));
        }
        break;
      case "list":
        if (!Array.isArray(val)) {
          results.push(newResult(path, field.severity, "type_mismatch",
            `Field '${field.name}' must be a list`,
            rangeForField(ranges, field.name)));
        } else if (field.min_items !== undefined && val.length < field.min_items) {
          results.push(newResult(path, field.severity, "type_mismatch",
            `Field '${field.name}' must have at least ${field.min_items} item(s)`,
            rangeForField(ranges, field.name)));
        }
        break;
      case "version":
        if (typeof val !== "string" && typeof val !== "number") {
          results.push(newResult(path, field.severity, "type_mismatch",
            `Field '${field.name}' must be a version string or number`,
            rangeForField(ranges, field.name)));
        }
        break;
    }
  }

  return results;
}

function testEnumFields(
  path: string,
  fm: Record<string, unknown>,
  fields: SchemaField[],
  ranges: DocumentRangeIndex
): LintResult[] {
  const results: LintResult[] = [];

  for (const field of fields) {
    if (field.type !== "enum") continue;
    if (!isFieldPresent(fm, field.name)) continue;
    if (!field.values) continue;

    const values = normalizeEnumValues(fm[field.name]);
    const invalidValues = values.filter((value) => !field.values?.includes(value));

    if (invalidValues.length > 0) {
      results.push(newResult(path, field.severity, "enum_value",
        `Field '${field.name}' value '${invalidValues.join(", ")}' not allowed. Valid: ${field.values.join(", ")}`,
        rangeForField(ranges, field.name)));
    }
  }

  return results;
}

function normalizeEnumValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(String)
    : [String(value)];
}

function testDateFields(
  path: string,
  fm: Record<string, unknown>,
  fields: SchemaField[],
  ranges: DocumentRangeIndex
): LintResult[] {
  const results: LintResult[] = [];
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  for (const field of fields) {
    if (field.type !== "date") continue;
    if (!isFieldPresent(fm, field.name)) continue;

    const val = String(fm[field.name]);

    if (!dateRegex.test(val) || isNaN(Date.parse(val))) {
      results.push(newResult(path, field.severity, "date_format",
        `Field '${field.name}' value '${val}' does not match format yyyy-MM-dd`,
        rangeForField(ranges, field.name)));
    }
  }

  return results;
}

function testSchemaPatternFields(
  path: string,
  fm: Record<string, unknown>,
  fields: SchemaField[],
  ranges: DocumentRangeIndex
): LintResult[] {
  const results: LintResult[] = [];

  for (const field of fields) {
    if (!field.pattern) continue;
    if (!isFieldPresent(fm, field.name)) continue;

    let regex: RegExp;
    try {
      regex = new RegExp(field.pattern);
    } catch {
      continue;
    }

    const rawValue = fm[field.name];
    const values: unknown[] = Array.isArray(rawValue) ? rawValue : [rawValue];
    const invalidValues = values
      .filter((value) => value !== null && value !== undefined)
      .map((value) => frontmatterPatternValueToString(value).trim())
      .filter((value) => value.length > 0 && !regex.test(value));

    if (invalidValues.length === 0) continue;

    results.push(newResult(path, field.severity, "pattern_mismatch",
      `Field '${field.name}' value '${invalidValues.join(", ")}' does not match pattern ${field.pattern}`,
      rangeForField(ranges, field.name)));
  }

  return results;
}

function frontmatterPatternValueToString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

function testConditionalRules(
  path: string,
  fm: Record<string, unknown>,
  fields: SchemaField[],
  ranges: DocumentRangeIndex
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
            `Field '${field.name}' is required when '${rule.field}' = '${driverVal}'`,
            rangeForField(ranges, rule.field)));
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
            `Field '${field.name}' should not be present when '${rule.field}' is ${label}`,
            rangeForField(ranges, field.name)));
        }
      }
    }
  }

  return results;
}

function testFieldTagConsistency(
  path: string,
  fm: Record<string, unknown>,
  fields: SchemaField[],
  ranges: DocumentRangeIndex
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
          `Field '${field.name}' = '${fieldVal}' but no '${ns}/*' tag found. Expected: ${expected}`,
          rangeForField(ranges, field.name)));
      } else if (!tags.includes(expected)) {
        results.push(newResult(path, rule.severity ?? "warning", "tag_consistency",
          `Field '${field.name}' = '${fieldVal}' but tag '${expected}' missing. Found: ${nsTags.join(", ")}`,
          rangeForField(ranges, field.name)));
      }
    }
  }

  return results;
}

function testPatternFieldValues(
  path: string,
  fm: Record<string, unknown>,
  fields: SchemaField[],
  validShapes: string[],
  ranges: DocumentRangeIndex,
  shapesPath: string
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
        `Field 'shapes' contains '${val}', which is not a valid shape in ${shapesPath}/`,
        rangeForField(ranges, "shapes")));
    }
  }

  return results;
}

function testTagNamespaces(
  path: string,
  fm: Record<string, unknown>,
  schema: VaultSchema,
  ranges: DocumentRangeIndex
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
        `Tag '${tag}' is not namespaced. Expected format: namespace/tag`,
        rangeForField(ranges, "tags")));
      continue;
    }

    const ns = tag.substring(0, slashIdx);

    if (forbiddenNs.has(ns)) {
      results.push(newResult(path, "error", "forbidden_namespace",
        `Tag namespace '${ns}' is reserved and must not be used as a tag namespace`,
        rangeForField(ranges, "tags")));
      continue;
    }

    if (tag_rules.unknown_tags !== "off" && !allowedNs.has(ns)) {
      const unknownSeverity = tag_rules.unknown_tags;
      results.push(newResult(path, unknownSeverity, "unknown_tag_namespace",
        `Tag namespace '${ns}' is not in allowed_namespaces`,
        rangeForField(ranges, "tags")));
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
  const ranges = buildDocumentRangeIndex(content);

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
        `Inline key '${entry.key}' is a schema frontmatter field — move to frontmatter (line ${entry.line})`,
        entry.range));
      continue;
    }

    // SKIP — known inline field
    if (knownInlineNames.has(keyLower)) continue;

    // WARNING — fuzzy match to schema field (likely typo)
    const [schemaDist, schemaMatch] = closestMatch(entry.key, allSchemaNames, 2);
    if (schemaDist <= 2 && schemaDist > 0) {
      results.push(newResult(path, "warning", "inline_fuzzy_schema",
        `Inline key '${entry.key}' looks like a typo of schema field '${schemaMatch}' (distance ${schemaDist}, line ${entry.line})`,
        entry.range));
      continue;
    }

    // WARNING — fuzzy match to known inline field
    const [inlineDist, inlineMatch] = closestMatch(entry.key, allInlineNames, 2);
    if (inlineDist <= 2 && inlineDist > 0) {
      results.push(newResult(path, "warning", "inline_fuzzy_inline",
        `Inline key '${entry.key}' looks like a typo of inline field '${inlineMatch}' (distance ${inlineDist}, line ${entry.line})`,
        entry.range));
      continue;
    }

    // INFO — undocumented inline key
    results.push(newResult(path, "info", "inline_undocumented",
      `Inline key '${entry.key}' is undocumented — consider adding to inline.allowed in schema.md (line ${entry.line})`,
      entry.range));
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
        `Inline field '${field.name}' is required when '${triggerField}' = '${triggerVal}'`,
        rangeForField(ranges, triggerField)));
    }
  }

  return results;
}

interface InlineEntry {
  key: string;
  line: number;
  range: ForgeRange;
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
    if (match) {
      const key = match[1];
      const start = line.indexOf(key);
      results.push({
        key,
        line: lineNum,
        range: {
          start: { line: lineNum - 1, character: Math.max(0, start) },
          end: { line: lineNum - 1, character: Math.max(0, start) + key.length },
        },
      });
    }
  }

  return results;
}

// ── Stale note review ─────────────────────────────────────────────────────────

function runStaleReview(
  documents: ForgeDocument[],
  schema: VaultSchema,
  settings: ForgeSettings,
  now: number
): LintResult[] {
  const results: LintResult[] = [];
  const {
    staleReviewCycleField,
    staleReviewUpdatedField,
    staleReviewFilterField,
    staleReviewStatuses,
  } = settings;

  for (const document of documents) {
    if (!document.hasFrontmatter) continue;
    const fm = document.frontmatter;
    const ranges = buildDocumentRangeIndex(document.content);

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
        document.path,
        "review",
        "stale_note",
        `Note is overdue for review: cycle ${cycleRaw} (${cycleDays}d), last updated ${updatedRaw} (${Math.floor(ageDays)} days ago)`,
        rangeForField(ranges, staleReviewUpdatedField)
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
  message: string,
  range?: ForgeRange
): LintResult {
  return range
    ? { file, severity, rule, message, range }
    : { file, severity, rule, message };
}

interface DocumentRangeIndex {
  top: ForgeRange;
  frontmatter: ForgeRange;
  fieldRanges: Map<string, ForgeRange>;
}

function buildDocumentRangeIndex(content: string): DocumentRangeIndex {
  const lines = content.split(/\r?\n/);
  const top = rangeForLine(lines, 0);
  const fieldRanges = new Map<string, ForgeRange>();
  let frontmatter = top;

  if (/^---\s*$/.test(lines[0] ?? "")) {
    const closingLine = lines.findIndex((line, index) => index > 0 && /^---\s*$/.test(line));
    if (closingLine > 0) {
      frontmatter = {
        start: { line: 0, character: 0 },
        end: { line: closingLine, character: lines[closingLine]?.length ?? 0 },
      };

      for (let lineNumber = 1; lineNumber < closingLine; lineNumber++) {
        const line = lines[lineNumber] ?? "";
        const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_-]*)\s*:/);
        if (!match) continue;

        const leading = match[1]?.length ?? 0;
        const key = match[2] ?? "";
        const range = {
          start: { line: lineNumber, character: leading },
          end: { line: lineNumber, character: Math.max(line.length, leading + key.length) },
        };
        fieldRanges.set(key, range);
        fieldRanges.set(key.toLowerCase(), range);
      }
    }
  }

  return { top, frontmatter, fieldRanges };
}

function rangeForField(ranges: DocumentRangeIndex, fieldName: string): ForgeRange {
  return ranges.fieldRanges.get(fieldName) ?? ranges.fieldRanges.get(fieldName.toLowerCase()) ?? ranges.frontmatter;
}

function rangeForLine(lines: string[], lineNumber: number): ForgeRange {
  const boundedLine = Math.max(0, Math.min(lineNumber, Math.max(0, lines.length - 1)));
  return {
    start: { line: boundedLine, character: 0 },
    end: { line: boundedLine, character: Math.max(1, lines[boundedLine]?.length ?? 1) },
  };
}

function suggestedActionForLintRule(rule: string): string {
  switch (rule) {
    case "no_frontmatter":
      return "Add a frontmatter block that follows schema.md.";
    case "required_field":
      return "Add the missing required field.";
    case "enum_value":
      return "Use one of the values allowed by schema.md.";
    case "date_format":
      return "Use yyyy-MM-dd date format.";
    case "pattern_mismatch":
      return "Use a value that matches the field pattern in schema.md.";
    case "unique_field":
      return "Give this note a frontmatter value that is unique across the vault.";
    case "tag_namespace":
    case "unknown_tag_namespace":
    case "forbidden_namespace":
      return "Normalize the tag namespace.";
    case "invalid_shape_ref":
      return "Use a shape that exists in the shapes folder.";
    case "shape_heading_missing":
      return "Add the missing heading from the shape template.";
    case "shape_heading_order":
      return "Reorder headings to match the shape template.";
    case "shape_heading_extra":
      return "Review whether this heading belongs in the shape template.";
    case "shape_section_empty":
      return "Add content to the required section or revise the template.";
    case "stale_note":
      return "Review this note and update its review date when complete.";
    case "stale_inbox_note":
      return "Review, file, or clear this inbox note.";
    default:
      return "Review this file against the current Forge schema.";
  }
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
