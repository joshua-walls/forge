// src/commands/shape-repair.ts
// Shape Repair command.
//
// Corrects shape drift in vault notes by comparing each note's heading
// structure against its matched shape template recursively, using text + level
// + parent chain as the heading identity. A heading only satisfies a template
// node if it has the correct text, the correct level, AND sits under the
// correct parent heading in the note.
//
// Safe mutations only:
//   - Insert missing headings at the correct position within their parent section
//   - Reorder headings recursively at every depth to match template sequence
//   - Unknown user headings are preserved and sink to the bottom of their section
//
// What it will NEVER do:
//   - Delete any heading or content
//   - Re-level an existing heading
//   - Modify frontmatter
//   - Fill empty sections
//
// Flow:
//   1. Guard: shapesEnabled + shapeRepairEnabled
//   2. Build template heading cache (reuses shape-lint infrastructure)
//   3. For each vault note with a matching template: compute RepairPlan
//   4. Skip if no-op; otherwise backup → apply → log
//   5. Append shape-repair-history.json (prune to retention count)
//   6. Write repair run note to shapeRepairRunsFolder
//   7. Show results modal

import { App, Modal, Notice, TFile, normalizePath } from "obsidian";
import type ForgePlugin from "../main";
import { getVaultPaths } from "../vault-paths";
import { buildShapeHeadingCache, buildTemplateTree, flattenTemplateTree } from "./shape-lint";
import type { ParsedHeading, TemplateNode } from "./shape-lint";
import { readNote, backupNote } from "../utils/frontmatter";
import { ensureFolder, localTimestamp, todayString } from "../utils/files";

// ── Document section model ────────────────────────────────────────────────────
//
// The note body (post-frontmatter) is represented as a tree of DocSection
// nodes mirroring the heading structure. Each section owns its heading line,
// the non-heading content lines immediately beneath it, and an ordered list
// of child sections. Unknown sections (not in template) are flagged so they
// can be appended at the tail of their parent during reassembly.

interface DocSection {
  headingText: string;       // original casing
  headingLevel: number;
  headingLine: string;       // the raw "## Foo" line
  contentLines: string[];    // non-heading lines directly under this heading
  children: DocSection[];    // child sections in document order
  isUnknown: boolean;        // true if not matched by any template node
}

/**
 * Builds a DocSection tree from a lines array (frontmatter already stripped).
 * `templateRoots` is used only to flag unknown sections — it does NOT affect
 * the tree structure, which is derived purely from heading levels in the note.
 */
function buildDocTree(
  bodyLines: string[],
  templateRoots: TemplateNode[]
): { roots: DocSection[]; leadingLines: string[] } {
  // Flatten all template nodes for unknown-detection
  const allTemplateNodes = flattenTemplateTree(templateRoots);

  const headings = extractHeadingsFromLines(bodyLines);

  // Build a flat section list first (heading + its direct non-heading content)
  // Each section spans from its heading line to the line before the next
  // heading of equal or lesser depth.
  const flatSections: DocSection[] = [];

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const nextSameOrHigher = headings.slice(i + 1).find((nh) => nh.level <= h.level);
    const sectionEnd = nextSameOrHigher ? nextSameOrHigher.lineIndex : bodyLines.length;

    // contentLines = lines after the heading line, before any child headings
    const firstChildHeading = headings.slice(i + 1).find(
      (nh) => nh.lineIndex < sectionEnd && nh.level > h.level
    );
    const contentEnd = firstChildHeading ? firstChildHeading.lineIndex : sectionEnd;
    const contentLines = bodyLines.slice(h.lineIndex + 1, contentEnd);

    const isUnknown = !allTemplateNodes.some(
      (tn) => tn.text.toLowerCase() === h.text.toLowerCase() && tn.level === h.level
    );

    flatSections.push({
      headingText: h.text,
      headingLevel: h.level,
      headingLine: bodyLines[h.lineIndex],
      contentLines,
      children: [],   // populated below
      isUnknown,
    });
  }

  // Nest into tree by level — same algorithm as buildTemplateTree
  const roots: DocSection[] = [];
  const stack: DocSection[] = [];

  for (const section of flatSections) {
    while (stack.length > 0 && stack[stack.length - 1].headingLevel >= section.headingLevel) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(section);
    } else {
      stack[stack.length - 1].children.push(section);
    }
    stack.push(section);
  }

  // Leading body content before the first heading
  const firstHeadingLine = headings.length > 0 ? headings[0].lineIndex : bodyLines.length;
  const leadingLines = bodyLines.slice(0, firstHeadingLine);

  return { roots, leadingLines };
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type RepairFileStatus = "repaired" | "skipped" | "dry_run" | "error";

export interface RepairFileResult {
  path: string;
  status: RepairFileStatus;
  operations: string[];
  detail: string;
  backupPath?: string;   // set when a backup was written before repair
}

export interface ShapeRepairRunResult {
  ranAt: string;
  dryRun: boolean;
  repaired: number;
  skipped: number;
  errors: number;
  files: RepairFileResult[];
}

export interface ShapeRepairHistoryEntry {
  ranAt: string;
  dryRun: boolean;
  repaired: number;
  skipped: number;
  errors: number;
  files: RepairFileResult[];
}

function isShapeRepairHistoryEntry(value: unknown): value is ShapeRepairHistoryEntry {
  return typeof value === "object" && value !== null;
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function runShapeRepair(
  plugin: ForgePlugin,
  dryRun = false
): Promise<void> {
  const { app, settings } = plugin;

  if (!settings.shapesEnabled) {
    new Notice("Forge: Shapes is not enabled. Enable it in settings → shapes.", 5000);
    return;
  }

  if (!settings.shapeRepairEnabled) {
    new Notice("Forge: Shape repair is not enabled. Enable it in settings → shapes.", 5000);
    return;
  }

  const label = dryRun ? "Shape Repair (Dry Run)" : "Shape Repair";
  new Notice(`Forge: Running ${label}…`, 3000);

  const started = Date.now();
  const result = await repairShapes(plugin, dryRun);

  let runNotePath: string | null = null;
  if (!dryRun) {
    await appendShapeRepairHistory(app, settings, result);
    runNotePath = await writeShapeRepairRunNote(app, settings, result);
    await plugin.dashboardService.recordOperationalRun({
      command: "repair",
      status: result.errors > 0 ? "partial" : "success",
      started_at: new Date(started).toISOString(),
      duration_ms: Date.now() - started,
      affected_files: result.repaired,
      applied_items: result.repaired,
      warnings: [],
      errors: result.files.filter((file) => file.status === "error").map((file) => `${file.path}: ${file.detail}`),
    });
    await plugin.patchHistoryService.readHistory("patch-history");
  }

  new ShapeRepairModal(app, plugin, result, runNotePath, dryRun).open();
}

// ── Core engine ───────────────────────────────────────────────────────────────

export async function repairShapes(
  plugin: ForgePlugin,
  dryRun: boolean
): Promise<ShapeRepairRunResult> {
  const { app, settings } = plugin;
  const paths = getVaultPaths(settings);

  const files: RepairFileResult[] = [];
  let repaired = 0;
  let skipped = 0;
  let errors = 0;

  const headingCache = await buildShapeHeadingCache(app, settings);
  if (headingCache.size === 0) {
    return { ranAt: localTimestamp(), dryRun, repaired, skipped, errors, files };
  }

  // Apply scope filter
  const allNotes = app.vault.getMarkdownFiles();
  let scopedNotes = allNotes;

  if (settings.shapeRepairScope === "folder") {
    if (!settings.shapeRepairFolders || settings.shapeRepairFolders.length === 0) {
      new Notice("Forge: Shape repair scope is set to 'folder' but no folders are selected.", 5000);
      return { ranAt: localTimestamp(), dryRun, repaired, skipped, errors, files };
    }
    const prefixes = settings.shapeRepairFolders.map((f) => f.toLowerCase().replace(/\/?$/, "/"));
    scopedNotes = allNotes.filter((f) =>
      prefixes.some((p) => f.path.toLowerCase().startsWith(p))
    );
  }

  for (const file of scopedNotes) {
    const result = await repairNote(app, settings, paths, file, headingCache, dryRun);
    files.push(result);
    if (result.status === "repaired" || result.status === "dry_run") repaired++;
    else if (result.status === "skipped") skipped++;
    else errors++;
  }

  return { ranAt: localTimestamp(), dryRun, repaired, skipped, errors, files };
}

// ── Per-note repair ───────────────────────────────────────────────────────────

async function repairNote(
  app: App,
  settings: import("../settings").ForgeSettings,
  paths: import("../vault-paths").VaultPaths,
  file: TFile,
  headingCache: Map<string, ParsedHeading[]>,
  dryRun: boolean
): Promise<RepairFileResult> {
  try {
    const note = await readNote(app, file);
    if (!note || !note.hasFrontmatter) return skip(file.path, "No frontmatter");

    const typeValue = note.frontmatter[settings.shapeTypeTargetField];
    if (!typeValue || typeof typeValue !== "string") return skip(file.path, "No type target field");

    const shapeName = typeValue.trim().toLowerCase();
    const templateHeadings = headingCache.get(shapeName);
    if (!templateHeadings || templateHeadings.length === 0) return skip(file.path, "No matching template");

    const content = await app.vault.read(file);
    const { repairedContent, descriptions } = applyRepair(content, templateHeadings);

    if (descriptions.length === 0) return skip(file.path, "Already conforms");

    if (dryRun) {
      return {
        path: file.path,
        status: "dry_run",
        operations: descriptions,
        detail: `${descriptions.length} operation(s) would be applied`,
      };
    }

    // Backup before any write
    const backupPath = await backupNote(app, file, paths.patchBackups);
    await app.vault.modify(file, repairedContent);

    return {
      path: file.path,
      status: "repaired",
      operations: descriptions,
      detail: `${descriptions.length} operation(s) applied`,
      backupPath: backupPath ?? undefined,
    };
  } catch (e) {
    return {
      path: file.path,
      status: "error",
      operations: [],
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── Repair engine ─────────────────────────────────────────────────────────────

/**
 * Top-level repair entry. Splits frontmatter from body, builds both trees,
 * runs the recursive repair pass, and reassembles the document.
 *
 * Returns the repaired content string and a list of human-readable operation
 * descriptions. If descriptions is empty the note already conforms.
 */
function applyRepair(
  content: string,
  templateHeadings: ParsedHeading[]
): { repairedContent: string; descriptions: string[] } {
  const lines = content.split("\n");
  const { frontmatterLines, bodyLines } = splitFrontmatter(lines);

  const templateRoots = buildTemplateTree(templateHeadings);
  const { roots: docRoots, leadingLines } = buildDocTree(bodyLines, templateRoots);

  const descriptions: string[] = [];

  // Recursively repair each level
  const repairedRoots = repairLevel(templateRoots, docRoots, descriptions);

  // Reassemble
  const repairedBody = [
    ...leadingLines,
    ...serializeSections(repairedRoots),
  ];

  const repairedContent = [...frontmatterLines, ...repairedBody].join("\n");
  return { repairedContent, descriptions };
}

/**
 * Repairs one level of the heading hierarchy.
 *
 * For each template node at this level:
 *   1. Find a matching doc section (text + level) within the current scope.
 *   2. If not found: create it (insert with blank placeholder content).
 *   3. Recurse into children of the matched/created section.
 *
 * After processing template nodes, append unknown doc sections (not in
 * template at this level) at the tail in their original relative order.
 *
 * Returns the repaired ordered section list for this level.
 */
function repairLevel(
  templateNodes: TemplateNode[],
  docSections: DocSection[],
  descriptions: string[],
  parentText?: string
): DocSection[] {
  const result: DocSection[] = [];
  const consumed = new Set<DocSection>();

  for (const tn of templateNodes) {
    // Find matching doc section: text (case-insensitive) + exact level
    const match = docSections.find(
      (ds) =>
        !consumed.has(ds) &&
        ds.headingText.toLowerCase() === tn.text.toLowerCase() &&
        ds.headingLevel === tn.level
    );

    if (match) {
      consumed.add(match);
      // Recurse into children — repair their order and insert any missing
      const repairedChildren = repairLevel(tn.children, match.children, descriptions, tn.text);
      result.push({ ...match, children: repairedChildren });
    } else {
      // Missing — create a synthetic section with a blank placeholder
      const prefix = "#".repeat(tn.level);
      const context = parentText ? ` (under '${parentText}')` : "";
      descriptions.push(`Insert missing heading: '${prefix} ${tn.text}'${context}`);

      const newSection: DocSection = {
        headingText: tn.text,
        headingLevel: tn.level,
        headingLine: `${prefix} ${tn.text}`,
        contentLines: [""],   // blank placeholder line
        children: [],
        isUnknown: false,
      };

      // Recurse to insert any children this new section needs
      newSection.children = repairLevel(tn.children, [], descriptions, tn.text);
      result.push(newSection);
    }
  }

  // Append unconsumed (unknown) sections at the tail, preserving their order
  // and recursively repairing their children against an empty template
  // (i.e. children pass through unchanged)
  const unknowns = docSections.filter((ds) => !consumed.has(ds));
  for (const u of unknowns) {
    result.push({
      ...u,
      children: repairLevel([], u.children, descriptions, u.headingText),
    });
  }

  // Detect and record reorder operations (after insertions are resolved).
  // Only compare sections that existed in the original doc (consumed), not
  // newly inserted ones — those weren't reordered, they were created.
  const originalOrder = docSections
    .filter((ds) => consumed.has(ds))
    .map((ds) => ds.headingText.toLowerCase());

  const expectedOrder = originalOrder.length > 0
    ? templateNodes
        .map((tn) => tn.text.toLowerCase())
        .filter((t) => originalOrder.includes(t))
    : [];

  if (
    originalOrder.length > 1 &&
    !arraysEqualOrder(originalOrder, expectedOrder)
  ) {
    const context = parentText ? ` within '${parentText}'` : "";
    descriptions.push(
      `Reorder headings${context}: ${expectedOrder.map((t) => `'${t}'`).join(" → ")}`
    );
  }

  return result;
}

/**
 * Serializes a DocSection tree back to a flat lines array.
 * Heading line → content lines → children (recursively).
 */
function serializeSections(sections: DocSection[]): string[] {
  const lines: string[] = [];
  for (const s of sections) {
    lines.push(s.headingLine);
    lines.push(...s.contentLines);
    lines.push(...serializeSections(s.children));
  }
  return lines;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function splitFrontmatter(lines: string[]): {
  frontmatterLines: string[];
  bodyLines: string[];
} {
  if (lines[0]?.trim() !== "---") {
    return { frontmatterLines: [], bodyLines: lines };
  }
  let closingIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") { closingIdx = i; break; }
  }
  if (closingIdx === -1) return { frontmatterLines: [], bodyLines: lines };
  return {
    frontmatterLines: lines.slice(0, closingIdx + 1),
    bodyLines: lines.slice(closingIdx + 1),
  };
}

function extractHeadingsFromLines(lines: string[]): ParsedHeading[] {
  const headings: ParsedHeading[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (m) headings.push({ level: m[1].length, text: m[2].trim(), lineIndex: i });
  }
  return headings;
}

function arraysEqualOrder(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

// ── History writer ────────────────────────────────────────────────────────────

export async function appendShapeRepairHistory(
  app: App,
  settings: import("../settings").ForgeSettings,
  run: ShapeRepairRunResult
): Promise<void> {
  const paths = getVaultPaths(settings);
  await ensureFolder(app, paths.exports);

  const entry: ShapeRepairHistoryEntry = {
    ranAt: run.ranAt,
    dryRun: run.dryRun,
    repaired: run.repaired,
    skipped: run.skipped,
    errors: run.errors,
    files: run.files.filter((f) => f.status !== "skipped"),
  };

  let history: ShapeRepairHistoryEntry[] = [];
  const histPath = normalizePath(paths.shapeRepairHistory);
  const histFile = app.vault.getAbstractFileByPath(histPath);

  if (histFile instanceof TFile) {
    try {
      const raw = await app.vault.read(histFile);
      const parsed: unknown = JSON.parse(raw);
      history = Array.isArray(parsed) ? parsed.filter(isShapeRepairHistoryEntry) : [];
    } catch { history = []; }
  }

  history.push(entry);

  const max = settings.shapeRepairHistoryRetentionCount ?? 20;
  if (history.length > max) history = history.slice(history.length - max);

  const content = JSON.stringify(history, null, 2);
  if (histFile instanceof TFile) {
    await app.vault.modify(histFile, content);
  } else {
    await app.vault.create(histPath, content);
  }
}

// ── Run note writer ───────────────────────────────────────────────────────────

export async function writeShapeRepairRunNote(
  app: App,
  settings: import("../settings").ForgeSettings,
  run: ShapeRepairRunResult
): Promise<string> {
  const runsFolder = settings.shapeRepairRunsFolder || getVaultPaths(settings).exports;
  await ensureFolder(app, runsFolder);

  const safeTs = run.ranAt.replace(/[:.]/g, "-").replace("T", "_").replace(/\s/g, "_");
  const notePath = normalizePath(`${runsFolder}/shape-repair-${safeTs}.md`);
  const today = todayString();
  const content = buildRepairRunNote(run, today, settings.shapeRepairFileLinks ?? false);

  const existing = app.vault.getAbstractFileByPath(notePath);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
  } else {
    await app.vault.create(notePath, content);
  }
  return notePath;
}

function buildRepairRunNote(run: ShapeRepairRunResult, today: string, fileLinks: boolean): string {
  const dryLabel = run.dryRun ? " (Dry Run)" : "";
  const lines: string[] = [
    "---",
    "type: reference",
    "status: complete",
    "tags:",
    "  - meta/shape-repair",
    `created: ${today}`,
    `updated: ${today}`,
    "ai_private: false",
    "review_cycle: never",
    "---",
    "",
    `runtime:: ${run.ranAt}`,
    `dry_run:: ${run.dryRun}`,
    `repaired:: ${run.repaired}`,
    `skipped:: ${run.skipped}`,
    `errors:: ${run.errors}`,
    "",
    `# Shape Repair Run${dryLabel}`,
    "",
    "## Summary",
    "",
    "| Status | Count |",
    "|--------|-------|",
    `| ✅ Repaired${run.dryRun ? " (would)" : ""} | ${run.repaired} |`,
    `| ⏭️ Skipped  | ${run.skipped}   |`,
    `| 🔴 Errors   | ${run.errors}    |`,
    "",
  ];

  const touched = run.files.filter((f) => f.status === "repaired" || f.status === "dry_run");
  const errored = run.files.filter((f) => f.status === "error");

  if (touched.length > 0) {
    lines.push(`## ${run.dryRun ? "Would Repair" : "Repaired"}`, "");
    for (const f of touched) {
      const ref = fileLinks ? `[[${f.path}]]` : `\`${f.path}\``;
      lines.push(`### ${ref}`, "");
      for (const op of f.operations) lines.push(`- ${op}`);
      lines.push("");
    }
  }

  if (errored.length > 0) {
    lines.push("## Errors", "");
    for (const f of errored) {
      const ref = fileLinks ? `[[${f.path}]]` : `\`${f.path}\``;
      lines.push(`- ${ref}: ${f.detail}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Results modal ─────────────────────────────────────────────────────────────

class ShapeRepairModal extends Modal {
  private plugin: ForgePlugin;
  private result: ShapeRepairRunResult;
  private runNotePath: string | null;
  private dryRun: boolean;

  constructor(
    app: App,
    plugin: ForgePlugin,
    result: ShapeRepairRunResult,
    runNotePath: string | null,
    dryRun: boolean
  ) {
    super(app);
    this.plugin = plugin;
    this.result = result;
    this.runNotePath = runNotePath;
    this.dryRun = dryRun;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("forge-modal");

    const r = this.result;
    const dryLabel = this.dryRun ? " (Dry Run)" : "";

    contentEl.createEl("h2", {
      text: r.errors > 0
        ? `❌ Shape Repair${dryLabel} — Completed with Errors`
        : `✅ Shape Repair${dryLabel} — Complete`,
    });

    const body = contentEl.createDiv("forge-modal-body");

    const summary = body.createDiv("forge-lint-summary");
    summary.createEl("div", { text: `${r.repaired} ${this.dryRun ? "would be repaired" : "repaired"}` });
    summary.createEl("div", { text: `${r.skipped} skipped` });
    if (r.errors > 0) {
      summary.createEl("div", { text: `${r.errors} errors`, cls: "forge-error-note" });
    }

    const touched = r.files.filter((f) => f.status === "repaired" || f.status === "dry_run");
    if (touched.length > 0) {
      body.createEl("h3", { text: this.dryRun ? "Would Repair" : "Repaired" });
      const list = body.createEl("ul", { cls: "forge-lint-list" });
      for (const f of touched) {
        const item = list.createEl("li");
        item.createEl("strong", { text: f.path });
        const opList = item.createEl("ul");
        for (const op of f.operations) opList.createEl("li", { text: op });
      }
    }

    const errored = r.files.filter((f) => f.status === "error");
    if (errored.length > 0) {
      body.createEl("h3", { text: "Errors" });
      const list = body.createEl("ul", { cls: "forge-lint-list" });
      for (const f of errored) list.createEl("li", { text: `${f.path}: ${f.detail}` });
    }

    // Pinned footer
    const footer = contentEl.createDiv("forge-modal-footer");
    const buttonRow = footer.createDiv("forge-button-row");

    const viewBtn = buttonRow.createEl("button", { text: "View run note", cls: "mod-cta" });
    viewBtn.addEventListener("click", () => {
      this.close();
      if (this.runNotePath) {
        void this.app.workspace.openLinkText(this.runNotePath, "", false);
      }
    });
    if (!this.runNotePath) viewBtn.disabled = true;

    if (this.dryRun && r.repaired > 0) {
      const applyBtn = buttonRow.createEl("button", { text: "Apply repair now" });
      applyBtn.addEventListener("click", () => {
        this.close();
        void runShapeRepair(this.plugin, false);
      });
    }

    const repairedWithBackup = r.files.filter(
      (f) => f.status === "repaired" && f.backupPath
    );
    if (!this.dryRun && repairedWithBackup.length > 0) {
      const restoreBtn = buttonRow.createEl("button", { text: "Restore files…" });
      restoreBtn.addEventListener("click", () => {
        this.close();
        new ShapeRepairRestoreModal(this.app, repairedWithBackup).open();
      });
    }

    const closeBtn = buttonRow.createEl("button", { text: "Close" });
    closeBtn.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// ── Restore modal ─────────────────────────────────────────────────────────────

class ShapeRepairRestoreModal extends Modal {
  private files: RepairFileResult[];

  constructor(app: App, files: RepairFileResult[]) {
    super(app);
    this.files = files;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("forge-modal");

    contentEl.createEl("h2", { text: "Restore repaired files" });
    contentEl.createEl("p", {
      text: "Each file below was backed up before repair. Restoring replaces the current " +
            "note content with the pre-repair backup. This cannot be undone.",
      cls: "setting-item-description",
    });

    const body = contentEl.createDiv("forge-modal-body");
    const list = body.createDiv("forge-restore-list");

    for (const f of this.files) {
      const row = list.createDiv("forge-restore-row");

      const info = row.createDiv("forge-restore-info");
      info.createEl("div", { text: f.path, cls: "forge-restore-path" });
      info.createEl("div", {
        text: `Backup: ${f.backupPath}`,
        cls: "forge-restore-backup",
      });

      const btn = row.createEl("button", { text: "Restore" });
      btn.addEventListener("click", () => {
        void (async () => {
          btn.setText("Restoring…");
          btn.disabled = true;

          try {
            const backupPath = f.backupPath;
            if (!backupPath) {
              btn.setText("Backup not found");
              return;
            }

            const backupFile = this.app.vault.getAbstractFileByPath(backupPath);
            if (!(backupFile instanceof TFile)) {
              btn.setText("Backup not found");
              return;
            }

            const originalFile = this.app.vault.getAbstractFileByPath(f.path);
            if (!(originalFile instanceof TFile)) {
              btn.setText("Original not found");
              return;
            }

            const backupContent = await this.app.vault.read(backupFile);
            await this.app.vault.modify(originalFile, backupContent);

            btn.setText("✓ restored");
            row.addClass("forge-restore-done");
          } catch (error) {
            btn.setText("Error");
            console.error("[Forge] Restore failed:", error);
          }
        })();
      });
    }

    const footer = contentEl.createDiv("forge-modal-footer");
    const buttonRow = footer.createDiv("forge-button-row");
    const closeBtn = buttonRow.createEl("button", { text: "Close", cls: "mod-cta" });
    closeBtn.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// ── Result helpers ────────────────────────────────────────────────────────────

function skip(path: string, detail: string): RepairFileResult {
  return { path, status: "skipped", operations: [], detail };
}
