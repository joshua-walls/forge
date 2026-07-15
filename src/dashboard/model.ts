import { lintResultToDashboardIssue, type LintResult, type LintRunResult } from "../linting/model.js";
import type { ShapeLintRunResult } from "../shapes/lint.js";
import { normalisePath } from "../vault/paths.js";
import { getTags } from "../utils/tags.js";

export const DASHBOARD_CACHE_SCHEMA_VERSION = 3;

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
  review_item_count: number;
  schema_violation_count: number;
  broken_shape_count: number;
  invalid_frontmatter_count: number;
  normalization_candidates: number | null;
  unresolved_links: number | null;
}

export type DashboardTabId = "overview" | "issues" | "note" | "tools";

export type DashboardTabBadgeTone = "critical" | "warning" | "good" | "muted";

export interface DashboardTabDefinition {
  id: DashboardTabId;
  label: string;
  shortLabel: string;
  sectionKeys: readonly string[];
}

export interface DashboardTabBadge {
  label: string;
  tone: DashboardTabBadgeTone;
  title: string;
}

export interface DashboardTabState extends DashboardTabDefinition {
  badge: DashboardTabBadge | null;
}

export interface DashboardCurrentNoteTabInput {
  issueCount?: number | null;
  reviewItemCount?: number | null;
}

export interface BuildDashboardTabStatesInput {
  snapshot: DashboardSnapshot;
  currentNote?: DashboardCurrentNoteTabInput | null;
}

export const DASHBOARD_TABS: readonly DashboardTabDefinition[] = [
  {
    id: "overview",
    label: "Overview",
    shortLabel: "Overview",
    sectionKeys: ["summary", "recommendations", "vault-inventory", "ontology"],
  },
  {
    id: "note",
    label: "Note",
    shortLabel: "Note",
    sectionKeys: ["current-note"],
  },
  {
    id: "issues",
    label: "Issues",
    shortLabel: "Issues",
    sectionKeys: ["active-issues", "shape-health", "needs-review"],
  },
  {
    id: "tools",
    label: "Tools",
    shortLabel: "Tools",
    sectionKeys: ["actions", "schema-health", "lockblock", "maintenance-history"],
  },
];

export type LintScanSourceCommand = "run-vault-lint" | "refresh-vault-health-dashboard";

export interface LintScanResult {
  schema_version: number;
  source_command: LintScanSourceCommand;
  generated_at: string;
  duration_ms: number;
  files_scanned: number;
  issues: DashboardIssue[];
  review_items: DashboardIssue[];
  errors: number;
  warnings: number;
  infos: number;
}

export type SchemaValidationSourceCommand = "validate-schema" | "refresh-vault-health-dashboard";

export interface SchemaValidationResult {
  schema_version: number;
  source_command: SchemaValidationSourceCommand;
  generated_at: string;
  duration_ms: number;
  files_scanned: number;
  schema_path: string;
  violations: DashboardIssue[];
  errors: number;
  warnings: number;
}

export interface SchemaValidationIssueLike {
  severity: "error" | "warning";
  message: string;
}

export interface BuildSchemaValidationResultInput {
  sourceCommand: SchemaValidationSourceCommand;
  generatedAt?: string;
  durationMs: number;
  filesScanned: number;
  schemaPath: string;
  issues?: readonly SchemaValidationIssueLike[];
  violations?: readonly DashboardIssue[];
}

export interface ShapeLintSummary {
  files_scanned: number;
  issue_count: number;
  missing_heading_count: number;
  heading_order_issue_count: number;
  extra_heading_count: number;
  empty_section_count: number;
}

export type ShapeLintSourceCommand = "run-shape-lint" | "refresh-vault-health-dashboard";

export interface ShapeLintResult {
  schema_version: number;
  source_command: ShapeLintSourceCommand;
  generated_at: string;
  duration_ms: number;
  files_scanned: number;
  issues: DashboardIssue[];
  summary: ShapeLintSummary;
  errors: number;
  warnings: number;
  infos: number;
}

export type OntologyMetricsSourceCommand = "export-ontology-index" | "refresh-vault-health-dashboard";

export interface OntologyMetricsResult {
  schema_version: number;
  source_command: OntologyMetricsSourceCommand;
  generated_at: string;
  duration_ms: number;
  shape_count: number;
  template_count: number;
  relationship_type_count: number;
  folder_coverage: Record<string, number>;
  tag_distribution: Record<string, number>;
  orphaned_entities: number | null;
}

export interface OntologyMetricsDocument {
  path: string;
  frontmatter?: Record<string, unknown>;
}

export interface BuildOntologyMetricsResultInput {
  sourceCommand: OntologyMetricsSourceCommand;
  generatedAt?: string;
  durationMs: number;
  documents: readonly OntologyMetricsDocument[];
  shapesPath: string;
  templatesPath: string;
  relationshipTypeCount: number;
  orphanedEntities?: number | null;
}

export type VaultFileCategory =
  | "markdown"
  | "image"
  | "document"
  | "script"
  | "data"
  | "canvas"
  | "audio"
  | "video"
  | "archive"
  | "other";

export interface VaultFileRecord {
  path: string;
  extension?: string;
  size_bytes?: number | null;
}

export interface VaultFileCategorySummary {
  category: VaultFileCategory;
  label: string;
  count: number;
  size_bytes: number | null;
  top_extensions: Record<string, number>;
}

export interface VaultFileInventoryResult {
  schema_version: number;
  generated_at: string;
  files_scanned: number;
  total_files: number;
  total_size_bytes: number | null;
  categories: VaultFileCategorySummary[];
  extensions: Record<string, number>;
}

export interface BuildVaultFileInventoryInput {
  files: readonly VaultFileRecord[];
  generatedAt?: string;
}

export interface PatchRunSummary {
  run_id: string;
  description: string;
  applied_at: string;
  changed_files: number;
  changed_operations?: number;
  patch_file?: string;
  schema_version?: string;
}

export type PatchHistorySourceCommand = "patch-history" | "refresh-vault-health-dashboard";

export interface PatchHistoryResult {
  schema_version: number;
  source_command: PatchHistorySourceCommand;
  generated_at: string;
  duration_ms: number;
  last_patch_run: PatchRunSummary | null;
  last_repair_run: PatchRunSummary | null;
  restored_runs_available: number;
  last_normalization_run: PatchRunSummary | null;
  lint_scans: number;
}

export interface BuildPatchHistoryResultInput {
  sourceCommand: PatchHistorySourceCommand;
  generatedAt?: string;
  durationMs: number;
  manifests?: readonly PatchRunSummary[];
  repairRuns?: readonly PatchRunSummary[];
  operationalHistory?: readonly OperationalRunSummary[];
  lintScans: number;
}

export type OperationalRunCommand =
  | "vault_lint"
  | "schema_validation"
  | "maintenance"
  | "patch_apply"
  | "patch_restore"
  | "template_refinement"
  | "normalization"
  | "repair";

export type OperationalRunStatus = "success" | "partial" | "error" | "skipped";

export interface OperationalRunSummary {
  command: OperationalRunCommand;
  status: OperationalRunStatus;
  started_at: string;
  duration_ms: number;
  affected_files: number;
  applied_items: number;
  warnings: string[];
  errors: string[];
  restore_manifest_path?: string;
}

export interface DashboardSnapshot {
  schema_version: number;
  source_command: "refresh-vault-health-dashboard";
  generated_at: string;
  duration_ms: number;
  vault_name: string;
  summary: DashboardSummary;
  issues: DashboardIssue[];
  review_items: DashboardIssue[];
  lint: LintScanResult | null;
  schema: SchemaValidationResult | null;
  ontology: OntologyMetricsResult | null;
  file_inventory: VaultFileInventoryResult | null;
  shape_lint: ShapeLintResult | null;
  patch_history: PatchHistoryResult | null;
}

export interface BuildDashboardSnapshotInput {
  vaultName: string;
  generatedAt?: string;
  durationMs?: number;
  lint?: LintScanResult | null;
  schema?: SchemaValidationResult | null;
  ontology?: OntologyMetricsResult | null;
  fileInventory?: VaultFileInventoryResult | null;
  shapeLint?: ShapeLintResult | null;
  patchHistory?: PatchHistoryResult | null;
  normalizationCandidates?: number | null;
  unresolvedLinks?: number | null;
}

export interface DashboardSummaryInput {
  notesScanned?: number;
  lintIssues?: readonly DashboardIssue[];
  reviewItems?: readonly DashboardIssue[];
  schemaViolations?: readonly DashboardIssue[];
  shapeIssues?: readonly DashboardIssue[];
  normalizationCandidates?: number | null;
  unresolvedLinks?: number | null;
}

export type WorkspaceHealthStatus = "healthy" | "needs_review" | "attention";

export interface WorkspaceHealthResult {
  status: WorkspaceHealthStatus;
  summary: DashboardSummary;
  issue_count: number;
  review_item_count: number;
}

const INVALID_FRONTMATTER_ISSUE_TYPES = new Set([
  "no_frontmatter",
  "required_field",
  "type_mismatch",
  "enum_value",
  "date_format",
  "pattern_mismatch",
  "unique_field",
]);

export function buildDashboardSummary(input: DashboardSummaryInput): DashboardSummary {
  const lintIssues = input.lintIssues ?? [];
  const reviewItems = input.reviewItems ?? [];
  const schemaViolations = input.schemaViolations ?? [];
  const shapeIssues = input.shapeIssues ?? [];

  return {
    notes_scanned: input.notesScanned ?? 0,
    lint_issue_count: lintIssues.length,
    review_item_count: reviewItems.length,
    schema_violation_count: schemaViolations.length,
    broken_shape_count: shapeIssues.length,
    invalid_frontmatter_count: lintIssues.filter((issue) =>
      INVALID_FRONTMATTER_ISSUE_TYPES.has(issue.issue_type)
    ).length,
    normalization_candidates: input.normalizationCandidates ?? null,
    unresolved_links: input.unresolvedLinks ?? null,
  };
}

export function buildDashboardTabStates(input: BuildDashboardTabStatesInput): DashboardTabState[] {
  return DASHBOARD_TABS
    .map((tab) => ({
      ...tab,
      badge: dashboardTabBadge(tab.id, input.snapshot, input.currentNote ?? null),
    }));
}

export function defaultDashboardTabId(snapshot: DashboardSnapshot): DashboardTabId {
  if (
    snapshot.summary.lint_issue_count > 0 ||
    snapshot.summary.invalid_frontmatter_count > 0 ||
    snapshot.summary.broken_shape_count > 0
  ) {
    return "issues";
  }
  if (snapshot.summary.schema_violation_count > 0) {
    return "tools";
  }
  return "overview";
}

export function buildLintScanResult(
  lintRun: LintRunResult,
  sourceCommand: LintScanSourceCommand,
  durationMs: number
): LintScanResult {
  return {
    schema_version: DASHBOARD_CACHE_SCHEMA_VERSION,
    source_command: sourceCommand,
    generated_at: lintRun.envelope.timestamp,
    duration_ms: durationMs,
    files_scanned: lintRun.envelope.notes_scanned,
    issues: lintRun.results.map((issue) => ({
      ...lintResultToDashboardIssue(issue),
      source_command: sourceCommand,
    })).filter((issue) => !isReviewIssue(issue.issue_type)),
    review_items: lintRun.reviewItems.map((issue) => ({
      ...lintResultToDashboardIssue(issue),
      source_command: sourceCommand,
    })),
    errors: lintRun.errors.length,
    warnings: lintRun.warnings.length,
    infos: lintRun.infos.length,
  };
}

export function buildSchemaValidationResult(
  input: BuildSchemaValidationResultInput
): SchemaValidationResult {
  const violations = input.violations
    ? input.violations.map((issue) => ({ ...issue, source_command: input.sourceCommand }))
    : (input.issues ?? []).map((issue) =>
      schemaIssueToDashboardIssue(issue, input.schemaPath, input.sourceCommand)
    );

  return {
    schema_version: DASHBOARD_CACHE_SCHEMA_VERSION,
    source_command: input.sourceCommand,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    duration_ms: input.durationMs,
    files_scanned: input.filesScanned,
    schema_path: input.schemaPath,
    violations,
    errors: violations.filter((issue) => issue.severity === "critical").length,
    warnings: violations.filter((issue) => issue.severity === "warning").length,
  };
}

export function buildOntologyMetricsResult(
  input: BuildOntologyMetricsResultInput
): OntologyMetricsResult {
  const visibleDocuments = input.documents.filter((document) => !isHiddenPath(document.path));
  const folderCoverage: Record<string, number> = {};
  const tagDistribution: Record<string, number> = {};

  for (const document of visibleDocuments) {
    const topFolder = document.path.includes("/") ? document.path.split("/")[0] : "(root)";
    folderCoverage[topFolder] = (folderCoverage[topFolder] ?? 0) + 1;

    for (const tag of getTags(document.frontmatter ?? {}).map((value) => value.replace(/^#/, ""))) {
      if (!tag) continue;
      tagDistribution[tag] = (tagDistribution[tag] ?? 0) + 1;
    }
  }

  return {
    schema_version: DASHBOARD_CACHE_SCHEMA_VERSION,
    source_command: input.sourceCommand,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    duration_ms: input.durationMs,
    shape_count: countDocumentsInFolder(visibleDocuments, input.shapesPath),
    template_count: countDocumentsInFolder(visibleDocuments, input.templatesPath),
    relationship_type_count: input.relationshipTypeCount,
    folder_coverage: sortCountRecord(folderCoverage),
    tag_distribution: sortCountRecord(tagDistribution),
    orphaned_entities: input.orphanedEntities ?? null,
  };
}

export function buildVaultFileInventory(
  input: BuildVaultFileInventoryInput
): VaultFileInventoryResult {
  const visibleFiles = input.files
    .map((file) => ({
      path: normalisePath(file.path),
      extension: normalizeExtension(file.extension ?? extensionFromPath(file.path)),
      size_bytes: typeof file.size_bytes === "number" && Number.isFinite(file.size_bytes)
        ? Math.max(0, file.size_bytes)
        : null,
    }))
    .filter((file) => file.path.length > 0)
    .filter((file) => !isHiddenPath(file.path))
    .filter((file) => !isIgnoredInventoryPath(file.path));

  const categoryEntries = new Map<VaultFileCategory, { count: number; sizeBytes: number | null; extensions: Record<string, number> }>();
  const extensions: Record<string, number> = {};
  let totalSizeBytes: number | null = 0;

  for (const file of visibleFiles) {
    const extension = file.extension || "(none)";
    const category = categoryForExtension(file.extension);
    const entry = categoryEntries.get(category) ?? { count: 0, sizeBytes: 0, extensions: {} };

    entry.count += 1;
    entry.extensions[extension] = (entry.extensions[extension] ?? 0) + 1;
    extensions[extension] = (extensions[extension] ?? 0) + 1;

    if (file.size_bytes === null) {
      entry.sizeBytes = null;
      totalSizeBytes = null;
    } else {
      if (entry.sizeBytes !== null) entry.sizeBytes += file.size_bytes;
      if (totalSizeBytes !== null) totalSizeBytes += file.size_bytes;
    }

    categoryEntries.set(category, entry);
  }

  const categories = INVENTORY_CATEGORY_ORDER
    .map((category) => {
      const entry = categoryEntries.get(category);
      if (!entry) return null;
      return {
        category,
        label: INVENTORY_CATEGORY_LABELS[category],
        count: entry.count,
        size_bytes: entry.sizeBytes,
        top_extensions: sortCountRecord(entry.extensions),
      };
    })
    .filter((entry): entry is VaultFileCategorySummary => entry !== null);

  return {
    schema_version: DASHBOARD_CACHE_SCHEMA_VERSION,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    files_scanned: visibleFiles.length,
    total_files: visibleFiles.length,
    total_size_bytes: totalSizeBytes,
    categories,
    extensions: sortCountRecord(extensions),
  };
}

export function buildPatchHistoryResult(
  input: BuildPatchHistoryResultInput
): PatchHistoryResult {
  const manifests = input.manifests ?? [];
  const repairRuns = input.repairRuns ?? [];
  const operationalHistory = input.operationalHistory ?? [];

  return {
    schema_version: DASHBOARD_CACHE_SCHEMA_VERSION,
    source_command: input.sourceCommand,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    duration_ms: input.durationMs,
    last_patch_run: manifests[0] ?? null,
    last_repair_run: repairRuns[0] ?? operationalRunToPatchSummary(operationalHistory, "repair"),
    restored_runs_available: manifests.length,
    last_normalization_run: operationalRunToPatchSummary(operationalHistory, "normalization"),
    lint_scans: input.lintScans,
  };
}

export function schemaIssueToDashboardIssue(
  issue: SchemaValidationIssueLike,
  schemaPath: string,
  sourceCommand = "validate-schema"
): DashboardIssue {
  return {
    file_path: schemaPath,
    issue_type: "schema_validation",
    severity: issue.severity === "error" ? "critical" : "warning",
    message: issue.message,
    suggested_action: "Open schema.md and update the schema contract.",
    source_command: sourceCommand,
  };
}

export function buildShapeLintResult(
  shapeLintRun: ShapeLintRunResult,
  sourceCommand: ShapeLintSourceCommand,
  durationMs: number
): ShapeLintResult {
  return {
    schema_version: DASHBOARD_CACHE_SCHEMA_VERSION,
    source_command: sourceCommand,
    generated_at: shapeLintRun.envelope.timestamp,
    duration_ms: durationMs,
    files_scanned: shapeLintRun.envelope.notes_scanned,
    issues: shapeLintRun.results.map((issue) => ({
      ...lintResultToDashboardIssue(issue),
      source_command: sourceCommand,
    })),
    summary: buildShapeLintSummary(shapeLintRun.results, shapeLintRun.envelope.notes_scanned),
    errors: shapeLintRun.errors.length,
    warnings: shapeLintRun.warnings.length,
    infos: shapeLintRun.infos.length,
  };
}

export function buildShapeLintSummary(
  results: readonly LintResult[],
  filesScanned: number
): ShapeLintSummary {
  return {
    files_scanned: filesScanned,
    issue_count: results.length,
    missing_heading_count: countRule(results, "shape_heading_missing"),
    heading_order_issue_count: countRule(results, "shape_heading_order"),
    extra_heading_count: countRule(results, "shape_heading_extra"),
    empty_section_count: countRule(results, "shape_section_empty"),
  };
}

export function buildDashboardSnapshot(input: BuildDashboardSnapshotInput): DashboardSnapshot {
  const latestLint = input.lint ?? null;
  const latestSchema = input.schema ?? null;
  const latestOntology = input.ontology ?? null;
  const latestFileInventory = input.fileInventory ?? null;
  const latestShapeLint = input.shapeLint ?? null;
  const latestPatchHistory = input.patchHistory ?? null;

  const issues: DashboardIssue[] = sortDashboardIssuesBySeverity([
    ...(latestLint?.issues ?? []),
    ...(latestSchema?.violations ?? []),
  ]);

  const summary = buildDashboardSummary({
    notesScanned: latestLint?.files_scanned ?? 0,
    lintIssues: latestLint?.issues ?? [],
    reviewItems: latestLint?.review_items ?? [],
    schemaViolations: latestSchema?.violations ?? [],
    shapeIssues: latestShapeLint?.issues ?? [],
    normalizationCandidates: input.normalizationCandidates,
    unresolvedLinks: input.unresolvedLinks,
  });

  return {
    schema_version: DASHBOARD_CACHE_SCHEMA_VERSION,
    source_command: "refresh-vault-health-dashboard",
    generated_at: input.generatedAt ?? new Date().toISOString(),
    duration_ms: input.durationMs ?? 0,
    vault_name: input.vaultName,
    summary,
    issues,
    review_items: latestLint?.review_items ?? [],
    lint: latestLint,
    schema: latestSchema,
    ontology: latestOntology,
    file_inventory: latestFileInventory,
    shape_lint: latestShapeLint,
    patch_history: latestPatchHistory,
  };
}

export function sortDashboardIssuesBySeverity<T extends { severity: DashboardSeverity }>(
  issues: readonly T[]
): T[] {
  return [...issues].sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity));
}

export function createWorkspaceHealthResult(summary: DashboardSummary): WorkspaceHealthResult {
  const issueCount =
    summary.lint_issue_count +
    summary.schema_violation_count +
    summary.broken_shape_count;

  const status: WorkspaceHealthStatus =
    issueCount > 0
      ? "attention"
      : summary.review_item_count > 0
        ? "needs_review"
        : "healthy";

  return {
    status,
    summary,
    issue_count: issueCount,
    review_item_count: summary.review_item_count,
  };
}

function severityWeight(severity: DashboardSeverity): number {
  switch (severity) {
    case "critical":
      return 3;
    case "warning":
      return 2;
    default:
      return 1;
  }
}

function isReviewIssue(issueType: string): boolean {
  return issueType === "stale_note" || issueType === "stale_inbox_note";
}

function dashboardTabBadge(
  tabId: DashboardTabId,
  snapshot: DashboardSnapshot,
  currentNote: DashboardCurrentNoteTabInput | null
): DashboardTabBadge | null {
  switch (tabId) {
    case "overview":
      return null;
    case "issues":
      return issueBadge(snapshot);
    case "note":
      return currentNoteBadge(currentNote);
    case "tools":
      return toolsBadge(snapshot);
  }
}

function issueBadge(snapshot: DashboardSnapshot): DashboardTabBadge | null {
  const issues = snapshot.issues.filter((issue) =>
    !isReviewIssue(issue.issue_type) && !isSchemaIssue(issue)
  );
  const shapeIssues = snapshot.summary.broken_shape_count;
  const critical = issues.filter((issue) => issue.severity === "critical").length +
    (snapshot.shape_lint?.errors ?? 0);
  const warnings = issues.filter((issue) => issue.severity === "warning").length +
    (critical > 0 ? 0 : shapeIssues);

  if (critical > 0) {
    return {
      label: String(critical),
      tone: "critical",
      title: `${critical} critical issue${critical === 1 ? "" : "s"}`,
    };
  }
  if (warnings > 0) {
    return {
      label: String(warnings),
      tone: "warning",
      title: `${warnings} warning${warnings === 1 ? "" : "s"}`,
    };
  }

  const reviewItems = snapshot.summary.review_item_count ?? 0;
  if (reviewItems > 0) {
    return {
      label: String(reviewItems),
      tone: "muted",
      title: `${reviewItems} review item${reviewItems === 1 ? "" : "s"}`,
    };
  }
  return null;
}

function currentNoteBadge(currentNote: DashboardCurrentNoteTabInput | null): DashboardTabBadge | null {
  const issueCount = currentNote?.issueCount ?? 0;
  if (issueCount > 0) {
    return {
      label: String(issueCount),
      tone: "warning",
      title: `${issueCount} current note issue${issueCount === 1 ? "" : "s"}`,
    };
  }

  const reviewItems = currentNote?.reviewItemCount ?? 0;
  if (reviewItems > 0) {
    return {
      label: String(reviewItems),
      tone: "muted",
      title: `${reviewItems} current note review item${reviewItems === 1 ? "" : "s"}`,
    };
  }
  return null;
}

function toolsBadge(snapshot: DashboardSnapshot): DashboardTabBadge | null {
  const schemaViolations = snapshot.summary.schema_violation_count;
  if (schemaViolations > 0) {
    const schemaErrors = snapshot.schema?.errors ?? 0;
    return {
      label: String(schemaViolations),
      tone: schemaErrors > 0 ? "critical" : "warning",
      title: `${schemaViolations} schema violation${schemaViolations === 1 ? "" : "s"}`,
    };
  }

  const candidates = snapshot.summary.normalization_candidates ?? 0;
  if (candidates <= 0) return null;
  return {
    label: String(candidates),
    tone: "warning",
    title: `${candidates} normalization candidate${candidates === 1 ? "" : "s"}`,
  };
}

function isSchemaIssue(issue: DashboardIssue): boolean {
  return issue.source_command === "validate-schema" ||
    issue.issue_type.startsWith("schema_") ||
    issue.issue_type === "schema_validation";
}

function countRule(results: readonly LintResult[], rule: string): number {
  return results.filter((result) => result.rule === rule).length;
}

function countDocumentsInFolder(
  documents: readonly OntologyMetricsDocument[],
  folder: string
): number {
  const prefix = normalisePath(folder).replace(/\/$/, "");
  return documents.filter((document) => {
    const path = normalisePath(document.path);
    return path === prefix || path.startsWith(`${prefix}/`);
  }).length;
}

function sortCountRecord(record: Record<string, number>): Record<string, number> {
  const sorted: Record<string, number> = {};
  for (const [key, value] of Object.entries(record).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    sorted[key] = value;
  }
  return sorted;
}

function isHiddenPath(path: string): boolean {
  return normalisePath(path).split("/").some((segment) => segment.startsWith("."));
}

const INVENTORY_CATEGORY_ORDER: VaultFileCategory[] = [
  "markdown",
  "image",
  "document",
  "script",
  "data",
  "canvas",
  "audio",
  "video",
  "archive",
  "other",
];

const INVENTORY_CATEGORY_LABELS: Record<VaultFileCategory, string> = {
  markdown: "Markdown notes",
  image: "Images",
  document: "Documents",
  script: "Scripts/code",
  data: "Data/config",
  canvas: "Canvas/diagrams",
  audio: "Audio",
  video: "Video",
  archive: "Archives",
  other: "Other",
};

const EXTENSION_CATEGORIES: Record<string, VaultFileCategory> = buildExtensionCategories([
  [["md", "markdown"], "markdown"],
  [["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "tif", "tiff", "heic", "heif", "ico"], "image"],
  [["pdf", "doc", "docx", "rtf", "odt", "pages", "txt", "text", "ppt", "pptx", "key", "xls", "xlsx", "numbers", "epub", "mobi"], "document"],
  [["js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "sh", "bash", "zsh", "fish", "rb", "php", "go", "rs", "java", "c", "cc", "cpp", "h", "hpp", "cs", "swift", "kt", "kts", "scala", "pl", "pm", "lua", "r", "sql", "ps1", "bat", "cmd", "html", "htm", "css", "scss", "sass", "less", "vue", "svelte"], "script"],
  [["json", "jsonl", "ndjson", "yaml", "yml", "toml", "xml", "ini", "env", "csv", "tsv", "sqlite", "sqlite3", "db", "db3", "lock"], "data"],
  [["canvas", "excalidraw", "drawio", "mermaid"], "canvas"],
  [["mp3", "wav", "m4a", "aac", "flac", "ogg", "oga", "aiff"], "audio"],
  [["mp4", "mov", "m4v", "webm", "mkv", "avi", "wmv"], "video"],
  [["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "dmg"], "archive"],
]);

function buildExtensionCategories(
  groups: ReadonlyArray<readonly [readonly string[], VaultFileCategory]>
): Record<string, VaultFileCategory> {
  const categories: Record<string, VaultFileCategory> = {};
  for (const [extensions, category] of groups) {
    for (const extension of extensions) {
      categories[extension] = category;
    }
  }
  return categories;
}

function categoryForExtension(extension: string): VaultFileCategory {
  return EXTENSION_CATEGORIES[extension] ?? "other";
}

function extensionFromPath(path: string): string {
  const filename = normalisePath(path).split("/").pop() ?? "";
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === filename.length - 1) return "";
  return filename.slice(lastDot + 1);
}

function normalizeExtension(extension: string): string {
  return extension.trim().toLowerCase().replace(/^\.+/, "");
}

function isIgnoredInventoryPath(path: string): boolean {
  return normalisePath(path).split("/").some((segment) =>
    segment === "node_modules" ||
    segment === "__pycache__" ||
    segment === ".DS_Store"
  );
}

function operationalRunToPatchSummary(
  history: readonly OperationalRunSummary[],
  command: OperationalRunSummary["command"]
): PatchRunSummary | null {
  const run = history.find((entry) => entry.command === command);
  if (!run) return null;

  return {
    run_id: `${run.command}-${run.started_at}`,
    description: run.command.replace(/_/g, " "),
    applied_at: run.started_at,
    changed_files: run.affected_files,
    changed_operations: run.applied_items,
  };
}
