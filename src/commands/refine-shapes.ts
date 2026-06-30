// src/commands/refine-shapes.ts
// Vault Shape Engine — template refinement.
//
// For each shape note in shapesFolder (type == shape, has a # Structure section):
//   1. Derives a template filename from the shape filename.
//   2. Builds template frontmatter from shapeTemplateFields config +
//      the shapeTypeTargetField set to the shape name.
//   3. If the template already exists, preserves `created`.
//   4. Writes the # Structure body (with headings promoted one level)
//      as the template body.
//   5. If shapeInjectRelationships is enabled, injects relationship headings
//      from schema.ontology.relationships for types this shape participates in.
//   6. Reports: created / updated / skipped.

import { Notice, TFile, TFolder } from "obsidian";
import type ForgePlugin from "../main";
import { getVaultPaths } from "../vault-paths";
import { readNote } from "../utils/frontmatter";
import { ensureFolder, localTimestamp, todayString } from "../utils/files";
import { VaultSchema, SchemaRelationship } from "../utils/schema";
import { serializeYaml, trimTrailingWhitespace } from "../utils/yaml";

function formatScalarValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

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
  const { settings } = plugin;

  if (!settings.shapesEnabled) {
    new Notice("Forge: Shapes is not enabled. Enable it in settings → shapes.", 5000);
    return;
  }

  if (!settings.shapeRefinementEnabled) {
    new Notice("Forge: Template refinement is not enabled. Enable it in settings → shapes.", 5000);
    return;
  }

  new Notice("Forge: Running shape template refinement…", 3000);

  const started = Date.now();
  const result = await refineShapes(plugin);
  await plugin.dashboardService.recordOperationalRun({
    command: "template_refinement",
    status: result.errors > 0 ? "partial" : "success",
    started_at: new Date(started).toISOString(),
    duration_ms: Date.now() - started,
    affected_files: result.created + result.updated,
    applied_items: result.created + result.updated,
    warnings: [],
    errors: result.results.filter((r) => r.status === "error").map((r) => `${r.template}: ${r.detail}`),
  });

  const summary = `Done. Created: ${result.created} | Updated: ${result.updated} | Skipped: ${result.skipped}${result.errors > 0 ? ` | Errors: ${result.errors}` : ""}`;
  new Notice(`Forge: ${summary}`, 6000);

  const errors = result.results.filter((r) => r.status === "error");
  if (errors.length > 0) {
    console.error("[Forge] Shape refinement errors:", errors);
  }
}

// ── Core engine ───────────────────────────────────────────────────────────────

export async function refineShapes(plugin: ForgePlugin, dryRun = false): Promise<RefinementRunResult> {
  const { app, settings } = plugin;
  const paths = getVaultPaths(settings);

  const results: RefinementResult[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  if (!dryRun) {
    await ensureFolder(app, paths.templates);
  }

  const shapesFolder = app.vault.getAbstractFileByPath(paths.shapes);
  if (!(shapesFolder instanceof TFolder)) {
    return { results, created, updated, skipped, errors, ranAt: localTimestamp() };
  }

  // Load schema once for the whole run if relationship injection is enabled
  const schema = settings.shapeInjectRelationships
    ? (plugin.schemaCache.peek() ?? await plugin.schemaCache.refresh())
    : null;

  const shapeFiles: TFile[] = [];
  const gatherShapes = (folder: TFolder) => {
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === "md") {
        shapeFiles.push(child);
      } else if (child instanceof TFolder && settings.shapeIncludeSubfolders) {
        gatherShapes(child);
      }
    }
  };
  gatherShapes(shapesFolder);

  for (const shapeFile of shapeFiles) {
    const result = await processShape(plugin, shapeFile, paths.templates, schema, dryRun);
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
  templatesFolder: string,
  schema: VaultSchema | null,
  dryRun: boolean
): Promise<RefinementResult> {
  const { app, settings } = plugin;
  const shapeName = shapeFile.basename;

  const templateFileName = shapeToTemplateName(shapeName);
  const templatePath = `${templatesFolder}/${templateFileName}`;

  const note = await readNote(app, shapeFile);
  if (!note) {
    return error(shapeName, templateFileName, "Could not read shape note");
  }

  const noteType = note.frontmatter["type"];
  const noteTypeText = formatScalarValue(noteType);
  if (noteTypeText && noteTypeText.toLowerCase() !== "shape") {
    return skipped(shapeName, templateFileName, `type is '${noteTypeText}', not 'shape'`);
  }

  const structure = getSectionBody(note.body, "Structure");
  if (!structure) {
    return skipped(shapeName, templateFileName, "No # Structure section found");
  }

  let body = promoteHeadings(structure).trim();

  // Inject relationship headings if enabled and schema is loaded
  if (schema && settings.shapeInjectRelationships) {
    body = injectRelationshipHeadings(body, shapeName, schema, settings);
  }

  const today = todayString();
  const existingTemplate = app.vault.getAbstractFileByPath(templatePath);
  const existingCreated = (existingTemplate instanceof TFile && settings.shapeCreatedField)
    ? await getExistingCreated(app, existingTemplate, settings.shapeCreatedField)
    : null;

  const fm = buildTemplateFrontmatter(settings, shapeName, today, existingCreated);
  const yaml = trimTrailingWhitespace(serializeYaml(fm));
  const newContent = `---\n${yaml}\n---\n\n${body}\n`;

  if (existingTemplate instanceof TFile) {
    const existingContent = await app.vault.read(existingTemplate);
    if (existingContent === newContent) {
      return skipped(shapeName, templateFileName, "No changes");
    }
    if (dryRun) {
      return { shape: shapeName, template: templateFileName, status: "updated", detail: "Template would be updated" };
    }
    await app.vault.modify(existingTemplate, newContent);
    return { shape: shapeName, template: templateFileName, status: "updated", detail: "Template updated" };
  } else {
    if (dryRun) {
      return { shape: shapeName, template: templateFileName, status: "created", detail: "Template would be created" };
    }
    await app.vault.create(templatePath, newContent);
    return { shape: shapeName, template: templateFileName, status: "created", detail: "Template created" };
  }
}

// ── Relationship injection ────────────────────────────────────────────────────

/**
 * Injects schema relationship headings into the template body.
 *
 * For each relationship in schema.ontology.relationships:
 *   - Flexible: include if shapeName is in allowed_between
 *   - Directional: include only if shapeName is in sources (not targets)
 *
 * Inject mode: finds the existing parent heading in the body and adds any
 *   missing subheadings under it in schema declaration order.
 *   Falls back to append if the parent heading is not found.
 *
 * Append mode: appends the full parent heading + subheadings at the end.
 */
function injectRelationshipHeadings(
  body: string,
  shapeName: string,
  schema: VaultSchema,
  settings: import("../settings").ForgeSettings
): string {
  const {
    shapeRelationshipHeading,
    shapeRelationshipHeadingLevel,
    shapeRelationshipPosition,
  } = settings;

  const parentLevel = shapeRelationshipHeadingLevel;
  const subLevel = parentLevel + 1;
  const parentPrefix = "#".repeat(parentLevel);
  const subPrefix = "#".repeat(subLevel);

  // Collect participating relationships in schema order
  const participatingRelationships = getParticipatingRelationships(
    shapeName,
    schema.ontology.relationships
  );

  if (participatingRelationships.length === 0) return body;

  const parentHeadingLine = `${parentPrefix} ${shapeRelationshipHeading}`;

  if (shapeRelationshipPosition === "inject") {
    return injectIntoExistingHeading(
      body,
      parentHeadingLine,
      participatingRelationships,
      subPrefix,
      parentPrefix
    );
  } else {
    return appendRelationshipSection(
      body,
      parentHeadingLine,
      participatingRelationships,
      subPrefix
    );
  }
}

interface RelationshipEntry {
  heading: string;
  description: string;
}

/**
 * Returns heading + description pairs for relationships where shapeName participates
 * as a valid source (or flexible member), in schema declaration order.
 */
function getParticipatingRelationships(
  shapeName: string,
  relationships: Record<string, SchemaRelationship>
): RelationshipEntry[] {
  const entries: RelationshipEntry[] = [];
  const name = shapeName.toLowerCase();

  for (const rel of Object.values(relationships)) {
    if (rel.direction === "flexible") {
      const members = rel.allowed_between ?? [];
      if (members.map((m) => m.toLowerCase()).includes(name)) {
        entries.push({ heading: rel.template_heading, description: rel.description ?? "" });
      }
    } else if (rel.direction === "directional") {
      const sources = rel.sources ?? [];
      if (sources.map((s) => s.toLowerCase()).includes(name)) {
        entries.push({ heading: rel.template_heading, description: rel.description ?? "" });
      }
    }
  }

  return entries;
}

/**
 * Finds the parent heading in the body and injects any missing subheadings
 * under it in schema order, after any existing subheadings.
 * Falls back to append if the parent heading is not found.
 */
function injectIntoExistingHeading(
  body: string,
  parentHeadingLine: string,
  entries: RelationshipEntry[],
  subPrefix: string,
  parentPrefix: string
): string {
  const lines = body.split("\n");
  const parentPattern = new RegExp(
    `^${parentPrefix.replace(/#/g, "\\#")}\\s+${escapeRegex(
      parentHeadingLine.replace(/^#+\s+/, "")
    )}\\s*$`
  );

  const parentIdx = lines.findIndex((l) => parentPattern.test(l));

  if (parentIdx === -1) {
    return appendRelationshipSection(body, parentHeadingLine, entries, subPrefix);
  }

  const parentDepth = parentPrefix.length;
  let sectionEnd = lines.length;
  for (let i = parentIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= parentDepth) {
      sectionEnd = i;
      break;
    }
  }

  // Collect already-present subheadings within the section
  const existingSubHeadings = new Set<string>();
  for (let i = parentIdx + 1; i < sectionEnd; i++) {
    const m = lines[i].match(new RegExp(`^${subPrefix.replace(/#/g, "\\#")}\\s+(.+)\\s*$`));
    if (m) existingSubHeadings.add(m[1].trim());
  }

  // Build lines to inject — only missing ones, in schema order, with description
  const toInject: string[] = [];
  for (const entry of entries) {
    if (!existingSubHeadings.has(entry.heading)) {
      toInject.push(`${subPrefix} ${entry.heading}`);
      if (entry.description) {
        toInject.push("", entry.description);
      }
      toInject.push(""); // blank line after each section before next heading
    }
  }

  if (toInject.length === 0) return body;

  let insertAt = parentIdx + 1;
  for (let i = sectionEnd - 1; i > parentIdx; i--) {
    if (lines[i].match(new RegExp(`^${subPrefix.replace(/#/g, "\\#")}\\s+`))) {
      insertAt = i + 1;
      break;
    }
  }

  // If inserting immediately after the parent heading, lead with a blank line
  const leadingBlank =
    insertAt === parentIdx + 1 && (lines[insertAt] ?? "") !== "" ? [""] : [];

  const result = [
    ...lines.slice(0, insertAt),
    ...leadingBlank,
    ...toInject,
    ...lines.slice(insertAt),
  ];

  return result.join("\n");
}

/**
 * Appends the parent heading and all subheadings at the end of the body.
 * If the parent heading already exists, only appends missing subheadings under it.
 */
function appendRelationshipSection(
  body: string,
  parentHeadingLine: string,
  entries: RelationshipEntry[],
  subPrefix: string
): string {
  const subLines: string[] = [];
  for (const entry of entries) {
    subLines.push(`${subPrefix} ${entry.heading}`);
    if (entry.description) {
      subLines.push("", entry.description);
    }
    subLines.push(""); // blank line after each section before next heading
  }
  // Blank line between parent heading and first subheading for readability
  const section = [parentHeadingLine, "", ...subLines].join("\n");
  return body ? `${body}\n\n${section}` : section;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Frontmatter builder ───────────────────────────────────────────────────────

function buildTemplateFrontmatter(
  settings: import("../settings").ForgeSettings,
  shapeName: string,
  today: string,
  existingCreated: string | null
): Record<string, unknown> {
  const { shapeTypeTargetField, shapeCreatedField, shapeUpdatedField, shapeTemplateFields, frontmatterFieldOrder } = settings;

  const base: Record<string, unknown> = {};
  for (const [fieldName, config] of Object.entries(shapeTemplateFields)) {
    if (config.include) {
      base[fieldName] = config.value;
    }
  }

  base[shapeTypeTargetField] = shapeName;

  if (shapeCreatedField) {
    base[shapeCreatedField] = existingCreated ?? today;
  }
  if (shapeUpdatedField) {
    base[shapeUpdatedField] = today;
  }

  const order = frontmatterFieldOrder.length > 0 ? frontmatterFieldOrder : Object.keys(base);
  const sorted: Record<string, unknown> = {};

  for (const field of order) {
    if (Object.prototype.hasOwnProperty.call(base, field)) {
      sorted[field] = base[field];
    }
  }
  for (const key of Object.keys(base)) {
    if (!Object.prototype.hasOwnProperty.call(sorted, key)) {
      sorted[key] = base[key];
    }
  }

  return sorted;
}

// ── Markdown helpers ──────────────────────────────────────────────────────────

function getSectionBody(body: string, heading: string): string | null {
  const lines = body.split("\n");
  const startPattern = new RegExp(`^#\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);

  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (startPattern.test(lines[i])) {
      startIdx = i + 1;
      break;
    }
  }

  if (startIdx === -1) return null;

  let endIdx = lines.length;
  for (let i = startIdx; i < lines.length; i++) {
    if (/^#\s+/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }

  return lines.slice(startIdx, endIdx).join("\n").trim();
}

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
  file: TFile,
  createdField: string
): Promise<string | null> {
  const note = await readNote(app, file);
  if (!note) return null;
  const val = note.frontmatter[createdField];
  if (val && typeof val === "string") return val;
  return null;
}

function skipped(shape: string, template: string, detail: string): RefinementResult {
  return { shape, template, status: "skipped", detail };
}

function error(shape: string, template: string, detail: string): RefinementResult {
  return { shape, template, status: "error", detail };
}
