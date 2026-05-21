// src/settings.ts
// Forge plugin settings.
//
// Stored in .obsidian/plugins/forge/data.json via Obsidian's
// loadData() / saveData() API. Never stored in vault notes.
//

export type StaleReviewCycle = "daily" | "weekly" | "monthly" | "quarterly" | "custom";

export interface ForgeSettings {
  // ── System paths ──────────────────────────────────────────────────
  // All paths are relative to vault root.
  systemFolder: string;        // System/
  forgeFolder: string;    // System/Forge/

  // ── Lint paths + settings ─────────────────────────────────────────
  schemaNoteFolder: string;    // System/Registry/
  schemaNoteFile: string;      // schema.md
  lintRunsFolder: string;      // System/Exports/LintReports/
  lintStrictMode: boolean;
  lintRunRetentionCount: number;
  lintFileLinks: boolean;
  lintInlineMetadata: boolean;

  // ── Stale review (under Lint tab) ────────────────────────────────
  staleReviewEnabled: boolean;
  staleReviewCycleField: string;   // frontmatter field containing the cycle value
  staleReviewUpdatedField: string; // frontmatter field containing last-updated date
  staleReviewFilterField: string;  // which schema field to use for in-scope filtering
  staleReviewStatuses: string[];   // valid values of that field to include

  // ── Patch settings ────────────────────────────────────────────────
  patchesFolder: string;           // System/Forge/Patches/
  inboxFolder: string;             // System/Inbox/
  patchDefaultFile: string;        // System/Forge/Patches/vault-patch.md
  patchBackupEnabled: boolean;
  patchBackupFolder: string;       // selectable; default System/Forge/Patches/Backups/
  patchGenerateManifest: boolean;
  patchAutoLintAfterApply: boolean;
  patchAutoMaintenanceAfterApply: boolean;

  // ── Maintenance settings ──────────────────────────────────────────
  backupRetentionDays: number;
  inboxRetentionDays: number;
  lintHistoryRetentionDays: number;
  lintHistoryMaxEntries: number;
  patchReportRetentionCount: number;

  // ── Export settings ───────────────────────────────────────────────
  exportEnabled: boolean;
  exportsFolder: string;               // System/Exports/
  exportRelationshipHeading: string;   // e.g. "Related"  (without the # — script adds it)
  exportFilterField: string;           // schema field to filter on, e.g. "type"
  exportFilterValues: string[];        // selected values for that field, e.g. ["capability","method"]
  exportPrivateEnabled: boolean;       // whether to treat a field as a private-note signal
  exportPrivateField: string;          // frontmatter field that signals a private note
  exportDomainField: string;           // frontmatter field to use as domain (blank = parent folder)
  exportTypeField: string;             // frontmatter field to use as type (blank = 'type')
  exportStatusField: string;           // frontmatter field to use as status (blank = 'status')
  exportDashboardName: string;         // dashboard note filename (blank = 'vault-dashboard')
  exportExcludeFolders: string[];      // folders to exclude from ontology export (any depth)

  // ── Shapes settings ─────────────────────────────────────────────
  shapesEnabled: boolean;
  shapesFolder: string;              // System/Shapes/
  shapeIncludeSubfolders: boolean;   // walk subfolders when gathering shape notes
  shapeLintEnabled: boolean;
  shapeLintScope: "all" | "folder";    // validate all vault notes or selected folders only
  shapeLintFolders: string[];          // folders to lint when scope is "folder"

  // Template refinement
  shapeRefinementEnabled: boolean;
  shapeTemplatesFolder: string;      // folder where templates are written
  shapeTypeTargetField: string;      // schema field that receives the shape name (e.g. "type", "kind")
  shapeCreatedField: string;         // date field stamped on create (blank = skip)
  shapeUpdatedField: string;         // date field stamped on every write (blank = skip)
  shapeTemplateFields: Record<string, { include: boolean; value: unknown }>;
  // ^ keyed by field name; created/updated are runtime-only, never stored here

  // Shape Repair
  shapeRepairEnabled: boolean;
  shapeRepairScope: "all" | "folder";         // repair all vault notes or selected folders only
  shapeRepairFolders: string[];               // folders to repair when scope is "folder"
  shapeRepairRunsFolder: string;              // folder where repair run notes are written
  shapeRepairFileLinks: boolean;              // wrap file paths in [[wikilinks]] in run notes
  shapeRepairHistoryRetentionCount: number;   // max entries in shape-repair-history.json

  // ── General: frontmatter field order ────────────────────────────
  // Controls the canonical sort order applied by writeNote() and the
  // sort_frontmatter patch operation. Fields not in this list are
  // appended alphabetically after the ordered fields.
  frontmatterFieldOrder: string[];
}

export const DEFAULT_SETTINGS: ForgeSettings = {
  // System paths
  systemFolder: "System",
  forgeFolder: "System/Forge",

  // Lint
  schemaNoteFolder: "System/Registry",
  schemaNoteFile: "schema.md",
  lintRunsFolder: "System/Exports/LintReports",
  lintStrictMode: false,
  lintRunRetentionCount: 20,
  lintFileLinks: false,
  lintInlineMetadata: true,

  // Stale review
  staleReviewEnabled: false,
  staleReviewCycleField: "review_cycle",
  staleReviewUpdatedField: "updated",
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
  lintHistoryRetentionDays: 14,
  lintHistoryMaxEntries: 20,
  patchReportRetentionCount: 20,

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
  shapeLintScope: "all",
  shapeLintFolders: [],
  shapeRefinementEnabled: false,
  shapeTemplatesFolder: "System/Templates",
  shapeTypeTargetField: "type",
  shapeCreatedField: "created",
  shapeUpdatedField: "updated",
  shapeTemplateFields: {},

  // Shape Repair
  shapeRepairEnabled: false,
  shapeRepairScope: "all",
  shapeRepairFolders: [],
  shapeRepairRunsFolder: "System/Exports/ShapeRepairRuns",
  shapeRepairFileLinks: false,
  shapeRepairHistoryRetentionCount: 20,

  // Frontmatter field order
  frontmatterFieldOrder: [],
};