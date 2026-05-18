// src/utils/schema.ts
// Schema loading and validation utilities.
//
// Port of:
//   Generate-Schema.ps1 → Get-MarkdownFrontmatterAndBody, Get-SchemaContractYamlBlock
//   Invoke-VaultLint.ps1 → schema loading, field/rule extraction
//
// The plugin reads schema.md directly — no schema.yaml or schema.json needed.
// Generate-Schema.ps1's job of compiling to YAML/JSON is eliminated.
// The plugin is the consumer; it reads the source.

import { App, TFile, parseYaml } from "obsidian";
import type { VaultForgeSettings } from "../settings";
import { getVaultPaths } from "../vault-paths";

// ── Schema types ─────────────────────────────────────────────────────────────

export interface SchemaField {
  name: string;
  type: "enum" | "string" | "boolean" | "date" | "list" | "version";
  values?: string[];           // for enum fields
  severity: "error" | "warning" | "info";
  min_items?: number;          // for list fields
  strict_parse?: boolean;      // for date fields
  stale_after_days?: number;   // for date fields
  description?: string;
  lint_rules?: SchemaLintRule[];
}

export interface SchemaLintRule {
  rule: "required_when" | "forbidden_when" | "tag_consistency";
  field?: string;
  equals?: string[];
  not_equals?: string[];
  tag_namespace?: string;
  severity?: "error" | "warning" | "info";
}

export interface SchemaTagRules {
  require_namespace: boolean;
  unknown_tags: "error" | "warning" | "info" | "off";
  severity: "error" | "warning" | "info";
  allowed_namespaces: string[];
}

export interface SchemaMeta {
  version: string;
  updated: string;
  author?: string;
  schemaRef?: string;
}

export interface VaultSchema {
  meta: SchemaMeta;
  required_fields: SchemaField[];
  optional_fields: SchemaField[];
  inline_fields: string[];
  tag_rules: SchemaTagRules;
  exempt_paths: string[];
  lint_output: Record<string, unknown>;
  patch_engine: Record<string, unknown>;
}

// ── Load ─────────────────────────────────────────────────────────────────────

/**
 * Loads and parses the vault schema from schema.md.
 * Returns null if schema.md cannot be found or parsed.
 *
 * Port of Generate-Schema.ps1 schema reading logic, adapted for direct use
 * by the plugin (no compilation to YAML/JSON).
 */
export async function loadSchema(
  app: App,
  settings: VaultForgeSettings
): Promise<VaultSchema | null> {
  const paths = getVaultPaths(settings);
  const file = app.vault.getAbstractFileByPath(paths.schemaMd);

  if (!(file instanceof TFile)) {
    console.warn(`[VaultForge] schema.md not found at: ${paths.schemaMd}`);
    return null;
  }

  let raw: string;
  try {
    raw = await app.vault.read(file);
  } catch (e) {
    console.warn(`[VaultForge] Could not read schema.md:`, e);
    return null;
  }

  return parseSchemaNote(raw);
}

/**
 * Parses schema.md content into a VaultSchema.
 * Exported for testing.
 */
export function parseSchemaNote(raw: string): VaultSchema | null {
  // Split frontmatter from body
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    console.warn("[VaultForge] schema.md is missing valid YAML frontmatter");
    return null;
  }

  const fmText = fmMatch[1];
  const bodyText = fmMatch[2] ?? "";

  // Parse frontmatter for updated date
  let fmUpdated = "";
  try {
    const fm = parseYaml(fmText) as Record<string, unknown>;
    fmUpdated = fm?.updated ? String(fm.updated) : "";
  } catch {
    // non-fatal
  }

  // Extract version from inline metadata: version:: "4.4"
  const versionMatch = bodyText.match(/^version::\s*"?([^"\s]+)"?\s*$/m);
  const version = versionMatch?.[1] ?? "";

  // Extract the fenced YAML contract block
  const contractYaml = extractContractBlock(bodyText);
  if (!contractYaml) {
    console.warn("[VaultForge] Could not find schema contract YAML block in schema.md");
    return null;
  }

  // Parse the contract
  let contract: Record<string, unknown>;
  try {
    contract = parseYaml(contractYaml) as Record<string, unknown>;
  } catch (e) {
    console.warn("[VaultForge] Could not parse schema contract YAML:", e);
    return null;
  }

  if (!contract) {
    console.warn("[VaultForge] Schema contract block is empty");
    return null;
  }

  // Extract meta from contract
  const contractMeta = (contract.meta as Record<string, unknown>) ?? {};

  const meta: SchemaMeta = {
    version,
    updated: fmUpdated,
    author: contractMeta.author ? String(contractMeta.author) : undefined,
    schemaRef: contractMeta.schemaRef ? String(contractMeta.schemaRef) : undefined,
  };

  // Coerce field arrays
  const requiredFields = coerceFieldArray(contract.required_fields);
  const optionalFields = coerceFieldArray(contract.optional_fields);

  // Inline fields
  const rawInline = contract.inline_fields;
  const inlineFields = Array.isArray(rawInline)
    ? rawInline.map(String)
    : [];

  // Tag rules with safe defaults
  const rawTagRules = (contract.tag_rules as Record<string, unknown>) ?? {};
  const tagRules: SchemaTagRules = {
    require_namespace: Boolean(rawTagRules.require_namespace ?? true),
    unknown_tags: (rawTagRules.unknown_tags as SchemaTagRules["unknown_tags"]) ?? "warning",
    severity: (rawTagRules.severity as SchemaTagRules["severity"]) ?? "warning",
    allowed_namespaces: Array.isArray(rawTagRules.allowed_namespaces)
      ? rawTagRules.allowed_namespaces.map(String)
      : [],
  };

  // Exempt paths
  const rawExempt = contract.exempt_paths;
  const exemptPaths = Array.isArray(rawExempt) ? rawExempt.map(String) : [];

  return {
    meta,
    required_fields: requiredFields,
    optional_fields: optionalFields,
    inline_fields: inlineFields,
    tag_rules: tagRules,
    exempt_paths: exemptPaths,
    lint_output: (contract.lint_output as Record<string, unknown>) ?? {},
    patch_engine: (contract.patch_engine as Record<string, unknown>) ?? {},
  };
}

// ── Schema validation ────────────────────────────────────────────────────────

export interface SchemaValidationIssue {
  severity: "error" | "warning";
  message: string;
}

/**
 * Validates schema.md structure without loading into full VaultSchema.
 * Used by the Validate Schema command.
 * Returns an array of issues — empty array means valid.
 */
export function validateSchemaNote(raw: string): SchemaValidationIssue[] {
  const issues: SchemaValidationIssue[] = [];

  // Must have frontmatter
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    issues.push({ severity: "error", message: "schema.md is missing YAML frontmatter block" });
    return issues;
  }

  const bodyText = fmMatch[2] ?? "";

  // Must have version:: inline metadata
  if (!/^version::\s*"?[^"\s]+"?\s*$/m.test(bodyText)) {
    issues.push({
      severity: "error",
      message: "schema.md body is missing 'version:: ...' inline metadata",
    });
  }

  // Must have a contract block
  const contractYaml = extractContractBlock(bodyText);
  if (!contractYaml) {
    issues.push({
      severity: "error",
      message: "Could not find a fenced YAML block under # Contract in schema.md",
    });
    return issues;
  }

  // Contract must be parseable
  try {
    const contract = parseYaml(contractYaml) as Record<string, unknown>;
    if (!contract) {
      issues.push({ severity: "error", message: "Schema contract block is empty" });
      return issues;
    }

    // Must have required_fields
    if (!contract.required_fields) {
      issues.push({ severity: "error", message: "Schema contract is missing required_fields" });
    }

    // Must have tag_rules
    if (!contract.tag_rules) {
      issues.push({ severity: "warning", message: "Schema contract is missing tag_rules" });
    }

    // meta.version should not be in the YAML block
    const contractMeta = contract.meta as Record<string, unknown> | undefined;
    if (contractMeta?.version) {
      issues.push({
        severity: "error",
        message: "Do not define meta.version in the schema YAML block — use 'version:: ...' in the body instead",
      });
    }

  } catch (e) {
    issues.push({
      severity: "error",
      message: `Schema contract YAML is not parseable: ${e}`,
    });
  }

  return issues;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extracts the YAML content from the first fenced code block under # Contract.
 * Falls back to the first yaml fenced block in the document.
 *
 * Port of Get-SchemaContractYamlBlock from Generate-Schema.ps1.
 */
function extractContractBlock(bodyText: string): string | null {
  // Try under # Contract heading first
  const underContract = bodyText.match(
    /^#\s+Contract\s*$[\s\S]*?^```+\s*yaml\s*\r?\n([\s\S]*?)^```+\s*$/m
  );
  if (underContract) return underContract[1].trim();

  // Fall back to first yaml fenced block anywhere
  const anywhere = bodyText.match(/^```+\s*yaml\s*\r?\n([\s\S]*?)^```+\s*$/m);
  if (anywhere) return anywhere[1].trim();

  return null;
}

/**
 * Coerces an unknown value into a SchemaField array.
 * Filters out null entries (YAML sometimes produces them).
 */
function coerceFieldArray(raw: unknown): SchemaField[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .map((item) => ({
      name: String(item.name ?? ""),
      type: (item.type as SchemaField["type"]) ?? "string",
      values: Array.isArray(item.values) ? item.values.map(String) : undefined,
      severity: (item.severity as SchemaField["severity"]) ?? "warning",
      min_items: item.min_items !== undefined ? Number(item.min_items) : undefined,
      strict_parse: item.strict_parse !== undefined ? Boolean(item.strict_parse) : undefined,
      stale_after_days: item.stale_after_days !== undefined ? Number(item.stale_after_days) : undefined,
      description: item.description ? String(item.description) : undefined,
      lint_rules: Array.isArray(item.lint_rules)
        ? (item.lint_rules as SchemaLintRule[])
        : undefined,
    }))
    .filter((f) => f.name.length > 0);
}
