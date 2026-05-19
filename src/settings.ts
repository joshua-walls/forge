// src/settings.ts
// Vault Forge plugin settings.
//
// Stored in .obsidian/plugins/vault-forge/data.json via Obsidian's
// loadData() / saveData() API. Never stored in vault notes.
//

export interface VaultForgeSettings {
  // ── System paths ──────────────────────────────────────────────────
  // All paths are relative to vault root.
  systemFolder: string;        // System/
  vaultForgeFolder: string;    // System/VaultForge/
  schemaNoteFolder: string;    // System/Registry/
  schemaNoteFile: string;      // schema.md
  exportsFolder: string;       // System/Exports/
  patchesFolder: string;       // System/VaultForge/Patches/
  lintRunsFolder: string;      // System/Exports/LintRuns/
  inboxFolder: string;         // System/Inbox/
  patternsFolder: string;      // System/Patterns/

  // ── Patch settings ────────────────────────────────────────────────
  patchBackupEnabled: boolean;        // back up files before modifying
                                      // backups go to System/VaultForge/Patches/Backups/
  patchGenerateManifest: boolean;     // write a restore manifest alongside backups
                                      // manifest goes to System/VaultForge/Patches/Reports/
  patchDefaultFile: string;           // System/VaultForge/Patches/vault-patch.md
  patchAutoLintAfterApply: boolean;   // run lint after patch applies
  patchAutoMaintenanceAfterApply: boolean;

  // ── Lint settings ─────────────────────────────────────────────────
  lintStrictMode: boolean;     // treat warnings as errors
  lintRunRetentionCount: number; // how many lint run notes to keep
  lintFileLinks: boolean;      // wrap file paths in [[wikilinks]] in lint run notes

  // ── Maintenance settings ──────────────────────────────────────────
  backupRetentionDays: number;
  inboxRetentionDays: number;
  lintHistoryRetentionDays: number;
  lintHistoryMaxEntries: number;
  patchReportRetentionCount: number;
}

export const DEFAULT_SETTINGS: VaultForgeSettings = {
  // System paths
  systemFolder: "System",
  vaultForgeFolder: "System/VaultForge",
  schemaNoteFolder: "System/Registry",
  schemaNoteFile: "schema.md",
  exportsFolder: "System/Exports",
  patchesFolder: "System/VaultForge/Patches",
  lintRunsFolder: "System/Exports/LintRuns",
  inboxFolder: "System/Inbox",
  patternsFolder: "System/Patterns",

  // Patch
  patchBackupEnabled: true,
  patchGenerateManifest: true,
  patchDefaultFile: "System/VaultForge/Patches/vault-patch.md",
  patchAutoLintAfterApply: true,
  patchAutoMaintenanceAfterApply: false,

  // Lint
  lintStrictMode: false,
  lintRunRetentionCount: 20,
  lintFileLinks: false,

  // Maintenance
  backupRetentionDays: 14,
  inboxRetentionDays: 14,
  lintHistoryRetentionDays: 14,
  lintHistoryMaxEntries: 20,
  patchReportRetentionCount: 20,
};
