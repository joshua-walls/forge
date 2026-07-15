import {
  DASHBOARD_CACHE_SCHEMA_VERSION,
  type DashboardSnapshot,
  type LintScanResult,
  type OntologyMetricsResult,
  type OperationalRunSummary,
  type PatchHistoryResult,
  type SchemaValidationResult,
  type ShapeLintResult,
  type VaultFileInventoryResult,
} from "@forge/core";

export { DASHBOARD_CACHE_SCHEMA_VERSION };
export {
  buildDashboardSnapshot,
  buildDashboardTabStates,
  buildVaultFileInventory,
  defaultDashboardTabId,
  buildLintScanResult,
  buildOntologyMetricsResult,
  buildPatchHistoryResult,
  buildSchemaValidationResult,
  buildShapeLintResult,
  lintResultToDashboardIssue,
  schemaIssueToDashboardIssue,
} from "@forge/core";
export type {
  DashboardIssue,
  DashboardSeverity,
  DashboardSnapshot,
  DashboardSummary,
  DashboardTabId,
  DashboardTabState,
  LintScanResult,
  OntologyMetricsDocument,
  OntologyMetricsResult,
  OntologyMetricsSourceCommand,
  OperationalRunCommand,
  OperationalRunStatus,
  OperationalRunSummary,
  PatchHistoryResult,
  PatchHistorySourceCommand,
  PatchRunSummary,
  SchemaValidationResult,
  ShapeLintResult,
  ShapeLintSummary,
  VaultFileCategory,
  VaultFileCategorySummary,
  VaultFileInventoryResult,
  VaultFileRecord,
} from "@forge/core";

export interface DashboardCacheFile {
  schema_version: number;
  // Stamped on every write. Used by the dashboard view to detect when a
  // plugin update has changed the render logic and a reload is needed.
  forge_version: string;
  latest_lint_result: LintScanResult | null;
  latest_schema_result: SchemaValidationResult | null;
  latest_ontology_result: OntologyMetricsResult | null;
  latest_file_inventory_result: VaultFileInventoryResult | null;
  latest_shape_lint_result: ShapeLintResult | null;
  latest_patch_history_result: PatchHistoryResult | null;
  operational_history: OperationalRunSummary[] | null;
  dashboard_snapshot: DashboardSnapshot | null;
}
