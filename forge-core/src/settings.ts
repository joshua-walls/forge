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

  // ── Dashboard ────────────────────────────────────────────────────
  dashboardFileInventoryEnabled: boolean;
  dashboardRefreshExportsEnabled: boolean;

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
  shapeLintAllowEmptySections: boolean;
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

  // Dashboard
  dashboardFileInventoryEnabled: false,
  dashboardRefreshExportsEnabled: false,

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
  shapeLintAllowEmptySections: false,
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

export function createForgeSettings(
  ...partials: Array<Partial<ForgeSettings> | null | undefined>
): ForgeSettings {
  const merged: ForgeSettings = { ...DEFAULT_SETTINGS };

  for (const partial of partials) {
    if (!partial) continue;

    for (const [key, value] of Object.entries(partial)) {
      if (value !== undefined && Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) {
        (merged as unknown as Record<string, unknown>)[key] = value;
      }
    }
  }

  return normalizeForgeSettings(merged);
}

export function normalizeForgeSettings(settings: ForgeSettings): ForgeSettings {
  return {
    ...settings,
    systemFolder: normalizeSettingsPath(settings.systemFolder, DEFAULT_SETTINGS.systemFolder),
    forgeFolder: normalizeSettingsPath(settings.forgeFolder, DEFAULT_SETTINGS.forgeFolder),
    schemaNoteFolder: normalizeSettingsPath(settings.schemaNoteFolder, DEFAULT_SETTINGS.schemaNoteFolder),
    schemaNoteFile: normalizeSettingsPath(settings.schemaNoteFile, DEFAULT_SETTINGS.schemaNoteFile),
    schemaVersionLocation: normalizeFieldPointerLocation(
      settings.schemaVersionLocation,
      DEFAULT_SETTINGS.schemaVersionLocation
    ),
    schemaVersionField: normalizeSettingString(settings.schemaVersionField, DEFAULT_SETTINGS.schemaVersionField),
    lintRunsFolder: normalizeSettingsPath(settings.lintRunsFolder, DEFAULT_SETTINGS.lintRunsFolder),
    lintRepairThreshold: settings.lintRepairThreshold === "errors_and_warnings"
      ? "errors_and_warnings"
      : "errors_only",
    activeFileLintAutoMode: normalizeActiveFileLintAutoMode(settings.activeFileLintAutoMode),
    staleReviewCycleLocation: normalizeFieldPointerLocation(
      settings.staleReviewCycleLocation,
      DEFAULT_SETTINGS.staleReviewCycleLocation
    ),
    staleReviewCycleField: normalizeSettingString(
      settings.staleReviewCycleField,
      DEFAULT_SETTINGS.staleReviewCycleField
    ),
    staleReviewUpdatedLocation: normalizeFieldPointerLocation(
      settings.staleReviewUpdatedLocation,
      DEFAULT_SETTINGS.staleReviewUpdatedLocation
    ),
    staleReviewUpdatedField: normalizeSettingString(
      settings.staleReviewUpdatedField,
      DEFAULT_SETTINGS.staleReviewUpdatedField
    ),
    staleReviewFilterLocation: normalizeFieldPointerLocation(
      settings.staleReviewFilterLocation,
      DEFAULT_SETTINGS.staleReviewFilterLocation
    ),
    staleReviewFilterField: normalizeSettingString(
      settings.staleReviewFilterField,
      DEFAULT_SETTINGS.staleReviewFilterField
    ),
    staleReviewStatuses: normalizeStringArray(settings.staleReviewStatuses, DEFAULT_SETTINGS.staleReviewStatuses),
    patchesFolder: normalizeSettingsPath(settings.patchesFolder, DEFAULT_SETTINGS.patchesFolder),
    inboxFolder: normalizeSettingsPath(settings.inboxFolder, DEFAULT_SETTINGS.inboxFolder),
    patchDefaultFile: normalizeSettingsPath(settings.patchDefaultFile, DEFAULT_SETTINGS.patchDefaultFile),
    patchBackupFolder: normalizeSettingsPath(settings.patchBackupFolder, DEFAULT_SETTINGS.patchBackupFolder),
    inboxRetentionAction: normalizeInboxRetentionAction(settings.inboxRetentionAction),
    exportsFolder: normalizeSettingsPath(settings.exportsFolder, DEFAULT_SETTINGS.exportsFolder),
    exportFilterValues: normalizeStringArray(settings.exportFilterValues, DEFAULT_SETTINGS.exportFilterValues),
    exportExcludeFolders: normalizePathArray(settings.exportExcludeFolders, DEFAULT_SETTINGS.exportExcludeFolders),
    shapesFolder: normalizeSettingsPath(settings.shapesFolder, DEFAULT_SETTINGS.shapesFolder),
    shapeLintScope: settings.shapeLintScope === "folder" ? "folder" : "all",
    shapeLintFolders: normalizePathArray(settings.shapeLintFolders, DEFAULT_SETTINGS.shapeLintFolders),
    shapeTemplatesFolder: normalizeSettingsPath(
      settings.shapeTemplatesFolder,
      DEFAULT_SETTINGS.shapeTemplatesFolder
    ),
    shapeTypeTargetField: normalizeSettingString(settings.shapeTypeTargetField, DEFAULT_SETTINGS.shapeTypeTargetField),
    shapeCreatedField: normalizeSettingString(settings.shapeCreatedField, DEFAULT_SETTINGS.shapeCreatedField),
    shapeUpdatedField: normalizeSettingString(settings.shapeUpdatedField, DEFAULT_SETTINGS.shapeUpdatedField),
    shapeRelationshipHeading: normalizeSettingString(
      settings.shapeRelationshipHeading,
      DEFAULT_SETTINGS.shapeRelationshipHeading
    ),
    shapeRelationshipHeadingLevel: normalizeHeadingLevel(settings.shapeRelationshipHeadingLevel),
    shapeRelationshipPosition: settings.shapeRelationshipPosition === "inject" ? "inject" : "append",
    shapeRepairScope: settings.shapeRepairScope === "folder" ? "folder" : "all",
    shapeRepairFolders: normalizePathArray(settings.shapeRepairFolders, DEFAULT_SETTINGS.shapeRepairFolders),
    shapeRepairRunsFolder: normalizeSettingsPath(
      settings.shapeRepairRunsFolder,
      DEFAULT_SETTINGS.shapeRepairRunsFolder
    ),
    frontmatterFieldOrder: normalizeStringArray(
      settings.frontmatterFieldOrder,
      DEFAULT_SETTINGS.frontmatterFieldOrder
    ),
    dataviewExpansionAutoUpdateMode: normalizeDataviewExpansionAutoUpdateMode(
      settings.dataviewExpansionAutoUpdateMode
    ),
    dataviewExpansionTitle: normalizeSettingString(
      settings.dataviewExpansionTitle,
      DEFAULT_SETTINGS.dataviewExpansionTitle
    ),
  };
}

export function normalizeInboxRetentionAction(value: unknown): InboxRetentionAction {
  if (value === "review" || value === "warning") return "review";
  return "delete";
}

export function isInboxRetentionReviewAction(value: unknown): boolean {
  return normalizeInboxRetentionAction(value) === "review";
}

function normalizeFieldPointerLocation(
  value: unknown,
  fallback: FieldPointerLocation
): FieldPointerLocation {
  return value === "frontmatter" || value === "inline" ? value : fallback;
}

function normalizeActiveFileLintAutoMode(value: unknown): ActiveFileLintAutoMode {
  return value === "edit_idle" ? "edit_idle" : "off";
}

function normalizeDataviewExpansionAutoUpdateMode(value: unknown): DataviewExpansionAutoUpdateMode {
  return value === "off" ? "off" : "edit_idle";
}

function normalizeHeadingLevel(value: unknown): number {
  return value === 1 || value === 2 || value === 3 ? value : DEFAULT_SETTINGS.shapeRelationshipHeadingLevel;
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePathArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => normalizeSettingsPath(item, ""))
    .filter(Boolean);
}

function normalizeSettingString(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return value.trim() || fallback;
}

function normalizeSettingsPath(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return normalized || fallback;
}
