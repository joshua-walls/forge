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
import {
  applyShapeRepair,
  buildShapeRepairHistoryContent,
  buildShapeRepairRunNoteArtifact,
  type ShapeRepairFileResult,
  type ShapeRepairFileStatus,
  type ShapeRepairRunResult as CoreShapeRepairRunResult,
} from "../shapes/repair";
import type ForgePlugin from "../main";
import { getVaultPaths } from "../vault/paths";
import { buildShapeHeadingCache } from "./shape-lint";
import type { ParsedHeading } from "./shape-lint";
import { readNote, backupNote } from "../utils/frontmatter";
import { ensureFolder, localTimestamp } from "../utils/files";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RepairFileStatus = ShapeRepairFileStatus;
export type RepairFileResult = ShapeRepairFileResult;
export type ShapeRepairRunResult = CoreShapeRepairRunResult;

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
  settings: import("../config/settings").ForgeSettings,
  paths: import("../vault/paths").VaultPaths,
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
    const { repairedContent, descriptions } = applyShapeRepair(content, templateHeadings);

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

// ── History writer ────────────────────────────────────────────────────────────

export async function appendShapeRepairHistory(
  app: App,
  settings: import("../config/settings").ForgeSettings,
  run: ShapeRepairRunResult
): Promise<void> {
  const paths = getVaultPaths(settings);
  await ensureFolder(app, paths.exports);
  const histPath = normalizePath(paths.shapeRepairHistory);
  const histFile = app.vault.getAbstractFileByPath(histPath);
  let existingContent: string | null = null;

  if (histFile instanceof TFile) {
    try {
      existingContent = await app.vault.read(histFile);
    } catch { existingContent = null; }
  }

  const content = buildShapeRepairHistoryContent(
    existingContent,
    run,
    settings.shapeRepairHistoryRetentionCount ?? 20
  );
  if (histFile instanceof TFile) {
    await app.vault.modify(histFile, content);
  } else {
    await app.vault.create(histPath, content);
  }
}

// ── Run note writer ───────────────────────────────────────────────────────────

export async function writeShapeRepairRunNote(
  app: App,
  settings: import("../config/settings").ForgeSettings,
  run: ShapeRepairRunResult
): Promise<string> {
  const artifact = buildShapeRepairRunNoteArtifact(settings, run);
  await ensureFolder(app, artifact.folder);
  const notePath = normalizePath(artifact.path);

  const existing = app.vault.getAbstractFileByPath(notePath);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, artifact.content);
  } else {
    await app.vault.create(notePath, artifact.content);
  }
  return notePath;
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
    summary.createDiv({ text: `${r.repaired} ${this.dryRun ? "would be repaired" : "repaired"}` });
    summary.createDiv({ text: `${r.skipped} skipped` });
    if (r.errors > 0) {
      summary.createDiv({ text: `${r.errors} errors`, cls: "forge-error-note" });
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
      info.createDiv({ text: f.path, cls: "forge-restore-path" });
      info.createDiv({
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
