import type { ForgeSettings } from "./settings.js";
import { splitFrontmatter } from "./frontmatter.js";

export type ForgeYamlParser = (source: string) => unknown;

function stringifySchemaValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

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
  unique?: boolean;
  pattern?: string;
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

export interface ParseSchemaNoteOptions {
  versionLocation?: "frontmatter" | "inline";
  versionField?: string;
  parseYaml: ForgeYamlParser;
}

export interface ValidateSchemaNoteOptions {
  settings?: Pick<
    ForgeSettings,
    "schemaVersionLocation" | "schemaVersionField" | "shapesEnabled" | "shapeLintEnabled" | "exportEnabled"
  >;
  parseYaml: ForgeYamlParser;
}

export interface SchemaValidationIssue {
  severity: "error" | "warning";
  message: string;
}

export function allFrontmatterFields(schema: VaultSchema): SchemaField[] {
  return [...schema.frontmatter.required, ...schema.frontmatter.optional];
}

export function getFrontmatterField(
  schema: VaultSchema,
  name: string
): SchemaField | undefined {
  return allFrontmatterFields(schema).find(
    (field) => field.name.toLowerCase() === name.toLowerCase()
  );
}

export function inlineFieldNameSet(schema: VaultSchema): Set<string> {
  return new Set(schema.inline.allowed.map((field) => field.name.toLowerCase()));
}

export function conditionallyRequiredInlineFields(schema: VaultSchema): SchemaInlineField[] {
  return schema.inline.allowed.filter((field) => field.required_when !== undefined);
}

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

export function parseSchemaNote(raw: string, options: ParseSchemaNoteOptions): VaultSchema | null {
  const split = splitFrontmatter(raw);
  if (!split) return null;

  const versionLocation = options.versionLocation ?? "inline";
  const versionField = options.versionField ?? "version";

  let version = "";
  if (versionLocation === "frontmatter") {
    const fmData = parseSchemaObject(split.yaml, options.parseYaml);
    if (!fmData) return null;

    const value = fmData?.[versionField];
    if (value !== undefined && value !== null) version = stringifySchemaValue(value);
  } else {
    const escaped = versionField.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const inlineMatch = split.body.match(
      new RegExp(`^${escaped}::\\s*(?:"([^"]+)"|'([^']+)'|(\\S+))\\s*$`, "m")
    );
    version = (inlineMatch?.[1] ?? inlineMatch?.[2] ?? inlineMatch?.[3] ?? "").trim();
  }

  const contractYaml = extractContractBlock(split.body);
  if (!contractYaml) return null;

  const contract = parseSchemaObject(contractYaml, options.parseYaml);
  if (!contract) return null;

  const rawFm = (contract.frontmatter as Record<string, unknown>) ?? {};
  const frontmatter: SchemaFrontmatter = {
    required: coerceFieldArray(rawFm.required),
    optional: coerceFieldArray(rawFm.optional),
  };

  const rawInline = (contract.inline as Record<string, unknown>) ?? {};
  const inline: SchemaInline = {
    allowed: coerceInlineFieldArray(rawInline.allowed),
  };

  const rawOntology = (contract.ontology as Record<string, unknown>) ?? {};
  const rawRelationships = (rawOntology.relationships as Record<string, unknown>) ?? {};
  const relationships: Record<string, SchemaRelationship> = {};

  for (const [key, val] of Object.entries(rawRelationships)) {
    if (val === null || typeof val !== "object") continue;
    const relationship = val as Record<string, unknown>;
    relationships[key] = {
      description: stringifySchemaValue(relationship.description),
      direction: (relationship.direction as SchemaRelationship["direction"]) ?? "flexible",
      allowed_between: Array.isArray(relationship.allowed_between)
        ? relationship.allowed_between.map(String)
        : undefined,
      sources: Array.isArray(relationship.sources) ? relationship.sources.map(String) : undefined,
      targets: Array.isArray(relationship.targets) ? relationship.targets.map(String) : undefined,
      template_heading: stringifySchemaValue(relationship.template_heading) || key,
    };
  }

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

function parseSchemaObject(
  source: string,
  parseYaml: ForgeYamlParser
): Record<string, unknown> | null {
  try {
    const parsed = parseYaml(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function validateSchemaNote(
  raw: string,
  options: ValidateSchemaNoteOptions
): SchemaValidationIssue[] {
  const issues: SchemaValidationIssue[] = [];
  const split = splitFrontmatter(raw);
  if (!split) {
    issues.push({ severity: "error", message: "schema.md is missing YAML frontmatter block" });
    return issues;
  }

  const settings = options.settings;
  const versionLocation = settings?.schemaVersionLocation ?? "inline";
  const versionField = settings?.schemaVersionField ?? "version";

  if (versionLocation === "frontmatter") {
    try {
      const fmData = options.parseYaml(split.yaml) as Record<string, unknown> | null;
      if (!fmData?.[versionField]) {
        issues.push({ severity: "error", message: `schema.md frontmatter is missing '${versionField}' field` });
      }
    } catch {
      issues.push({ severity: "error", message: "schema.md frontmatter could not be parsed for version check" });
    }
  } else {
    const escaped = versionField.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`^${escaped}::\\s*(?:"[^"]+"|\\'[^\\']+\\'|\\S+)\\s*$`, "m").test(split.body)) {
      issues.push({ severity: "error", message: `schema.md is missing '${versionField}:: ...' inline metadata` });
    }
  }

  const contractYaml = extractContractBlock(split.body);
  if (!contractYaml) {
    issues.push({ severity: "error", message: "Could not find a fenced YAML block under # Contract in schema.md" });
    return issues;
  }

  let contract: Record<string, unknown>;
  try {
    contract = options.parseYaml(contractYaml) as Record<string, unknown>;
  } catch (error) {
    issues.push({ severity: "error", message: `Schema contract YAML is not parseable: ${String(error)}` });
    return issues;
  }

  if (!contract) {
    issues.push({ severity: "error", message: "Schema contract block is empty" });
    return issues;
  }

  validateRequiredTopLevelKeys(contract, issues);
  validateFrontmatterSection(contract, issues);
  validateInlineSection(contract, issues);
  validateOntologySection(
    contract,
    issues,
    settings ? (settings.shapesEnabled && settings.shapeLintEnabled) || settings.exportEnabled : true
  );
  validateTagRulesSection(contract, issues);

  if (contract.exempt_paths !== undefined && !Array.isArray(contract.exempt_paths)) {
    issues.push({ severity: "error", message: "exempt_paths must be a list" });
  }

  return issues;
}

function validateRequiredTopLevelKeys(
  contract: Record<string, unknown>,
  issues: SchemaValidationIssue[]
): void {
  for (const key of ["frontmatter", "inline", "ontology", "tag_rules", "exempt_paths"]) {
    if (contract[key] === undefined || contract[key] === null) {
      issues.push({ severity: "error", message: `Schema contract is missing required key: '${key}'` });
    }
  }
}

function validateFrontmatterSection(
  contract: Record<string, unknown>,
  issues: SchemaValidationIssue[]
): void {
  const fm = contract.frontmatter as Record<string, unknown> | undefined;
  if (!fm) return;

  validateFieldList(fm.required, "frontmatter.required", issues, true);
  validateFieldList(fm.optional, "frontmatter.optional", issues, false);
}

function validateFieldList(
  raw: unknown,
  label: string,
  issues: SchemaValidationIssue[],
  validateValuesMeta: boolean
): void {
  if (!Array.isArray(raw)) {
    issues.push({ severity: "error", message: `${label} must be a list` });
    return;
  }

  raw.forEach((entry: unknown, index: number) => {
    if (!entry || typeof entry !== "object") {
      issues.push({ severity: "error", message: `${label}[${index}] must be an object` });
      return;
    }
    const item = entry as Record<string, unknown>;
    const name = stringifySchemaValue(item.name);
    if (!item.name) issues.push({ severity: "error", message: `${label}[${index}] is missing 'name'` });
    if (!item.type) issues.push({ severity: "error", message: `${label}[${index}] ('${name}') is missing 'type'` });
    if (!item.severity) issues.push({ severity: "error", message: `${label}[${index}] ('${name}') is missing 'severity'` });
    if (item.type === "enum" && !Array.isArray(item.values)) {
      issues.push({ severity: "error", message: `${label}[${index}] ('${name}') is type enum but has no values list` });
    }
    if (item.unique !== undefined && typeof item.unique !== "boolean") {
      issues.push({ severity: "error", message: `${label}[${index}] ('${name}') unique must be true or false` });
    }
    if (item.pattern !== undefined && typeof item.pattern !== "string") {
      issues.push({ severity: "error", message: `${label}[${index}] ('${name}') pattern must be a string` });
    }
    if (typeof item.pattern === "string") {
      try {
        new RegExp(item.pattern);
      } catch {
        issues.push({ severity: "error", message: `${label}[${index}] ('${name}') pattern must be a valid regular expression` });
      }
    }
    if (validateValuesMeta && item.values_meta && typeof item.values_meta === "object" && Array.isArray(item.values)) {
      const metaKeys = Object.keys(item.values_meta);
      const valueKeys = item.values as string[];
      const missing = valueKeys.filter((value) => !metaKeys.includes(value));
      if (missing.length > 0) {
        issues.push({ severity: "warning", message: `${label} ('${name}') values_meta is missing keys: ${missing.join(", ")}` });
      }
    }
  });
}

function validateInlineSection(
  contract: Record<string, unknown>,
  issues: SchemaValidationIssue[]
): void {
  const inline = contract.inline as Record<string, unknown> | undefined;
  if (!inline) return;

  if (!Array.isArray(inline.allowed)) {
    issues.push({ severity: "error", message: "inline.allowed must be a list" });
    return;
  }

  inline.allowed.forEach((entry: unknown, index: number) => {
    if (!entry || typeof entry !== "object") {
      issues.push({ severity: "error", message: `inline.allowed[${index}] must be an object` });
      return;
    }
    const item = entry as Record<string, unknown>;
    const name = stringifySchemaValue(item.name);
    if (!item.name) issues.push({ severity: "error", message: `inline.allowed[${index}] is missing 'name'` });
    if (item.required_when) {
      const requiredWhen = item.required_when as Record<string, unknown>;
      if (!requiredWhen.field) issues.push({ severity: "error", message: `inline.allowed[${index}] ('${name}') required_when is missing 'field'` });
      if (!Array.isArray(requiredWhen.values) || requiredWhen.values.length === 0) {
        issues.push({ severity: "error", message: `inline.allowed[${index}] ('${name}') required_when.values must be a non-empty list` });
      }
    }
  });
}

function validateOntologySection(
  contract: Record<string, unknown>,
  issues: SchemaValidationIssue[],
  validateRelationships: boolean
): void {
  const ontology = contract.ontology as Record<string, unknown> | undefined;
  if (!ontology) return;

  if (typeof ontology.relationships !== "object" || Array.isArray(ontology.relationships)) {
    issues.push({ severity: "error", message: "ontology.relationships must be a map" });
    return;
  }
  if (!validateRelationships || !ontology.relationships) return;

  const relationships = ontology.relationships as Record<string, unknown>;
  for (const [relName, relVal] of Object.entries(relationships)) {
    if (!relVal || typeof relVal !== "object") {
      issues.push({ severity: "error", message: `ontology.relationships.${relName} must be an object` });
      continue;
    }
    const relationship = relVal as Record<string, unknown>;
    if (!relationship.description) issues.push({ severity: "warning", message: `ontology.relationships.${relName} is missing 'description'` });
    if (!relationship.direction) issues.push({ severity: "error", message: `ontology.relationships.${relName} is missing 'direction'` });
    if (!relationship.template_heading) issues.push({ severity: "error", message: `ontology.relationships.${relName} is missing 'template_heading'` });
    if (relationship.direction === "flexible" && !Array.isArray(relationship.allowed_between)) {
      issues.push({ severity: "error", message: `ontology.relationships.${relName} is direction:flexible but has no allowed_between list` });
    }
    if (relationship.direction === "directional") {
      if (!Array.isArray(relationship.sources) || relationship.sources.length === 0) {
        issues.push({ severity: "error", message: `ontology.relationships.${relName} is direction:directional but has no sources list` });
      }
      if (!Array.isArray(relationship.targets) || relationship.targets.length === 0) {
        issues.push({ severity: "error", message: `ontology.relationships.${relName} is direction:directional but has no targets list` });
      }
    }
  }
}

function validateTagRulesSection(
  contract: Record<string, unknown>,
  issues: SchemaValidationIssue[]
): void {
  const tagRules = contract.tag_rules as Record<string, unknown> | undefined;
  if (!tagRules) return;

  if (!Array.isArray(tagRules.allowed_namespaces)) {
    issues.push({ severity: "error", message: "tag_rules.allowed_namespaces must be a list" });
  }
  if (tagRules.forbidden_namespaces !== undefined && !Array.isArray(tagRules.forbidden_namespaces)) {
    issues.push({ severity: "error", message: "tag_rules.forbidden_namespaces must be a list if present" });
  }
}

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
        for (const [key, value] of Object.entries(item.values_meta as Record<string, unknown>)) {
          const entry = value as Record<string, unknown> | null;
          values_meta[key] = {
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
        unique: item.unique === true ? true : undefined,
        pattern: typeof item.pattern === "string" ? item.pattern : undefined,
        strict_parse: item.strict_parse !== undefined ? Boolean(item.strict_parse) : undefined,
        description: item.description ? stringifySchemaValue(item.description) : undefined,
        lint_rules: Array.isArray(item.lint_rules)
          ? item.lint_rules.filter((rule): rule is SchemaLintRule => rule !== null && typeof rule === "object")
          : undefined,
      };
    })
    .filter((field) => field.name.length > 0);
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
        const requiredWhen = item.required_when as Record<string, unknown>;
        field.required_when = {
          field: stringifySchemaValue(requiredWhen.field),
          values: Array.isArray(requiredWhen.values) ? requiredWhen.values.map(String) : [],
        };
      }
      return field;
    })
    .filter((field) => field.name.length > 0);
}
