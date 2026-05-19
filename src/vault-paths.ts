// src/vault-paths.ts
// Resolves all standard vault paths from settings.
// Every command imports this — never builds paths independently.

import type { VaultForgeSettings } from "./settings";

export interface VaultPaths {
  // Schema
  schemaMd: string;

  // VaultForge system
  vaultForge: string;
  patches: string;
  patchApplied: string;
  patchBackups: string;
  patchReports: string;
  indexDefinitions: string;

  // Exports
  exports: string;
  lintReportJson: string;
  lintHistoryJson: string;
  vaultMeta: string;
  lintRuns: string;

  // Vault structure
  patterns: string;
  templates: string;
  inbox: string;
  dashboards: string;

  // Patch
  patchFile: string;
}

/**
 * Returns all standard vault-relative paths derived from settings.
 * All paths use forward slashes and have no leading slash.
 */
export function getVaultPaths(settings: VaultForgeSettings): VaultPaths {
  const s = settings;

  const schemaMd = `${s.schemaNoteFolder}/${s.schemaNoteFile}`;
  const vaultForge = s.vaultForgeFolder;

  return {
    // Schema
    schemaMd,

    // VaultForge system
    vaultForge,
    patches: s.patchesFolder,
    patchApplied: `${s.patchesFolder}/Applied`,
    patchBackups: `${s.patchesFolder}/Backups`,
    patchReports: `${s.patchesFolder}/Reports`,
    indexDefinitions: `${vaultForge}/Indexes`,

    // Exports
    exports: s.exportsFolder,
    lintReportJson: `${s.exportsFolder}/lint-report.json`,
    lintHistoryJson: `${s.exportsFolder}/lint-history.json`,
    vaultMeta: `${s.exportsFolder}/vault-meta.json`,
    lintRuns: s.lintRunsFolder,

    // Vault structure
    patterns: s.patternsFolder,
    templates: `${s.systemFolder}/Templates`,
    inbox: s.inboxFolder,
    dashboards: `${s.systemFolder}/Dashboards`,

    // Patch
    patchFile: s.patchDefaultFile,
  };
}

/**
 * Normalises a vault-relative path:
 * - replaces backslashes with forward slashes
 * - strips leading slashes
 */
export function normalisePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * Returns the domain (top-level folder) for a vault-relative path.
 * Notes at the root level return "Root".
 */
export function getDomain(relativePath: string): string {
  const normalised = normalisePath(relativePath);
  const firstSlash = normalised.indexOf("/");
  if (firstSlash < 0) return "Root";
  return normalised.substring(0, firstSlash);
}

/**
 * Returns true if a path starts with any of the given prefixes.
 * Case-insensitive. Forward-slash normalised.
 */
export function isExempt(path: string, exemptPaths: string[]): boolean {
  const normalised = normalisePath(path).toLowerCase();
  return exemptPaths.some((p) =>
    normalised.startsWith(normalisePath(p).toLowerCase())
  );
}

/**
 * Returns true if a vault-relative path matches a glob pattern.
 * Supports ** (any path segments) and * (any chars within one segment).
 * Case-insensitive.
 */
export function matchesGlob(path: string, pattern: string): boolean {
  const normPath = normalisePath(path).toLowerCase();
  const normPattern = normalisePath(pattern).toLowerCase();

  const regexStr =
    "^" +
    normPattern
      .split("**/")
      .map((segment) =>
        segment
          .split("*")
          .map((s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&"))
          .join("[^/]*")
      )
      .join("(.*/)?") +
    "$";

  return new RegExp(regexStr).test(normPath);
}
