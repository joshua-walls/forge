import { getTags } from "../utils/tags.js";
import { localTimestamp, normalisePath, todayString } from "../vault/paths.js";
import type { ForgeDocument, LintResult } from "../linting/model.js";
import type { PatchOperation } from "../patching/model.js";
import type { ForgeYamlStringifier } from "../patching/model.js";
import type { ForgeSettings } from "../config/settings.js";
import {
  getFrontmatterField,
  type VaultSchema,
} from "../schemas/schema.js";

export type RepairThreshold = ForgeSettings["lintRepairThreshold"];
export type RepairTagAction = "skip" | "remove";
export type RepairTagDecisionAction = "skip" | "remove" | "replace";
export type RepairOperation = PatchOperation;

export interface BuildRepairPatchContentOptions {
  operations: RepairOperation[];
  schemaVersion?: string;
  generatedAt?: string;
  today?: string;
  description?: string;
  source?: string;
  stringifyYaml: ForgeYamlStringifier;
}

export interface BuildDefaultRepairOperationsInput {
  schema: VaultSchema;
  issues: LintResult[];
  documents?: ForgeDocument[];
  threshold?: RepairThreshold;
  today?: string;
  tagAction?: RepairTagAction;
}

export interface BuildDefaultRepairOperationsResult {
  operations: RepairOperation[];
  repairableIssues: LintResult[];
  skippedIssues: LintResult[];
  filesWithOperations: string[];
}

export interface RepairFieldCandidate {
  field: string;
  defaultValue: unknown;
}

export interface RepairTagCandidate {
  issue: LintResult;
  namespace: string;
  tag: string;
}

export interface RepairFileCandidate {
  file: string;
  issues: LintResult[];
  fieldCandidates: RepairFieldCandidate[];
  tagCandidates: RepairTagCandidate[];
  unresolvedTagIssues: LintResult[];
}

export interface BuildRepairFileCandidatesInput {
  schema: VaultSchema;
  issues: LintResult[];
  documents?: ForgeDocument[];
  threshold?: RepairThreshold;
  today?: string;
}

export interface RepairFieldValue {
  file: string;
  field: string;
  value: unknown;
}

export interface RepairTagDecision {
  file: string;
  tag: string;
  action: RepairTagDecisionAction;
  newTag?: string;
}

export interface BuildCuratedRepairOperationsInput {
  candidates: RepairFileCandidate[];
  includedFiles?: string[];
  fieldValues?: RepairFieldValue[];
  tagDecisions?: RepairTagDecision[];
}

const REPAIRABLE_RULES = new Set([
  "no_frontmatter",
  "required_field",
  "type_mismatch",
  "enum_value",
  "date_format",
  "required_when",
  "tag_namespace",
  "unknown_tag_namespace",
  "forbidden_namespace",
  "stale_date",
]);

export function isRepairableLintResult(
  result: Pick<LintResult, "rule" | "severity">,
  threshold: RepairThreshold = "errors_only"
): boolean {
  if (!REPAIRABLE_RULES.has(result.rule)) return false;
  if (result.severity === "error") return true;
  return result.severity === "warning" && threshold === "errors_and_warnings";
}

export function filterRepairableLintResults(
  results: LintResult[],
  threshold: RepairThreshold = "errors_only"
): LintResult[] {
  return results.filter((result) => isRepairableLintResult(result, threshold));
}

export function getRepairFieldsToFix(schema: VaultSchema, issues: LintResult[]): string[] {
  const fields = new Set<string>();

  if (issues.some((issue) => issue.rule === "no_frontmatter")) {
    for (const field of schema.frontmatter.required) fields.add(field.name);
    return [...fields];
  }

  for (const issue of issues) {
    const field = extractRepairFieldName(issue);
    if (field && getFrontmatterField(schema, field)) fields.add(field);
  }

  return [...fields];
}

export function getRepairDefaultValue(
  schema: VaultSchema,
  fieldName: string,
  today = todayString()
): unknown {
  const field = getFrontmatterField(schema, fieldName);
  const values = field?.type === "enum" ? field.values : undefined;

  switch (fieldName) {
    case "created":
    case "updated":
    case "review_by":
      return today;
    case "ai_private":
      return false;
    case "review_cycle":
      return "never";
    case "status":
      return values?.includes("active") ? "active" : values?.[0] ?? "";
  }

  switch (field?.type) {
    case "boolean":
      return false;
    case "enum":
      return values?.[0] ?? "";
    case "date":
      return today;
    case "list":
      return [];
    default:
      return "";
  }
}

export function extractRepairTagNamespace(issue: Pick<LintResult, "rule" | "message">): string | null {
  if (issue.rule === "tag_namespace") {
    const match = issue.message.match(/^Tag '([^']+)' is not namespaced/u);
    return match?.[1] ?? null;
  }

  if (issue.rule === "unknown_tag_namespace" || issue.rule === "forbidden_namespace") {
    const match = issue.message.match(/^Tag namespace '([^']+)'/u);
    return match?.[1] ?? null;
  }

  return null;
}

export function matchingTagsForRepairIssue(
  issue: Pick<LintResult, "rule" | "message">,
  tags: string[]
): string[] {
  const namespace = extractRepairTagNamespace(issue);
  if (!namespace) return [];

  if (issue.rule === "tag_namespace") {
    return tags.includes(namespace) ? [namespace] : [];
  }

  return tags.filter((tag) => {
    const slashIndex = tag.indexOf("/");
    return slashIndex >= 0 && tag.slice(0, slashIndex) === namespace;
  });
}

export function buildRepairFileCandidates(
  input: BuildRepairFileCandidatesInput
): RepairFileCandidate[] {
  const threshold = input.threshold ?? "errors_only";
  const repairableIssues = filterRepairableLintResults(input.issues, threshold);
  const byFile = groupBy(repairableIssues, (issue) => issue.file);
  const documentsByPath = new Map((input.documents ?? []).map((document) => [document.path, document]));

  return Object.entries(byFile).map(([file, issues]) => {
    const fieldCandidates = getRepairFieldsToFix(input.schema, issues).map((field) => ({
      field,
      defaultValue: getRepairDefaultValue(input.schema, field, input.today),
    }));

    const document = documentsByPath.get(file);
    const tags = document ? getTags(document.frontmatter) : [];
    const tagCandidates: RepairTagCandidate[] = [];
    const unresolvedTagIssues: LintResult[] = [];
    for (const issue of issues.filter(isTagRepairIssue)) {
      const namespace = extractRepairTagNamespace(issue);
      const matchingTags = matchingTagsForRepairIssue(issue, tags);
      if (!namespace || matchingTags.length === 0) {
        unresolvedTagIssues.push(issue);
        continue;
      }

      for (const tag of matchingTags) {
        tagCandidates.push({ issue, namespace, tag });
      }
    }

    return {
      file,
      issues,
      fieldCandidates,
      tagCandidates,
      unresolvedTagIssues,
    };
  });
}

export function buildCuratedRepairOperations(
  input: BuildCuratedRepairOperationsInput
): BuildDefaultRepairOperationsResult {
  const included = input.includedFiles
    ? new Set(input.includedFiles.map(normalisePath))
    : null;
  const fieldValues = new Map<string, unknown>();
  for (const field of input.fieldValues ?? []) {
    fieldValues.set(repairFieldKey(field.file, field.field), field.value);
  }
  const tagDecisions = new Map<string, RepairTagDecision>();
  for (const decision of input.tagDecisions ?? []) {
    tagDecisions.set(repairTagKey(decision.file, decision.tag), decision);
  }
  const operations: RepairOperation[] = [];
  const repairableIssues: LintResult[] = [];
  for (const candidate of input.candidates) {
    repairableIssues.push(...candidate.issues);
  }
  const skippedIssues: LintResult[] = [];

  for (const candidate of input.candidates) {
    if (included && !included.has(normalisePath(candidate.file))) {
      skippedIssues.push(...candidate.issues);
      continue;
    }

    for (const field of candidate.fieldCandidates) {
      const key = repairFieldKey(candidate.file, field.field);
      const value = fieldValues.has(key) ? fieldValues.get(key) : field.defaultValue;
      if (value !== "" && value !== undefined) {
        operations.push({ op: "set_field", target: candidate.file, field: field.field, value });
      }
    }

    for (const tagCandidate of candidate.tagCandidates) {
      const decision = tagDecisions.get(repairTagKey(candidate.file, tagCandidate.tag));
      if (!decision || decision.action === "skip") {
        skippedIssues.push(tagCandidate.issue);
        continue;
      }

      if (decision.action === "remove") {
        operations.push({ op: "remove_tag", target: candidate.file, tag: tagCandidate.tag });
        continue;
      }

      const newTag = decision.newTag?.trim();
      if (newTag) {
        operations.push({
          op: "replace_tag",
          target: candidate.file,
          old_tag: tagCandidate.tag,
          new_tag: newTag,
        });
      } else {
        skippedIssues.push(tagCandidate.issue);
      }
    }

    skippedIssues.push(...candidate.unresolvedTagIssues);
  }

  return {
    operations,
    repairableIssues,
    skippedIssues,
    filesWithOperations: getFilesWithOperations(operations),
  };
}

export function buildDefaultRepairOperations(
  input: BuildDefaultRepairOperationsInput
): BuildDefaultRepairOperationsResult {
  const threshold = input.threshold ?? "errors_only";
  const tagAction = input.tagAction ?? "skip";
  const repairableIssues = filterRepairableLintResults(input.issues, threshold);
  const byFile = groupBy(repairableIssues, (issue) => issue.file);
  const documentsByPath = new Map((input.documents ?? []).map((document) => [document.path, document]));
  const operations: RepairOperation[] = [];
  const skippedIssues: LintResult[] = [];

  for (const [file, issues] of Object.entries(byFile)) {
    for (const fieldName of getRepairFieldsToFix(input.schema, issues)) {
      const value = getRepairDefaultValue(input.schema, fieldName, input.today);
      if (value !== "" && value !== undefined) {
        operations.push({ op: "set_field", target: file, field: fieldName, value });
      }
    }

    const tagIssues = issues.filter((issue) =>
      issue.rule === "tag_namespace" ||
      issue.rule === "unknown_tag_namespace" ||
      issue.rule === "forbidden_namespace"
    );
    const document = documentsByPath.get(file);
    const tags = document ? getTags(document.frontmatter) : [];
    for (const issue of tagIssues) {
      if (tagAction !== "remove") {
        skippedIssues.push(issue);
        continue;
      }

      const matchingTags = matchingTagsForRepairIssue(issue, tags);
      if (matchingTags.length === 0) {
        skippedIssues.push(issue);
        continue;
      }

      for (const tag of matchingTags) {
        operations.push({ op: "remove_tag", target: file, tag });
      }
    }
  }

  return {
    operations,
    repairableIssues,
    skippedIssues,
    filesWithOperations: getFilesWithOperations(operations),
  };
}

function isTagRepairIssue(issue: Pick<LintResult, "rule">): boolean {
  return issue.rule === "tag_namespace" ||
    issue.rule === "unknown_tag_namespace" ||
    issue.rule === "forbidden_namespace";
}

function repairFieldKey(file: string, field: string): string {
  return `${normalisePath(file)}\0${field}`;
}

function repairTagKey(file: string, tag: string): string {
  return `${normalisePath(file)}\0${tag}`;
}

export function buildRepairPatchContent(options: BuildRepairPatchContentOptions): string {
  const today = options.today ?? todayString();
  const patch = {
    meta: {
      generated_at: options.generatedAt ?? localTimestamp(),
      description: options.description ?? "Repair pass — interactive fix of lint errors",
      schema_version: options.schemaVersion ?? "",
      source: options.source ?? "Forge — Vault Repair",
      contains_schema_changes: false,
    },
    operations: options.operations,
  };
  const yaml = trimTrailingWhitespace(options.stringifyYaml(patch));

  return [
    "---",
    "type: procedure",
    "status: draft",
    "tags:",
    "  - tool/forge",
    `created: ${today}`,
    `updated: ${today}`,
    "ai_private: false",
    "review_cycle: never",
    "---",
    "",
    "# Vault Patch",
    "",
    "Patch generated by Forge Repair.",
    "",
    "## Patch",
    "",
    "```yaml",
    yaml,
    "```",
    "",
  ].join("\n");
}

function extractRepairFieldName(issue: LintResult): string | null {
  if (
    issue.rule === "required_field" ||
    issue.rule === "enum_value" ||
    issue.rule === "required_when" ||
    issue.rule === "type_mismatch" ||
    issue.rule === "date_format" ||
    issue.rule === "stale_date"
  ) {
    const match = issue.message.match(/Field '([\w_]+)'|Missing required field: '([\w_]*)'/u);
    return match?.[1] || match?.[2] || null;
  }

  return null;
}

function trimTrailingWhitespace(value: string): string {
  return value.replace(/\s+$/u, "");
}

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const value = key(item);
    acc[value] ??= [];
    acc[value].push(item);
    return acc;
  }, {});
}

function getFilesWithOperations(operations: RepairOperation[]): string[] {
  const files = new Set<string>();
  for (const operation of operations) {
    if (typeof operation.target === "string") {
      files.add(operation.target);
    }
  }
  return [...files];
}
