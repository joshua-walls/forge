// src/commands/refine-shapes.ts
// Vault Shape Engine — template refinement.
//
// Port of Invoke-TemplateRefinement.ps1.
//
// For each shape note in shapesFolder (type == shape, has a # Structure section):
//   1. Derives a template filename from the shape filename.
//   2. Builds template frontmatter from shapeTemplateFields config +
//      the shapeTypeTargetField set to the shape name.
//   3. If the template already exists, preserves `created`.
//   4. Writes the # Structure body (with headings promoted one level)
//      as the template body.
//   5. Reports: created / updated / skipped.

import { Notice, TFile, TFolder } from "obsidian";
import type ForgePlugin from "../main";
import { getVaultPaths } from "../vault-paths";
import { readNote } from "../utils/frontmatter";
import { ensureFolder, localTimestamp, todayString } from "../utils/files";
import { stringifyYaml } from "obsidian";

export interface RefinementResult {
  shape: string;
  template: string;
  status: "created" | "updated" | "skipped" | "error";
  detail: string;
}

export interface RefinementRunResult {
  results: RefinementResult[];
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  ranAt: string;
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function runRefineShapes(plugin: ForgePlugin): Promise<void> {
  const { app, settings } = plugin;

  if (!settings.shapesEnabled) {
    new Notice("Forge: Shapes is not enabled. Enable it in Settings → Shapes.", 5000);
    return;
  }

  if (!settings.shapeRefinementEnabled) {
    new Notice("Forge: Template refinement is not enabled. Enable it in Settings → Shapes.", 5000);
    return;
  }

  new Notice("Forge: Running shape template refinement…", 3000);

  const result = await refineShapes(plugin);

  const summary = `Done. Created: ${result.created} | Updated: ${result.updated} | Skipped: ${result.skipped}${result.errors > 0 ? ` | Errors: ${result.errors}` : ""}`;
  new Notice(`Forge: ${summary}`, 6000);

  const errors = result.results.filter((r) => r.status === "error");
  if (errors.length > 0) {
    console.error("[Forge] Shape refinement errors:", errors);
  }
}

// ── Core engine ───────────────────────────────────────────────────────────────

export async function refineShapes(plugin: ForgePlugin): Promise<RefinementRunResult> {
  const { app, settings } = plugin;
  const paths = getVaultPaths(settings);

  const results: RefinementResult[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  // Ensure templates folder exists
  await ensureFolder(app, paths.templates);

  // Load all .md files from shapes folder
  const shapesFolder = app.vault.getAbstractFileByPath(paths.shapes);
  if (!(shapesFolder instanceof TFolder)) {
    return { results, created, updated, skipped, errors, ranAt: localTimestamp() };
  }

  const shapeFiles = shapesFolder.children.filter(
    (f): f is TFile => f instanceof TFile && f.extension === "md"
  );

  for (const shapeFile of shapeFiles) {
    const result = await processShape(plugin, shapeFile, paths.templates);
    results.push(result);
    if (result.status === "created") created++;
    else if (result.status === "updated") updated++;
    else if (result.status === "skipped") skipped++;
    else errors++;
  }

  return { results, created, updated, skipped, errors, ranAt: localTimestamp() };
}

// ── Per-shape processing ──────────────────────────────────────────────────────

async function processShape(
  plugin: ForgePlugin,
  shapeFile: TFile,
  templatesFolder: string
): Promise<RefinementResult> {
  const { app, settings } = plugin;
  const shapeName = shapeFile.basename; // e.g. "meeting"

  const templateFileName = shapeToTemplateName(shapeName);
  const templatePath = `${templatesFolder}/${templateFileName}`;

  const note = await readNote(app, shapeFile);
  if (!note) {
    return error(shapeName, templateFileName, "Could not read shape note");
  }

  // Must be type: shape (or no type — treat as shape if in shapes folder)
  const noteType = note.frontmatter["type"];
  if (noteType && String(noteType).toLowerCase() !== "shape") {
    return skipped(shapeName, templateFileName, `type is '${noteType}', not 'shape'`);
  }

  // Extract # Structure section
  const structure = getSectionBody(note.body, "Structure");
  if (!structure) {
    return skipped(shapeName, templateFileName, "No # Structure section found");
  }

  const body = promoteHeadings(structure).trim();

  // Build frontmatter
  const today = todayString();
  const existingTemplate = app.vault.getAbstractFileByPath(templatePath);
  const existingCreated = existingTemplate instanceof TFile
    ? await getExistingCreated(app, existingTemplate)
    : null;

  const fm = buildTemplateFrontmatter(settings, shapeName, today, existingCreated);

  // Serialize
  const yaml = stringifyYaml(fm).trimEnd();
  const newContent = `---\n${yaml}\n---\n\n${body}\n`;

  // Write
  if (existingTemplate instanceof TFile) {
    const existingContent = await app.vault.read(existingTemplate);
    if (existingContent === newContent) {
      return skipped(shapeName, templateFileName, "No changes");
    }
    await app.vault.modify(existingTemplate, newContent);
    return { shape: shapeName, template: templateFileName, status: "updated", detail: "Template updated" };
  } else {
    await app.vault.create(templatePath, newContent);
    return { shape: shapeName, template: templateFileName, status: "created", detail: "Template created" };
  }
}

// ── Frontmatter builder ───────────────────────────────────────────────────────

function buildTemplateFrontmatter(
  settings: import("../settings").ForgeSettings,
  shapeName: string,
  today: string,
  existingCreated: string | null
): Record<string, unknown> {
  const { shapeTypeTargetField, shapeTemplateFields, frontmatterFieldOrder } = settings;

  // Start with configured field values (included fields only)
  const base: Record<string, unknown> = {};
  for (const [fieldName, config] of Object.entries(shapeTemplateFields)) {
    if (config.include) {
      base[fieldName] = config.value;
    }
  }

  // Type target field always set to shape name
  base[shapeTypeTargetField] = shapeName;

  // Runtime timestamps — always present
  base["created"] = existingCreated ?? today;
  base["updated"] = today;

  // Sort into frontmatterFieldOrder
  const order = frontmatterFieldOrder.length > 0 ? frontmatterFieldOrder : Object.keys(base);
  const sorted: Record<string, unknown> = {};

  for (const field of order) {
    if (Object.prototype.hasOwnProperty.call(base, field)) {
      sorted[field] = base[field];
    }
  }
  // Append anything not in the order list
  for (const key of Object.keys(base)) {
    if (!Object.prototype.hasOwnProperty.call(sorted, key)) {
      sorted[key] = base[key];
    }
  }

  return sorted;
}

// ── Markdown helpers ──────────────────────────────────────────────────────────

/**
 * Extracts the body of a top-level markdown section by heading name.
 * Returns null if the section is not found.
 * Port of Get-SectionBody from Invoke-TemplateRefinement.ps1.
 */
function getSectionBody(body: string, heading: string): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match from "# Heading\n" to the next top-level "# " heading or end of string.
  // \z is not valid in JS — use (?=^#\s) with the m flag, and fall back to end via
  // a two-pass approach: find the section start, then slice to next H1 or EOF.
  const lines = body.split("\n");
  const startPattern = new RegExp(`^#\\s+${escaped}\\s*$`);

  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (startPattern.test(lines[i])) {
      startIdx = i + 1; // line after the heading
      break;
    }
  }

  if (startIdx === -1) return null;

  // Find the next top-level H1 (single #) after startIdx
  let endIdx = lines.length;
  for (let i = startIdx; i < lines.length; i++) {
    if (/^#\s+/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }

  return lines.slice(startIdx, endIdx).join("\n").trim();
}

/**
 * Promotes all headings by one level (## → #, ### → ##, etc.).
 * Port of Promote-MarkdownHeadings from Invoke-TemplateRefinement.ps1.
 */
function promoteHeadings(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      const m = line.match(/^(#{2,6})\s+(.*)$/);
      if (!m) return line;
      return "#".repeat(m[1].length - 1) + " " + m[2];
    })
    .join("\n");
}

// ── Name derivation ───────────────────────────────────────────────────────────

/**
 * Converts a shape filename base to a template filename.
 * "meeting" → "Template, Meeting.md"
 * "api-spec" → "Template, Api Spec.md"
 * Port of Convert-PatternFileNameToTemplateFileName.
 */
function shapeToTemplateName(shapeName: string): string {
  const title = shapeName
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
  return `Template, ${title}.md`;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

async function getExistingCreated(
  app: import("obsidian").App,
  file: TFile
): Promise<string | null> {
  const note = await readNote(app, file);
  if (!note) return null;
  const val = note.frontmatter["created"];
  if (val && typeof val === "string") return val;
  return null;
}

function skipped(shape: string, template: string, detail: string): RefinementResult {
  return { shape, template, status: "skipped", detail };
}

function error(shape: string, template: string, detail: string): RefinementResult {
  return { shape, template, status: "error", detail };
}