// src/utils/frontmatter.ts
// Frontmatter read, write, and backup utilities.
//
// Port of:
//   Shared/IO/Get-Frontmatter.ps1
//   Invoke-VaultPatch.ps1 → Read-NoteFile, Write-NoteFile, Backup-NoteFile
//   Shared/Schema/Sort-FrontmatterFields.ps1
//
// Uses Obsidian's built-in parseYaml / stringifyYaml — no external dependency.
// These are thin wrappers around js-yaml, the same library Obsidian uses internally.

import { App, TFile, normalizePath, parseYaml } from "obsidian";
import {
  getFmString as getCoreFmString,
  isFieldPresent as isCoreFieldPresent,
  sortFrontmatterFields as sortCoreFrontmatterFields,
} from "@forge/core";
import { ensureFolder, safeTimestamp } from "./files";
import { serializeYaml, trimTrailingWhitespace } from "./yaml";

// ── Types ────────────────────────────────────────────────────────────────────

export interface VaultNote {
  /** Parsed frontmatter as a plain object. Empty object if no frontmatter. */
  frontmatter: Record<string, unknown>;
  /** Note body — everything after the closing --- */
  body: string;
  /** True if the note had a valid frontmatter block */
  hasFrontmatter: boolean;
  /** The TFile this note was read from */
  file: TFile;
}

// ── Read ─────────────────────────────────────────────────────────────────────

/**
 * Reads a TFile and splits it into frontmatter + body.
 * Returns null if the file cannot be read.
 *
 * Port of Get-Frontmatter.ps1 + Read-NoteFile from Invoke-VaultPatch.ps1.
 */
export async function readNote(
  app: App,
  file: TFile
): Promise<VaultNote | null> {
  let raw: string;

  try {
    raw = await app.vault.read(file);
  } catch (e) {
    console.warn(`[Forge] Could not read file: ${file.path}`, e);
    return null;
  }

  return parseNote(raw, file);
}

/**
 * Parses raw file content into a VaultNote.
 * Exported for testing without needing a real TFile.
 */
export function parseNote(raw: string, file: TFile): VaultNote {
  // Match frontmatter block: must start at line 1 with ---
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

  if (!match) {
    return {
      frontmatter: {},
      body: raw,
      hasFrontmatter: false,
      file,
    };
  }

  const fmText = match[1];
  const body = match[2] ?? "";

  let frontmatter: Record<string, unknown> = {};

  try {
    const parsed: unknown = parseYaml(fmText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      frontmatter = parsed as Record<string, unknown>;
    }
  } catch (e) {
    console.warn(`[Forge] Could not parse YAML in: ${file.path}`, e);
  }

  return {
    frontmatter,
    body,
    hasFrontmatter: true,
    file,
  };
}

// ── Write ────────────────────────────────────────────────────────────────────

/**
 * Serializes a VaultNote back to disk.
 * Sorts frontmatter fields into canonical order before writing.
 * Callers are responsible for calling backupNote() before writeNote()
 * if backup is desired.
 *
 * Port of Write-NoteFile from Invoke-VaultPatch.ps1.
 */
export async function writeNote(
  app: App,
  note: VaultNote,
  fieldOrder?: string[]
): Promise<void> {
  const sorted = sortFrontmatterFields(note.frontmatter, fieldOrder);
  const yaml = trimTrailingWhitespace(serializeYaml(sorted));
  const newContent = `---\n${yaml}\n---\n${note.body}`;
  await app.vault.modify(note.file, newContent);
}

// ── Backup ───────────────────────────────────────────────────────────────────

/**
 * Copies a file to .vault-patch-backups/ in the same directory before modification.
 * Backup filename includes a timestamp to prevent collisions.
 *
 * Port of Backup-NoteFile from Invoke-VaultPatch.ps1.
 */
export async function backupNote(
  app: App,
  file: TFile,
  backupFolder: string
): Promise<string | null> {
  await ensureFolder(app, backupFolder);

  const timestamp = safeTimestamp().replace(/[_]/g, "_").replace(/:/g, "-");

  // Flatten the file path into the filename so same-named files
  // from different folders never collide in the central backup folder.
  const safeName = file.path.replace(/\//g, "_");
  const backupPath = normalizePath(
    `${backupFolder}/${safeName}.${timestamp}.bak`
  );

  try {
    const content = await app.vault.read(file);
    await app.vault.create(backupPath, content);
    return backupPath;
  } catch (e) {
    // Non-fatal — log and continue. Backup failure should not block the patch.
    console.warn(`[Forge] Could not create backup for ${file.path}:`, e);
    return null;
  }
}

// ── Sort frontmatter fields ───────────────────────────────────────────────────

/**
 * Returns a new object with fields in canonical schema order.
 * Unknown fields are appended alphabetically after the known fields.
 *
 * Port of Sort-FrontmatterFields from Shared/Schema/Sort-FrontmatterFields.ps1.
 */
export function sortFrontmatterFields(
  frontmatter: Record<string, unknown>,
  fieldOrder?: string[]
): Record<string, unknown> {
  return sortCoreFrontmatterFields(frontmatter, fieldOrder);
}

// ── Field utilities ───────────────────────────────────────────────────────────

/**
 * Returns true if a frontmatter field is present and non-empty.
 * Handles strings, arrays, booleans, and numbers.
 *
 * Port of Test-FieldPresent from Invoke-VaultLint.ps1.
 */
export function isFieldPresent(
  frontmatter: Record<string, unknown>,
  fieldName: string
): boolean {
  return isCoreFieldPresent(frontmatter, fieldName);
}

/**
 * Returns a frontmatter field value as a string, or empty string if absent.
 * Arrays are joined with "; " to match the inventory CSV format.
 *
 * Port of Get-FmValue from Shared/Ontology/Get-FmValue.ps1.
 */
export function getFmString(
  frontmatter: Record<string, unknown>,
  fieldName: string
): string {
  return getCoreFmString(frontmatter, fieldName);
}
