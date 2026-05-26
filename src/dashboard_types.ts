import type { LintResult } from "./lint-engine";
import type { SchemaValidationIssue } from "./utils/schema";

export const DASHBOARD_CACHE_SCHEMA_VERSION = 1;

export type DashboardSeverity = "info" | "warning" | "critical";

export interface DashboardIssue {
  file_path: string;
  issue_type: string;
  severity: DashboardSeverity;
  message: string;
  suggested_action?: string;
  source_command: string;
}

export interface DashboardSummary {
  notes_scanned: number;
  lint_issue_count: number;
  schema_violation_count: number;
  broken_shape_count: number;
  invalid_frontmatter_count: number;
  normalization_candidates: number | null;
  unresolved_links: number | null;
}

export interface LintScanResult {
  schema_version: number;
  source_command: "run-vault-lint" | "refresh-vault-health-dashboard";
  generated_at: string;
  duration_ms: number;
  files_scanned: number;
  issues: DashboardIssue[];
  errors: number;
  warnings: number;
  infos: number;
}

export interface SchemaValidationResult {
  schema_version: number;
  source_command: "validate-schema" | "refresh-vault-health-dashboard";
  generated_at: string;
  duration_ms: number;
  files_scanned: number;
  schema_path: string;
  violations: DashboardIssue[];
  errors: number;
  warnings: number;
}

export interface OntologyMetricsResult {
  schema_version: number;
  source_command: "export-ontology-index" | "refresh-vault-health-dashboard";
  generated_at: string;
  duration_ms: number;
  shape_count: number;
  template_count: number;
  relationship_type_count: number;
  folder_coverage: Record<string, number>;
  tag_distribution: Record<string, number>;
  orphaned_entities: number | null;
}

export interface PatchRunSummary {
  run_id: string;
  description: string;
  applied_at: string;
  changed_files: number;
  patch_file?: string;
  schema_version?: string;
}

export interface PatchHistoryResult {
  schema_version: number;
  source_command: "patch-history" | "refresh-vault-health-dashboard";
  generated_at: string;
  duration_ms: number;
  last_patch_run: PatchRunSummary | null;
  last_repair_run: PatchRunSummary | null;
  restored_runs_available: number;
  last_normalization_run: PatchRunSummary | null;
  lint_scans: number;
}

export interface DashboardSnapshot {
  schema_version: number;
  source_command: "refresh-vault-health-dashboard";
  generated_at: string;
  duration_ms: number;
  vault_name: string;
  summary: DashboardSummary;
  issues: DashboardIssue[];
  lint: LintScanResult | null;
  schema: SchemaValidationResult | null;
  ontology: OntologyMetricsResult | null;
  patch_history: PatchHistoryResult | null;
}

export interface DashboardCacheFile {
  schema_version: number;
  latest_lint_result: LintScanResult | null;
  latest_schema_result: SchemaValidationResult | null;
  latest_ontology_result: OntologyMetricsResult | null;
  latest_patch_history_result: PatchHistoryResult | null;
  dashboard_snapshot: DashboardSnapshot | null;
}

export function lintResultToDashboardIssue(result: LintResult): DashboardIssue {
  return {
    file_path: result.file,
    issue_type: result.rule,
    severity: result.severity === "error" ? "critical" : result.severity,
    message: result.message,
    suggested_action: suggestedActionForLintRule(result.rule),
    source_command: "run-vault-lint",
  };
}

export function schemaIssueToDashboardIssue(
  issue: SchemaValidationIssue,
  schemaPath: string
): DashboardIssue {
  return {
    file_path: schemaPath,
    issue_type: "schema_validation",
    severity: issue.severity === "error" ? "critical" : "warning",
    message: issue.message,
    suggested_action: "Open schema.md and update the schema contract.",
    source_command: "validate-schema",
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
    case "tag_namespace":
    case "unknown_tag_namespace":
    case "forbidden_namespace":
      return "Normalize the tag namespace.";
    case "invalid_shape_ref":
      return "Use a shape that exists in the shapes folder.";
    default:
      return "Review this file against the current Forge schema.";
  }
}
