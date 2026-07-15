// src/vault/paths.ts
// Resolves all standard vault paths from settings.
// Every command imports this — never builds paths independently.

import type { ForgeSettings } from "../config/settings.js";

export interface VaultPaths {
  // Schema
  schemaMd: string;

  // VaultForge system
  forge: string;
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
  shapes: string;
  templates: string;
  inbox: string;
  dashboards: string;
  shapeRepairHistory: string;

  // Patch
  patchFile: string;
}

/**
 * Returns all standard vault-relative paths derived from settings.
 * All paths use forward slashes and have no leading slash.
 */
export function getVaultPaths(settings: ForgeSettings): VaultPaths {
  const s = settings;

  const schemaMd = `${s.schemaNoteFolder}/${s.schemaNoteFile}`;
  const forge = s.forgeFolder;

  return {
    // Schema
    schemaMd,

    // VaultForge system
    forge,
    patches: s.patchesFolder,
    patchApplied: `${s.patchesFolder}/Applied`,
    patchBackups: s.patchBackupFolder || `${s.patchesFolder}/Backups`,
    patchReports: `${s.patchesFolder}/Reports`,
    indexDefinitions: `${forge}/Indexes`,

    // Exports
    exports: s.exportsFolder,
    lintReportJson: `${s.exportsFolder}/lint-report.json`,
    lintHistoryJson: `${s.exportsFolder}/lint-history.json`,
    vaultMeta: `${s.exportsFolder}/vault-meta.json`,
    // Human-readable lint report notes
    lintRuns: s.lintRunsFolder,

    // Vault structure
    shapes: s.shapesFolder,
    templates: s.shapeTemplatesFolder || `${s.systemFolder}/Templates`,
    inbox: s.inboxFolder,
    dashboards: `${s.systemFolder}/Dashboards`,
    shapeRepairHistory: `${s.exportsFolder}/shape-repair-history.json`,

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
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
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
 * Returns true if a path matches any exempt entry.
 * Entries with * are glob patterns; all others are folder or file path prefixes.
 * Case-insensitive. Forward-slash normalised.
 */
export function isExempt(path: string, exemptPaths: string[]): boolean {
  if (!exemptPaths.length) return false;
  const normalised = normalisePath(path).toLowerCase();
  return exemptPaths.some((p) => {
    if (p.includes("*")) return matchesGlob(path, p);

    const prefix = normalisePath(p).toLowerCase();
    return normalised === prefix || normalised.startsWith(`${prefix}/`);
  });
}

/**
 * Returns true if a vault-relative path matches a glob pattern.
 * Supports ** (any path segments) and * (any chars within one segment).
 * Case-insensitive.
 */
export function matchesGlob(path: string, pattern: string): boolean {
  const normPath = normalisePath(path).toLowerCase();
  const normPattern = normalisePath(pattern).toLowerCase();

  try {
    return new RegExp(`^${globToRegexBody(normPattern)}$`).test(normPath);
  } catch {
    return false;
  }
}

function globToRegexBody(pattern: string): string {
  let regex = "";
  for (let index = 0; index < pattern.length;) {
    const char = pattern[index];
    const next = pattern[index + 1];
    const afterNext = pattern[index + 2];

    if (char === "*" && next === "*" && afterNext === "/") {
      regex += "(.+/)?";
      index += 3;
      continue;
    }

    if (char === "*" && next === "*") {
      regex += ".*";
      index += 2;
      continue;
    }

    if (char === "*") {
      regex += "[^/]*";
      index += 1;
      continue;
    }

    regex += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    index += 1;
  }

  return regex;
}

export function localTimestamp(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export function todayString(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function safeTimestamp(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

export function buildExemptList(
  schemaExemptPaths: string[],
  forgeFolder: string,
  extraPaths: string[] = []
): string[] {
  return [...schemaExemptPaths, forgeFolder, ...extraPaths].filter(Boolean);
}

export function buildForgeControlPlaneExemptList(settings: ForgeSettings): string[] {
  const paths = getVaultPaths(settings);
  return uniqueExemptPaths([
    paths.forge,
    paths.exports,
    paths.lintRuns,
    settings.shapeRepairRunsFolder,
    paths.patches,
    paths.patchApplied,
    paths.patchBackups,
    paths.patchReports,
  ]);
}

export function buildVaultScanExemptList(
  settings: ForgeSettings,
  schemaExemptPaths: string[] = [],
  extraPaths: string[] = []
): string[] {
  return uniqueExemptPaths([
    ...schemaExemptPaths,
    ...buildForgeControlPlaneExemptList(settings),
    ...extraPaths,
  ]);
}

export function buildLintExemptList(
  settings: ForgeSettings,
  schemaExemptPaths: string[] = []
): string[] {
  const paths = getVaultPaths(settings);
  return buildVaultScanExemptList(
    settings,
    schemaExemptPaths,
    settings.lintExcludeInboxFolder ? [paths.inbox] : []
  );
}

export function buildShapeLintExemptList(
  settings: ForgeSettings,
  schemaExemptPaths: string[] = []
): string[] {
  const paths = getVaultPaths(settings);
  return buildVaultScanExemptList(
    settings,
    schemaExemptPaths,
    settings.shapeLintExcludeInboxFolder ? [paths.inbox] : []
  );
}

function uniqueExemptPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const path of paths) {
    const normalized = normalisePath(path);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    unique.push(normalized);
  }

  return unique;
}
