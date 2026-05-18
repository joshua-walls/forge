// src/utils/files.ts
// File system utilities using the Obsidian Vault API.
//
// Port of:
//   Shared/Core/Ensure-Directory.ps1
//   Shared/IO/Test-IsExempt.ps1
//   Invoke-VaultPatch.ps1 → Resolve-Targets
//   vault-paths.ts → matchesGlob (moved here as the canonical location)
//
// All file access goes through app.vault — never Node.js fs directly.
// This ensures iOS compatibility (no filesystem access on iOS).

import { App, TFile, TFolder, normalizePath } from "obsidian";

// ── Folder utilities ─────────────────────────────────────────────────────────

/**
 * Creates a folder at the given vault-relative path if it doesn't already exist.
 * Creates intermediate folders as needed.
 *
 * Port of Ensure-Directory from Shared/Core/Ensure-Directory.ps1.
 */
export async function ensureFolder(app: App, folderPath: string): Promise<void> {
  const normalised = normalizePath(folderPath);
  if (!normalised || normalised === ".") return;

  const existing = app.vault.getAbstractFileByPath(normalised);
  if (existing instanceof TFolder) return;

  // Create intermediate folders recursively
  const parts = normalised.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const node = app.vault.getAbstractFileByPath(current);
    if (!node) {
      try {
        await app.vault.createFolder(current);
      } catch (e) {
        // May already exist due to race condition — ignore
      }
    }
  }
}

// ── File listing ─────────────────────────────────────────────────────────────

/**
 * Returns all markdown files in the vault, optionally filtered by a root folder.
 * Excludes hidden folders (.obsidian, .vault-patch-backups).
 */
export function getMarkdownFiles(app: App, rootFolder?: string): TFile[] {
  const files = app.vault.getMarkdownFiles();

  if (!rootFolder) return files.filter((f) => !isHiddenPath(f.path));

  const prefix = normalizePath(rootFolder).toLowerCase() + "/";
  return files.filter(
    (f) => f.path.toLowerCase().startsWith(prefix) && !isHiddenPath(f.path)
  );
}

/**
 * Returns the TFile at a vault-relative path, or null if not found.
 */
export function getFile(app: App, path: string): TFile | null {
  const file = app.vault.getAbstractFileByPath(normalizePath(path));
  return file instanceof TFile ? file : null;
}

/**
 * Returns all TFiles matching a glob pattern across the vault.
 * Handles both single-file targets (target:) and glob patterns (target_pattern:).
 *
 * Port of Resolve-Targets from Invoke-VaultPatch.ps1, with the ** fix
 * from matchesGlob() that the original PowerShell was missing.
 */
export function resolveTargets(app: App, target?: string, targetPattern?: string): TFile[] {
  const results: TFile[] = [];

  if (target) {
    const file = getFile(app, target);
    if (file) {
      results.push(file);
    } else {
      console.warn(`[VaultForge] target not found: ${target}`);
    }
  }

  if (targetPattern) {
    const allFiles = getMarkdownFiles(app);
    for (const file of allFiles) {
      if (matchesGlob(file.path, targetPattern)) {
        results.push(file);
      }
    }
  }

  // Deduplicate by path
  const seen = new Set<string>();
  return results.filter((f) => {
    if (seen.has(f.path)) return false;
    seen.add(f.path);
    return true;
  });
}

// ── Exemption check ──────────────────────────────────────────────────────────

/**
 * Returns true if a vault-relative path starts with any of the exempt path prefixes.
 * Case-insensitive. Forward-slash normalised.
 *
 * Port of Test-IsExempt from Shared/IO/Test-IsExempt.ps1.
 */
export function isExempt(path: string, exemptPaths: string[]): boolean {
  if (!exemptPaths.length) return false;
  const normalised = normalizePath(path).toLowerCase();
  return exemptPaths.some((p) => {
    const prefix = normalizePath(p).toLowerCase();
    return normalised.startsWith(prefix + "/") || normalised === prefix;
  });
}

// ── Glob matching ─────────────────────────────────────────────────────────────

/**
 * Returns true if a vault-relative path matches a glob pattern.
 *
 * Supports:
 *   [star][star]  — matches zero or more path segments (recursive)
 *   [star]        — matches any characters within a single path segment
 *
 * This is the authoritative implementation — vault-paths.ts delegates here.
 * Fix for the glob bug in the original Invoke-VaultPatch.ps1 which used
 * PowerShell's -like operator (no recursive glob support).
 *
 * Examples:
 *   "Work/Skills/[star].md"          matches "Work/Skills/Identity.md"
 *   "Work/[star][star]/[star].md"    matches "Work/Skills/Identity.md"
 *   "Church/Scripture (WEB)/[star][star]"  matches nested scripture notes
 */
export function matchesGlob(path: string, pattern: string): boolean {
  const normPath = normalizePath(path).toLowerCase();
  const normPattern = normalizePath(pattern).toLowerCase();

  // Convert glob to regex
  const regexStr = globToRegex(normPattern);
  try {
    return new RegExp(regexStr).test(normPath);
  } catch {
    return false;
  }
}

function globToRegex(pattern: string): string {
  // Escape all regex special chars except * and /
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");

  // Replace **/ with a regex that matches zero or more path segments
  // Replace remaining * with [^/]* (any char except /)
  const regexBody = escaped
    .replace(/\*\*\//g, "(.+/)?")   // **/ → optional path segments
    .replace(/\*\*/g, ".*")          // ** at end → anything
    .replace(/\*/g, "[^/]*");        // * → any chars in one segment

  return `^${regexBody}$`;
}

// ── Path utilities ────────────────────────────────────────────────────────────

/**
 * Returns the domain (top-level folder) for a vault-relative path.
 * Notes at root level return "Root".
 */
export function getDomain(path: string): string {
  const normalised = normalizePath(path);
  const firstSlash = normalised.indexOf("/");
  if (firstSlash < 0) return "Root";
  return normalised.substring(0, firstSlash);
}

/**
 * Returns true if a path is inside a hidden folder (.obsidian, .vault-patch-backups, etc.)
 */
function isHiddenPath(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}

/**
 * Returns a timestamp string safe for use in filenames.
 * Format: 2026-05-17_143022
 */
export function safeTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/T/, "_")
    .replace(/:/g, "")
    .substring(0, 15);
}

/**
 * Returns today's date in yyyy-MM-dd format.
 */
export function todayString(): string {
  return new Date().toISOString().substring(0, 10);
}
