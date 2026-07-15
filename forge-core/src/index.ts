export {
  DASHBOARD_CACHE_SCHEMA_VERSION,
  DASHBOARD_TABS,
  buildDashboardSnapshot,
  buildVaultFileInventory,
  buildLintScanResult,
  buildDashboardSummary,
  buildDashboardTabStates,
  buildOntologyMetricsResult,
  buildPatchHistoryResult,
  buildSchemaValidationResult,
  buildShapeLintResult,
  buildShapeLintSummary,
  createWorkspaceHealthResult,
  defaultDashboardTabId,
  schemaIssueToDashboardIssue,
  sortDashboardIssuesBySeverity,
} from "./dashboard.js";
export {
  createForgeSettings,
  DEFAULT_SETTINGS,
  isInboxRetentionReviewAction,
  normalizeForgeSettings,
  normalizeInboxRetentionAction,
} from "./settings.js";
export {
  buildExemptList,
  buildForgeControlPlaneExemptList,
  buildLintExemptList,
  buildShapeLintExemptList,
  buildVaultScanExemptList,
  getDomain,
  getVaultPaths,
  isExempt,
  localTimestamp,
  matchesGlob,
  normalisePath,
  safeTimestamp,
  todayString,
} from "./paths.js";
export {
  addTag,
  convertTagSeparator,
  getTagNamespace,
  getTags,
  isInvalidTag,
  isNamespacedTag,
  normalizeTags,
  removeTag,
  replaceTag,
  setTags,
} from "./tags.js";
export {
  planNormalizeFrontmatter,
  planNormalizeTags,
} from "./normalization.js";
export {
  getFmString,
  isFieldPresent,
  sortFrontmatterFields,
  splitFrontmatter,
} from "./frontmatter.js";
export {
  createForgeDocument,
} from "./document.js";
export {
  allFrontmatterFields,
  conditionallyRequiredInlineFields,
  getFrontmatterField,
  inlineFieldNameSet,
  parseSchemaNote,
  reviewCycleDays,
  validateSchemaNote,
} from "./schema.js";
export {
  isApplyablePreviewRun,
} from "./preview.js";
export {
  createPatchTemplateContent,
} from "./patch-template.js";
export {
  buildDefaultRepairOperations,
  buildCuratedRepairOperations,
  buildRepairFileCandidates,
  buildRepairPatchContent,
  extractRepairTagNamespace,
  filterRepairableLintResults,
  getRepairDefaultValue,
  getRepairFieldsToFix,
  isRepairableLintResult,
  matchingTagsForRepairIssue,
} from "./repair.js";
export {
  buildForgeDocumentation,
  buildForgeDocumentationContext,
  inferDocumentationTags,
  inferDocumentationType,
  interpolateDocumentation,
} from "./docs.js";
export {
  buildOntologyIndexArtifacts,
  buildOntologyNote,
  buildVaultDashboardNote,
  buildVaultExportNote,
  buildVaultInventory,
  buildVaultMeta,
  buildVaultOverviewArtifacts,
  extractAllWikilinks,
  extractRelationships,
  getInventoryRecordField,
} from "./export.js";
export {
  applyPatchOperationToDocument,
  applyPatchToDocuments,
  extractPatchYaml,
  planPatchForDocuments,
  parsePatchFile,
  parsePatchFileResult,
  selectPatchTargetDocuments,
} from "./patch.js";
export {
  buildPatchArchiveArtifact,
  buildPatchReportArtifact,
  buildPatchReportNote,
  buildPatchRestoreReportArtifact,
  buildPatchRestoreReportNote,
  buildPatchRestoreManifest,
  buildPatchRestoreManifestArtifact,
  shouldWritePatchRestoreManifest,
} from "./patch-artifacts.js";
export {
  applyPatchRestoreOperations,
  buildLegacyPatchRestoreCandidates,
  evaluatePatchRestoreCandidates,
  evaluatePatchRestoreOperation,
  isPatchRestoreManifest,
  synthesizeLegacyPatchOperationChange,
} from "./patch-restore.js";
export {
  lintResultToDashboardIssue,
  runLintForDocuments,
} from "./lint.js";
export {
  findNormalizationCandidates,
  summarizeForgeRuns,
  summarizeLintRun,
  summarizeWorkspaceMarkdown,
} from "./workspace.js";
export {
  buildShapeHeadingCacheFromTemplates,
  buildTemplateTree,
  collectShapeNamesFromDocuments,
  collectShapeTemplatesFromDocuments,
  extractHeadings,
  flattenTemplateTree,
  lintShapeHeadingsForDocument,
  runShapeLintForDocuments,
  templateFileToShapeName,
} from "./shape-lint.js";
export {
  applyShapeRepair,
  buildShapeRepairHistoryContent,
  buildShapeRepairHistoryEntry,
  buildShapeRepairRunNote,
  buildShapeRepairRunNoteArtifact,
  planShapeRepairForDocuments,
  repairShapeDocument,
} from "./shape-repair.js";

export type {
  DashboardIssue,
  DashboardSeverity,
  DashboardSnapshot,
  DashboardSummary,
  DashboardSummaryInput,
  DashboardTabBadge,
  DashboardTabBadgeTone,
  DashboardTabDefinition,
  DashboardTabId,
  DashboardTabState,
  BuildDashboardSnapshotInput,
  BuildDashboardTabStatesInput,
  BuildVaultFileInventoryInput,
  BuildSchemaValidationResultInput,
  DashboardCurrentNoteTabInput,
  LintScanResult,
  LintScanSourceCommand,
  BuildOntologyMetricsResultInput,
  BuildPatchHistoryResultInput,
  OntologyMetricsDocument,
  OntologyMetricsResult,
  OntologyMetricsSourceCommand,
  OperationalRunCommand,
  OperationalRunStatus,
  OperationalRunSummary,
  PatchHistoryResult,
  PatchHistorySourceCommand,
  PatchRunSummary,
  SchemaValidationIssueLike,
  SchemaValidationResult,
  SchemaValidationSourceCommand,
  ShapeLintResult,
  ShapeLintSourceCommand,
  ShapeLintSummary,
  VaultFileCategory,
  VaultFileCategorySummary,
  VaultFileInventoryResult,
  VaultFileRecord,
  WorkspaceHealthResult,
  WorkspaceHealthStatus,
} from "./dashboard.js";
export type {
  ActiveFileLintAutoMode,
  DashboardAutoRefreshIntervalMinutes,
  DataviewExpansionAutoUpdateMode,
  FieldPointer,
  FieldPointerLocation,
  ForgeSettings,
  InboxRetentionAction,
} from "./settings.js";
export type {
  VaultPaths,
} from "./paths.js";
export type {
  ParsedMarkdownDocument,
} from "./frontmatter.js";
export type {
  CreateForgeDocumentOptions,
} from "./document.js";
export type {
  FrontmatterNormalizationPlan,
} from "./normalization.js";
export type {
  ForgeYamlParser,
  ParseSchemaNoteOptions,
  SchemaField,
  SchemaFrontmatter,
  SchemaInline,
  SchemaInlineField,
  SchemaLintRule,
  SchemaOntology,
  SchemaRelationship,
  SchemaTagRules,
  SchemaValidationIssue,
  ValidateSchemaNoteOptions,
  VaultSchema,
} from "./schema.js";
export type {
  PreviewBefore,
  PreviewDiffKind,
  PreviewItem,
  PreviewItemStatus,
  PreviewRiskLevel,
  PreviewRun,
  PreviewSource,
  PreviewSummary,
} from "./preview.js";
export type {
  PatchTemplateOptions,
} from "./patch-template.js";
export type {
  BuildDefaultRepairOperationsInput,
  BuildDefaultRepairOperationsResult,
  BuildCuratedRepairOperationsInput,
  BuildRepairFileCandidatesInput,
  BuildRepairPatchContentOptions,
  RepairFieldCandidate,
  RepairFieldValue,
  RepairFileCandidate,
  RepairOperation,
  RepairTagCandidate,
  RepairTagAction,
  RepairTagDecision,
  RepairTagDecisionAction,
  RepairThreshold,
} from "./repair.js";
export type {
  BuildForgeDocumentationOptions,
  ForgeDocumentationContext,
  ForgeDocumentationNote,
  ForgeDocumentationRawSources,
} from "./docs.js";
export type {
  BuildOntologyIndexArtifactsInput,
  BuildVaultInventoryInput,
  BuildVaultOverviewArtifactsInput,
  InventoryExport,
  InventoryRecord,
  OntologyIndex,
  OntologyIndexArtifact,
  OntologyNode,
  OntologyRelationships,
  VaultMetaExport,
  VaultOverviewArtifacts,
} from "./export.js";
export type {
  PatchFile,
  PatchDocumentEdit,
  PatchDocumentUpdate,
  PatchManifestEntry,
  PatchMeta,
  PatchOperation,
  PatchOperationChange,
  PatchOpResult,
  PatchOpStatus,
  PatchParseResult,
  ApplyPatchOperationToDocumentInput,
  ApplyPatchToDocumentsInput,
  ApplyPatchToDocumentsResult,
  PlanPatchForDocumentsInput,
  PatchRestoreTarget,
  PatchRestoreValue,
  PatchReverseAction,
  PatchRunResult,
  PatchScope,
  ForgeYamlStringifier,
} from "./patch.js";
export type {
  BuildPatchReportNoteOptions,
  BuildPatchRestoreReportNoteOptions,
  PatchArchiveArtifact,
  PatchArtifactSettings,
  PatchJsonArtifact,
  PatchRestoreReportSummary,
  PatchTextArtifact,
} from "./patch-artifacts.js";
export type {
  ApplyPatchRestoreOperationsInput,
  ApplyPatchRestoreOperationsResult,
  BuildLegacyPatchRestoreCandidatesInput,
  LegacyPatchRestoreBackupDocument,
  PatchRestoreApplyResult,
  PatchRestoreCandidate,
  PatchRestoreManifest,
  PatchRestoreStatus,
} from "./patch-restore.js";
export type {
  ForgePosition,
  ForgeRange,
  ForgeDocument,
  LintResult,
  LintRunEnvelope,
  LintRunResult,
  LintSeverity,
  RunLintForDocumentsInput,
} from "./lint.js";
export type {
  ForgeNormalizationCandidate,
  WorkspaceSummaryOptions,
} from "./workspace.js";
export type {
  ForgeShapeTemplate,
  ParsedHeading,
  RunShapeLintForDocumentsInput,
  ShapeLintRunResult,
  TemplateNode,
} from "./shape-lint.js";
export type {
  PlanShapeRepairForDocumentsInput,
  RepairShapeDocumentInput,
  ShapeRepairContentResult,
  ShapeRepairDocumentResult,
  ShapeRepairDocumentUpdate,
  ShapeRepairFileResult,
  ShapeRepairFileStatus,
  ShapeRepairHistoryEntry,
  ShapeRepairPlanResult,
  ShapeRepairRunNoteArtifact,
  ShapeRepairRunResult,
} from "./shape-repair.js";
