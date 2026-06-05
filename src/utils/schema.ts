// src/utils/schema.ts
// Schema loading and validation utilities.
//
// Reads schema.md directly — no compiled schema.yaml or schema.json needed.
// The plugin is the authoritative consumer of the schema contract.

import { App, TFile, parseYaml } from "obsidian";
import type { ForgeSettings } from "../settings";
import { getVaultPaths } from "../vault-paths";

function stringifySchemaValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SchemaLintRule {
  rule: string;
  field?: string;
  equals?: string[];
  not_equals?: string[];
  severity?: "error" | "warning" | "info";
  tag_namespace?: string;
}

export interface SchemaField {
  name: string;
  type: "enum" | "string" | "boolean" | "date" | "list" | "version";
  values?: string[];
  values_meta?: Record<string, { days: number | null }>;
  severity: "error" | "warning" | "info";
  min_items?: number;
  strict_parse?: boolean;
  stale_after_days?: number;
  description?: string;
  lint_rules?: SchemaLintRule[];
}

export interface SchemaInlineField {
  name: string;
  severity?: "error" | "warning" | "info";
  required_when?: {
    field: string;
    values: string[];
  };
}

export interface SchemaRelationship {
  description: string;
  direction: "flexible" | "directional";
  allowed_between?: string[];
  sources?: string[];
  targets?: string[];
  template_heading: string;
}

export interface SchemaFrontmatter {
  required: SchemaField[];
  optional: SchemaField[];
}

export interface SchemaInline {
  allowed: SchemaInlineField[];
}

export interface SchemaOntology {
  relationships: Record<string, SchemaRelationship>;
}

export interface SchemaTagRules {
  require_namespace: boolean;
  unknown_tags: "error" | "warning" | "info" | "off";
  severity: "error" | "warning" | "info";
  allowed_namespaces: string[];
  forbidden_namespaces: string[];
}

export interface VaultSchema {
  version: string;
  frontmatter: SchemaFrontmatter;
  inline: SchemaInline;
  ontology: SchemaOntology;
  tag_rules: SchemaTagRules;
  exempt_paths: string[];
}

// ── Convenience accessors ─────────────────────────────────────────────────────

/** All frontmatter fields — required and optional combined. */
export function allFrontmatterFields(schema: VaultSchema): SchemaField[] {
  return [...schema.frontmatter.required, ...schema.frontmatter.optional];
}

/** Find a frontmatter field by name across required and optional. */
export function getFrontmatterField(
  schema: VaultSchema,
  name: string
): SchemaField | undefined {
  return allFrontmatterFields(schema).find(
    (f) => f.name.toLowerCase() === name.toLowerCase()
  );
}

/** All inline field names as a lowercase Set for O(1) lookup. */
export function inlineFieldNameSet(schema: VaultSchema): Set<string> {
  return new Set(schema.inline.allowed.map((f) => f.name.toLowerCase()));
}

/** Inline fields that carry a required_when constraint. */
export function conditionallyRequiredInlineFields(
  schema: VaultSchema
): SchemaInlineField[] {
  return schema.inline.allowed.filter((f) => f.required_when !== undefined);
}

/** Day count for a given review_cycle value. Returns null for "never", undefined if not found. */
export function reviewCycleDays(
  schema: VaultSchema,
  value: string
): number | null | undefined {
  const field = getFrontmatterField(schema, "review_cycle");
  if (!field?.values_meta) return undefined;
  const entry = field.values_meta[value];
  if (entry === undefined) return undefined;
  return entry.days;
}

// ── Load ──────────────────────────────────────────────────────────────────────

export async function loadSchema(
  app: App,
  settings: ForgeSettings
): Promise<VaultSchema | null> {
  const paths = getVaultPaths(settings);
  const file = app.vault.getAbstractFileByPath(paths.schemaMd);

  if (!(file instanceof TFile)) {
    console.warn(`[Forge] schema.md not found at: ${paths.schemaMd}`);
    return null;
  }

  let raw: string;
  try {
    raw = await app.vault.read(file);
  } catch (e) {
    console.warn(`[Forge] Could not read schema.md:`, e);
    return null;
  }

  return parseSchemaNote(raw, {
    versionLocation: settings.schemaVersionLocation,
    versionField: settings.schemaVersionField,
  });
}

// ── Parse ─────────────────────────────────────────────────────────────────────

interface ParseSchemaOptions {
  versionLocation?: "frontmatter" | "inline";
  versionField?: string;
}

export function parseSchemaNote(raw: string, options?: ParseSchemaOptions): VaultSchema | null {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    console.warn("[Forge] schema.md is missing valid YAML frontmatter");
    return null;
  }

  const fmText = fmMatch[1] ?? "";
  const bodyText = fmMatch[2] ?? "";

  const versionLocation = options?.versionLocation ?? "inline";
  const versionField = options?.versionField ?? "version";

  let version = "";
  if (versionLocation === "frontmatter") {
    // Read from YAML frontmatter block
    const fmData = parseYaml(fmText) as Record<string, unknown> | null;
    const val = fmData?.[versionField];
    if (val !== undefined && val !== null) version = stringifySchemaValue(val);
  } else {
    // Read from inline metadata (key:: value)
    // Handles both bare values (version:: 7.0) and quoted values (version:: "7.0").
    // Quoted form is needed to prevent YAML/Dataview from coercing 7.0 → 7.
    const escaped = versionField.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const inlineMatch = bodyText.match(
      new RegExp(`^${escaped}::\\s*(?:"([^"]+)"|'([^']+)'|(\\S+))\\s*$`, "m")
    );
    version = (inlineMatch?.[1] ?? inlineMatch?.[2] ?? inlineMatch?.[3] ?? "").trim();
  }

  const contractYaml = extractContractBlock(bodyText);
  if (!contractYaml) {
    console.warn("[Forge] Could not find schema contract YAML block in schema.md");
    return null;
  }

  let contract: Record<string, unknown>;
  try {
    contract = parseYaml(contractYaml) as Record<string, unknown>;
  } catch (e) {
    console.warn("[Forge] Could not parse schema contract YAML:", e);
    return null;
  }

  if (!contract) {
    console.warn("[Forge] Schema contract block is empty");
    return null;
  }

  // frontmatter
  const rawFm = (contract.frontmatter as Record<string, unknown>) ?? {};
  const frontmatter: SchemaFrontmatter = {
    required: coerceFieldArray(rawFm.required),
    optional: coerceFieldArray(rawFm.optional),
  };

  // inline
  const rawInline = (contract.inline as Record<string, unknown>) ?? {};
  const inline: SchemaInline = {
    allowed: coerceInlineFieldArray(rawInline.allowed),
  };

  // ontology
  const rawOntology = (contract.ontology as Record<string, unknown>) ?? {};
  const rawRelationships = (rawOntology.relationships as Record<string, unknown>) ?? {};
  const relationships: Record<string, SchemaRelationship> = {};

  for (const [key, val] of Object.entries(rawRelationships)) {
    if (val === null || typeof val !== "object") continue;
    const r = val as Record<string, unknown>;
    relationships[key] = {
      description: stringifySchemaValue(r.description),
      direction: (r.direction as SchemaRelationship["direction"]) ?? "flexible",
      allowed_between: Array.isArray(r.allowed_between)
        ? r.allowed_between.map(String)
        : undefined,
      sources: Array.isArray(r.sources) ? r.sources.map(String) : undefined,
      targets: Array.isArray(r.targets) ? r.targets.map(String) : undefined,
      template_heading: stringifySchemaValue(r.template_heading) || key,
    };
  }

  // tag_rules
  const rawTagRules = (contract.tag_rules as Record<string, unknown>) ?? {};
  const tag_rules: SchemaTagRules = {
    require_namespace: Boolean(rawTagRules.require_namespace ?? true),
    unknown_tags: (rawTagRules.unknown_tags as SchemaTagRules["unknown_tags"]) ?? "warning",
    severity: (rawTagRules.severity as SchemaTagRules["severity"]) ?? "warning",
    allowed_namespaces: Array.isArray(rawTagRules.allowed_namespaces)
      ? rawTagRules.allowed_namespaces.map(String)
      : [],
    forbidden_namespaces: Array.isArray(rawTagRules.forbidden_namespaces)
      ? rawTagRules.forbidden_namespaces.map(String)
      : [],
  };

  // exempt_paths
  const exempt_paths = Array.isArray(contract.exempt_paths)
    ? contract.exempt_paths.map(String)
    : [];

  return {
    version,
    frontmatter,
    inline,
    ontology: { relationships },
    tag_rules,
    exempt_paths,
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface SchemaValidationIssue {
  severity: "error" | "warning";
  message: string;
}

export function validateSchemaNote(
  raw: string,
  settings?: ForgeSettings
): SchemaValidationIssue[] {
  const issues: SchemaValidationIssue[] = [];

  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    issues.push({ severity: "error", message: "schema.md is missing YAML frontmatter block" });
    return issues;
  }

  const bodyText = fmMatch[2] ?? "";

  const vLoc = settings?.schemaVersionLocation ?? "inline";
  const vField = settings?.schemaVersionField ?? "version";

  if (vLoc === "frontmatter") {
    try {
      const fmData = parseYaml(fmMatch[1] ?? "") as Record<string, unknown> | null;
      if (!fmData?.[vField]) {
        issues.push({ severity: "error", message: `schema.md frontmatter is missing '${vField}' field` });
      }
    } catch {
      issues.push({ severity: "error", message: "schema.md frontmatter could not be parsed for version check" });
    }
  } else {
    // Handles both bare (version:: 7.0) and quoted (version:: "7.0") forms.
    const escaped = vField.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`^${escaped}::\\s*(?:"[^"]+"|\\'[^\\']+\\'|\\S+)\\s*$`, "m").test(bodyText)) {
      issues.push({ severity: "error", message: `schema.md is missing '${vField}:: ...' inline metadata` });
    }
  }

  const contractYaml = extractContractBlock(bodyText);
  if (!contractYaml) {
    issues.push({ severity: "error", message: "Could not find a fenced YAML block under # Contract in schema.md" });
    return issues;
  }

  let contract: Record<string, unknown>;
  try {
    contract = parseYaml(contractYaml) as Record<string, unknown>;
  } catch (e) {
    issues.push({ severity: "error", message: `Schema contract YAML is not parseable: ${e}` });
    return issues;
  }

  if (!contract) {
    issues.push({ severity: "error", message: "Schema contract block is empty" });
    return issues;
  }

  // ── Required top-level keys ───────────────────────────────────────────────
  for (const key of ["frontmatter", "inline", "ontology", "tag_rules", "exempt_paths"]) {
    if (contract[key] === undefined || contract[key] === null) {
      issues.push({ severity: "error", message: `Schema contract is missing required key: '${key}'` });
    }
  }

  // ── frontmatter ───────────────────────────────────────────────────────────
  const fm = contract.frontmatter as Record<string, unknown> | undefined;
  if (fm) {
    if (!Array.isArray(fm.required)) {
      issues.push({ severity: "error", message: "frontmatter.required must be a list" });
    } else {
      fm.required.forEach((entry: unknown, i: number) => {
        const e = entry as Record<string, unknown>;
        const name = stringifySchemaValue(e.name);
        if (!e || typeof e !== "object") {
          issues.push({ severity: "error", message: `frontmatter.required[${i}] must be an object` });
          return;
        }
        if (!e.name) issues.push({ severity: "error", message: `frontmatter.required[${i}] is missing 'name'` });
        if (!e.type) issues.push({ severity: "error", message: `frontmatter.required[${i}] ('${name}') is missing 'type'` });
        if (!e.severity) issues.push({ severity: "error", message: `frontmatter.required[${i}] ('${name}') is missing 'severity'` });
        if (e.type === "enum" && !Array.isArray(e.values)) {
          issues.push({ severity: "error", message: `frontmatter.required[${i}] ('${name}') is type enum but has no values list` });
        }
        if (e.values_meta && typeof e.values_meta === "object" && Array.isArray(e.values)) {
          const metaKeys = Object.keys(e.values_meta);
          const valueKeys = e.values as string[];
          const missing = valueKeys.filter((v) => !metaKeys.includes(v));
          if (missing.length > 0) {
            issues.push({ severity: "warning", message: `frontmatter.required ('${name}') values_meta is missing keys: ${missing.join(", ")}` });
          }
        }
      });
    }

    if (!Array.isArray(fm.optional)) {
      issues.push({ severity: "error", message: "frontmatter.optional must be a list" });
    } else {
      fm.optional.forEach((entry: unknown, i: number) => {
        const e = entry as Record<string, unknown>;
        const name = stringifySchemaValue(e.name);
        if (!e || typeof e !== "object") {
          issues.push({ severity: "error", message: `frontmatter.optional[${i}] must be an object` });
          return;
        }
        if (!e.name) issues.push({ severity: "error", message: `frontmatter.optional[${i}] is missing 'name'` });
        if (!e.type) issues.push({ severity: "error", message: `frontmatter.optional[${i}] ('${name}') is missing 'type'` });
        if (!e.severity) issues.push({ severity: "error", message: `frontmatter.optional[${i}] ('${name}') is missing 'severity'` });
        if (e.type === "enum" && !Array.isArray(e.values)) {
          issues.push({ severity: "error", message: `frontmatter.optional[${i}] ('${name}') is type enum but has no values list` });
        }
      });
    }
  }

  // ── inline ────────────────────────────────────────────────────────────────
  const inl = contract.inline as Record<string, unknown> | undefined;
  if (inl) {
    if (!Array.isArray(inl.allowed)) {
      issues.push({ severity: "error", message: "inline.allowed must be a list" });
    } else {
      inl.allowed.forEach((entry: unknown, i: number) => {
        const e = entry as Record<string, unknown>;
        const name = stringifySchemaValue(e.name);
        if (!e || typeof e !== "object") {
          issues.push({ severity: "error", message: `inline.allowed[${i}] must be an object` });
          return;
        }
        if (!e.name) {
          issues.push({ severity: "error", message: `inline.allowed[${i}] is missing 'name'` });
        }
        if (e.required_when) {
          const rw = e.required_when as Record<string, unknown>;
          if (!rw.field) issues.push({ severity: "error", message: `inline.allowed[${i}] ('${name}') required_when is missing 'field'` });
          if (!Array.isArray(rw.values) || rw.values.length === 0) {
            issues.push({ severity: "error", message: `inline.allowed[${i}] ('${name}') required_when.values must be a non-empty list` });
          }
        }
      });
    }
  }

  // ── ontology ──────────────────────────────────────────────────────────────
  // Only validate relationship entries if a feature that consumes them is enabled.
  const validateRelationships = settings
    ? settings.shapeLintEnabled || settings.exportEnabled
    : true; // if no settings passed, validate unconditionally

  const ont = contract.ontology as Record<string, unknown> | undefined;
  if (ont) {
    if (typeof ont.relationships !== "object" || Array.isArray(ont.relationships)) {
      issues.push({ severity: "error", message: "ontology.relationships must be a map" });
    } else if (validateRelationships && ont.relationships) {
      const rels = ont.relationships as Record<string, unknown>;
      for (const [relName, relVal] of Object.entries(rels)) {
        const r = relVal as Record<string, unknown>;
        if (!r || typeof r !== "object") {
          issues.push({ severity: "error", message: `ontology.relationships.${relName} must be an object` });
          continue;
        }
        if (!r.description) issues.push({ severity: "warning", message: `ontology.relationships.${relName} is missing 'description'` });
        if (!r.direction) issues.push({ severity: "error", message: `ontology.relationships.${relName} is missing 'direction'` });
        if (!r.template_heading) issues.push({ severity: "error", message: `ontology.relationships.${relName} is missing 'template_heading'` });
        if (r.direction === "flexible" && !Array.isArray(r.allowed_between)) {
          issues.push({ severity: "error", message: `ontology.relationships.${relName} is direction:flexible but has no allowed_between list` });
        }
        if (r.direction === "directional") {
          if (!Array.isArray(r.sources) || (r.sources as unknown[]).length === 0) {
            issues.push({ severity: "error", message: `ontology.relationships.${relName} is direction:directional but has no sources list` });
          }
          if (!Array.isArray(r.targets) || (r.targets as unknown[]).length === 0) {
            issues.push({ severity: "error", message: `ontology.relationships.${relName} is direction:directional but has no targets list` });
          }
        }
      }
    }
  }

  // ── tag_rules ─────────────────────────────────────────────────────────────
  const tr = contract.tag_rules as Record<string, unknown> | undefined;
  if (tr) {
    if (!Array.isArray(tr.allowed_namespaces)) {
      issues.push({ severity: "error", message: "tag_rules.allowed_namespaces must be a list" });
    }
    if (tr.forbidden_namespaces !== undefined && !Array.isArray(tr.forbidden_namespaces)) {
      issues.push({ severity: "error", message: "tag_rules.forbidden_namespaces must be a list if present" });
    }
  }

  // ── exempt_paths ──────────────────────────────────────────────────────────
  if (contract.exempt_paths !== undefined && !Array.isArray(contract.exempt_paths)) {
    issues.push({ severity: "error", message: "exempt_paths must be a list" });
  }

  return issues;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractContractBlock(bodyText: string): string | null {
  const underContract = bodyText.match(
    /^#\s+Contract\s*$[\s\S]*?^```+\s*yaml\s*\r?\n([\s\S]*?)^```+\s*$/m
  );
  if (underContract) return underContract[1].trim();

  const anywhere = bodyText.match(/^```+\s*yaml\s*\r?\n([\s\S]*?)^```+\s*$/m);
  if (anywhere) return anywhere[1].trim();

  return null;
}

function coerceFieldArray(raw: unknown): SchemaField[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .map((item) => {
      let values_meta: SchemaField["values_meta"] | undefined;
      if (item.values_meta && typeof item.values_meta === "object") {
        values_meta = {};
        for (const [k, v] of Object.entries(item.values_meta as Record<string, unknown>)) {
          const entry = v as Record<string, unknown> | null;
          values_meta[k] = {
            days: entry?.days === null || entry?.days === undefined ? null : Number(entry.days),
          };
        }
      }
      return {
        name: stringifySchemaValue(item.name),
        type: (item.type as SchemaField["type"]) ?? "string",
        values: Array.isArray(item.values) ? item.values.map(String) : undefined,
        values_meta,
        severity: (item.severity as SchemaField["severity"]) ?? "warning",
        min_items: item.min_items !== undefined ? Number(item.min_items) : undefined,
        strict_parse: item.strict_parse !== undefined ? Boolean(item.strict_parse) : undefined,
        description: item.description ? stringifySchemaValue(item.description) : undefined,
      };
    })
    .filter((f) => f.name.length > 0);
}

function coerceInlineFieldArray(raw: unknown): SchemaInlineField[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .map((item) => {
      const field: SchemaInlineField = { name: stringifySchemaValue(item.name) };
      if (item.severity) {
        field.severity = item.severity as SchemaInlineField["severity"];
      }
      if (item.required_when && typeof item.required_when === "object") {
        const rw = item.required_when as Record<string, unknown>;
        field.required_when = {
          field: stringifySchemaValue(rw.field),
          values: Array.isArray(rw.values) ? rw.values.map(String) : [],
        };
      }
      return field;
    })
    .filter((f) => f.name.length > 0);
}
