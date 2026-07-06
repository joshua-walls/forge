// src/settings.ts
// Forge plugin settings.
//
// Stored in .obsidian/plugins/forge/data.json via Obsidian's
// loadData() / saveData() API. Never stored in vault notes.
//
// Field pointer settings (e.g. exportTypeField) store a field name that
// resolves against the loaded schema. The settings tab renders these as
// schema-driven dropdowns rather than free-text inputs.

export type FieldPointerLocation = "frontmatter" | "inline";
export type DashboardAutoRefreshIntervalMinutes = 1 | 3 | 5 | 15 | 30;
export type InboxRetentionAction = "delete" | "review";
export type DataviewExpansionAutoUpdateMode = "off" | "edit_idle";
export type ActiveFileLintAutoMode = "off" | "edit_idle";

export interface FieldPointer {
  location: FieldPointerLocation;
  field: string;
}

export interface ForgeSettings {
  // ── System paths ──────────────────────────────────────────────────
  // All paths are relative to vault root.
  systemFolder: string;
  forgeFolder: string;

  // ── Schema ────────────────────────────────────────────────────────
  schemaNoteFolder: string;
  schemaNoteFile: string;
  // Where the schema version field lives and which field it is.
  // Settings tab renders a location picker + schema-driven dropdown.
  schemaVersionLocation: FieldPointerLocation;
  schemaVersionField: string;

  // ── Lint ──────────────────────────────────────────────────────────
  lintRunsFolder: string;
  lintStrictMode: boolean;
  lintRunRetentionCount: number;
  lintFileLinks: boolean;
  lintInlineMetadata: boolean;
  lintExcludeInboxFolder: boolean;
  lintRepairThreshold: "errors_only" | "errors_and_warnings";
  activeFileLintAutoMode: ActiveFileLintAutoMode;
  activeFileLintIdleDelayMs: number;

  // ── Stale review ──────────────────────────────────────────────────
  staleReviewEnabled: boolean;
  // Schema-driven dropdowns — location picker + field dropdown.
  staleReviewCycleLocation: FieldPointerLocation;
  staleReviewCycleField: string;
  staleReviewUpdatedLocation: FieldPointerLocation;
  staleReviewUpdatedField: string;
  staleReviewFilterLocation: FieldPointerLocation;
  staleReviewFilterField: string;
  staleReviewStatuses: string[];   // valid values of filter field to include

  // ── Patch ─────────────────────────────────────────────────────────
  patchesFolder: string;
  inboxFolder: string;
  patchDefaultFile: string;
  patchBackupEnabled: boolean;
  patchBackupFolder: string;
  patchGenerateManifest: boolean;
  patchAutoLintAfterApply: boolean;
  patchAutoMaintenanceAfterApply: boolean;

  // ── Maintenance ───────────────────────────────────────────────────
  backupRetentionDays: number;
  inboxRetentionDays: number;
  inboxRetentionAction: InboxRetentionAction;
  lintHistoryRetentionDays: number;
  lintHistoryMaxEntries: number;
  maintenanceAutoRunOnDashboardRefresh: boolean;
  patchReportRetentionCount: number;
  shapeLintRunRetentionCount: number;

  // ── Export ────────────────────────────────────────────────────────
  exportEnabled: boolean;
  exportsFolder: string;
  exportRelationshipHeading: string;
  // Schema-driven dropdowns — frontmatter only (no location picker needed).
  exportFilterField: string;
  exportFilterValues: string[];
  exportPrivateEnabled: boolean;
  exportPrivateField: string;        // frontmatter dropdown
  exportDomainField: string;         // frontmatter dropdown
  exportTypeField: string;           // frontmatter dropdown
  exportStatusField: string;         // frontmatter dropdown
  exportDashboardName: string;
  exportExcludeFolders: string[];

  // ── Shapes ────────────────────────────────────────────────────────
  shapesEnabled: boolean;
  shapesFolder: string;
  shapeIncludeSubfolders: boolean;
  shapeLintEnabled: boolean;
  shapeLintStrictMode: boolean;
  shapeLintExcludeInboxFolder: boolean;
  shapeLintScope: "all" | "folder";
  shapeLintFolders: string[];
  shapeRefinementEnabled: boolean;
  shapeTemplatesFolder: string;
  shapeTypeTargetField: string;      // frontmatter dropdown
  shapeCreatedField: string;         // frontmatter dropdown
  shapeUpdatedField: string;         // frontmatter dropdown
  shapeTemplateFields: Record<string, { include: boolean; value: unknown }>;

  // ── Shape Repair ──────────────────────────────────────────────────
  shapeInjectRelationships: boolean;
  shapeRelationshipHeading: string;
  shapeRelationshipHeadingLevel: number;   // 1=H1, 2=H2, 3=H3
  shapeRelationshipPosition: "inject" | "append";

  shapeRepairEnabled: boolean;
  shapeRepairScope: "all" | "folder";
  shapeRepairFolders: string[];
  shapeRepairRunsFolder: string;
  shapeRepairFileLinks: boolean;
  shapeRepairHistoryRetentionCount: number;

  // ── General ───────────────────────────────────────────────────────
  // Canonical sort order for frontmatter fields. Fields not in this list
  // are appended alphabetically after the ordered fields.
  frontmatterFieldOrder: string[];
  dataviewExpansionEnabled: boolean;
  dataviewExpansionAutoUpdateMode: DataviewExpansionAutoUpdateMode;
  dataviewExpansionAutoUpdateDelayMs: number;
  dataviewExpansionTitle: string;
  dataviewExpansionMaxLinks: number;

  // ── Plugin metadata ───────────────────────────────────────────────
  // Tracks the last version Forge was loaded as. Used to detect upgrades
  // and show version-specific notices once. Written on every load after
  // any notice is handled. Absent on installs that pre-date this field.
  lastInstalledVersion: string | undefined;
}

export const DEFAULT_SETTINGS: ForgeSettings = {
  // System paths
  systemFolder: "System",
  forgeFolder: "System/Forge",

  // Schema
  schemaNoteFolder: "System/Registry",
  schemaNoteFile: "schema.md",
  schemaVersionLocation: "inline",
  schemaVersionField: "version",

  // Lint
  lintRunsFolder: "System/Exports/LintReports",
  lintStrictMode: false,
  lintRunRetentionCount: 20,
  lintFileLinks: false,
  lintInlineMetadata: true,
  lintExcludeInboxFolder: false,
  lintRepairThreshold: "errors_only",
  activeFileLintAutoMode: "off",
  activeFileLintIdleDelayMs: 10_000,

  // Stale review
  staleReviewEnabled: false,
  staleReviewCycleLocation: "frontmatter",
  staleReviewCycleField: "review_cycle",
  staleReviewUpdatedLocation: "frontmatter",
  staleReviewUpdatedField: "updated",
  staleReviewFilterLocation: "frontmatter",
  staleReviewFilterField: "status",
  staleReviewStatuses: [],

  // Patch
  patchesFolder: "System/Forge/Patches",
  inboxFolder: "System/Inbox",
  patchDefaultFile: "System/Forge/Patches/vault-patch.md",
  patchBackupEnabled: true,
  patchBackupFolder: "System/Forge/Patches/Backups",
  patchGenerateManifest: true,
  patchAutoLintAfterApply: true,
  patchAutoMaintenanceAfterApply: false,

  // Maintenance
  backupRetentionDays: 14,
  inboxRetentionDays: 30,
  inboxRetentionAction: "delete",
  lintHistoryRetentionDays: 14,
  lintHistoryMaxEntries: 20,
  maintenanceAutoRunOnDashboardRefresh: false,
  patchReportRetentionCount: 20,
  shapeLintRunRetentionCount: 20,

  // Export
  exportEnabled: false,
  exportsFolder: "System/Exports",
  exportRelationshipHeading: "Related",
  exportFilterField: "",
  exportFilterValues: [],
  exportPrivateEnabled: false,
  exportPrivateField: "",
  exportDomainField: "",
  exportTypeField: "",
  exportStatusField: "",
  exportDashboardName: "",
  exportExcludeFolders: [],

  // Shapes
  shapesEnabled: false,
  shapesFolder: "System/Shapes",
  shapeIncludeSubfolders: false,
  shapeLintEnabled: false,
  shapeLintStrictMode: false,
  shapeLintExcludeInboxFolder: false,
  shapeLintScope: "all",
  shapeLintFolders: [],
  shapeRefinementEnabled: false,
  shapeTemplatesFolder: "System/Templates",
  shapeTypeTargetField: "type",
  shapeCreatedField: "created",
  shapeUpdatedField: "updated",
  shapeTemplateFields: {},

  // Relationship injection
  shapeInjectRelationships: false,
  shapeRelationshipHeading: "Related",
  shapeRelationshipHeadingLevel: 1,
  shapeRelationshipPosition: "append",

  // Shape Repair
  shapeRepairEnabled: false,
  shapeRepairScope: "all",
  shapeRepairFolders: [],
  shapeRepairRunsFolder: "System/Exports/ShapeRepairRuns",
  shapeRepairFileLinks: false,
  shapeRepairHistoryRetentionCount: 20,

  // General
  frontmatterFieldOrder: [],
  dataviewExpansionEnabled: false,
  dataviewExpansionAutoUpdateMode: "edit_idle",
  dataviewExpansionAutoUpdateDelayMs: 5_000,
  dataviewExpansionTitle: "Dataview Expansion",
  dataviewExpansionMaxLinks: 250,

  // Plugin metadata
  lastInstalledVersion: undefined,
};

export function normalizeInboxRetentionAction(value: unknown): InboxRetentionAction {
  if (value === "review" || value === "warning") return "review";
  return "delete";
}

export function isInboxRetentionReviewAction(value: unknown): boolean {
  return normalizeInboxRetentionAction(value) === "review";
}
