// src/commands/restore-patch.ts
// Restore Patch Run command.
//
// Forge 1.2 manifests restore individual operations when possible. Legacy
// manifests still fall back to full-file .bak replacement with a clear warning.

import { App, Modal, Notice, TFile, normalizePath, parseYaml } from "obsidian";
import {
  applyPatchRestoreOperations,
  buildLegacyPatchRestoreCandidates,
  buildPatchRestoreReportArtifact,
  createForgeDocument,
  evaluatePatchRestoreCandidates as evaluateCorePatchRestoreCandidates,
  isPatchRestoreManifest,
  parsePatchFile,
  type ForgeDocument,
  type LegacyPatchRestoreBackupDocument,
  type PatchDocumentUpdate,
  type PatchFile,
  type PatchOperationChange,
  type PatchRestoreApplyResult,
  type PatchRestoreCandidate,
  type PatchRestoreManifest,
  type PatchRestoreValue,
} from "@forge/core";
import type ForgePlugin from "../main";
import { getVaultPaths } from "../vault-paths";
import { ensureFolder } from "../utils/files";
import { serializeYaml } from "../utils/yaml";

// ── Types ─────────────────────────────────────────────────────────────────────

type PatchManifest = PatchRestoreManifest;
type RestoreCandidate = PatchRestoreCandidate;
type RestoreApplyResult = PatchRestoreApplyResult;

// ── Entry point ───────────────────────────────────────────────────────────────

export async function runRestorePatch(plugin: ForgePlugin): Promise<void> {
  const { app, settings } = plugin;
  const paths = getVaultPaths(settings);

  const manifestFolders = [paths.patchReports, paths.patches].map((path) =>
    normalizePath(path).replace(/\/$/, "")
  );
  const seen = new Set<string>();
  const manifestFiles = app.vault.getFiles().filter((f) => {
    if (!f.name.endsWith("-patch-manifest.json")) return false;
    if (seen.has(f.path)) return false;

    const isManifest = manifestFolders.some((folder) =>
      f.path.startsWith(folder + "/")
    );
    if (isManifest) seen.add(f.path);
    return isManifest;
  }).sort((a, b) => b.name.localeCompare(a.name));

  if (manifestFiles.length === 0) {
    new Notice("Forge: No patch manifests found. Apply a patch with restore manifests enabled first.", 6000);
    return;
  }

  const manifests: PatchManifest[] = [];
  for (const file of manifestFiles) {
    try {
      const raw = await app.vault.read(file);
      const parsed: unknown = JSON.parse(raw);
      if (isPatchRestoreManifest(parsed)) {
        manifests.push(parsed);
      }
    } catch {
      // Skip unreadable manifests.
    }
  }

  if (manifests.length === 0) {
    new Notice("Forge: Could not read any patch manifests.", 5000);
    return;
  }

  new RestorePatchModal(app, plugin, manifests).open();
}

// ── Modal ─────────────────────────────────────────────────────────────────────

class RestorePatchModal extends Modal {
  private plugin: ForgePlugin;
  private manifests: PatchManifest[];
  private selected: PatchManifest | null = null;
  private candidates: RestoreCandidate[] = [];

  constructor(app: App, plugin: ForgePlugin, manifests: PatchManifest[]) {
    super(app);
    this.plugin = plugin;
    this.manifests = manifests;
  }

  onOpen(): void {
    this.renderList();
  }

  private renderList(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Restore patch run" });
    contentEl.createEl("p", {
      text: "Select a patch run. Newer manifests can restore selected operations without overwriting later edits.",
      cls: "setting-item-description",
    });

    const list = contentEl.createDiv("forge-restore-list");

    for (const manifest of this.manifests) {
      const ops = manifest.operations?.length ?? 0;
      const legacyFiles = manifest.changes?.length ?? 0;
      const isV2 = ops > 0;
      const item = list.createDiv("forge-restore-item");
      item.addEventListener("click", () => {
        void (async () => {
          this.selected = manifest;
          if (isV2) {
            this.candidates = await evaluateRestoreCandidates(this.app, manifest);
            this.renderOperationRestore();
          } else {
            const synthesized = await synthesizeLegacyOperationCandidates(this.app, this.plugin, manifest);
            if (synthesized.length > 0) {
              manifest.operations = synthesized.map((candidate) => candidate.operation);
              this.candidates = synthesized;
              this.renderOperationRestore();
            } else {
              this.renderLegacyConfirm();
            }
          }
        })();
      });

      const date = manifest.applied_at ? new Date(manifest.applied_at).toLocaleString() : "Unknown date";
      item.createEl("div", { text: manifest.description || manifest.run_id, cls: "forge-restore-title" });
      item.createEl("div", {
        text: isV2
          ? `${date} - ${ops} operation(s) - operation restore`
          : `${date} - ${legacyFiles} file(s) - legacy, selectable if patch can be reconstructed`,
        cls: "forge-restore-meta",
      });
    }

    const closeBtn = contentEl.createEl("button", { text: "Cancel" });
    closeBtn.addEventListener("click", () => this.close());
  }

  private renderOperationRestore(): void {
    const { contentEl } = this;
    const manifest = this.selected!;
    contentEl.empty();

    const reversible = this.candidates.filter((c) => c.status === "reversible");
    const conflicted = this.candidates.filter((c) => c.status === "conflicted");
    const blocked = this.candidates.filter((c) =>
      ["missing_target", "unsupported", "error"].includes(c.status)
    );
    const selectedCount = this.candidates.filter((c) => c.selected).length;

    contentEl.createEl("h2", { text: "Restore patch operations" });
    contentEl.createEl("p", {
      text: manifest.description || manifest.run_id,
      cls: "forge-patch-description",
    });
    contentEl.createEl("p", {
      text: `Applied: ${manifest.applied_at ? new Date(manifest.applied_at).toLocaleString() : "Unknown date"}`,
      cls: "setting-item-description",
    });
    contentEl.createEl("p", {
      text: `${reversible.length} reversible, ${conflicted.length} conflicted, ${blocked.length} blocked. Conflicted operations are skipped to preserve later edits.`,
      cls: "setting-item-description",
    });

    const list = contentEl.createDiv("forge-restore-list");
    for (const candidate of this.candidates) {
      const row = list.createDiv("forge-restore-item");
      const label = row.createEl("label");
      const checkbox = label.createEl("input", { type: "checkbox" });
      checkbox.checked = candidate.selected;
      checkbox.disabled = candidate.status !== "reversible";
      checkbox.addEventListener("change", () => {
        candidate.selected = checkbox.checked;
        this.renderOperationRestore();
      });
      label.createSpan({ text: ` ${candidate.operation.label || candidate.operation.op}` });

      row.createEl("div", {
        text: candidate.operation.file_after,
        cls: "forge-restore-path",
      });
      row.createEl("div", {
        text: `${candidate.status}: ${candidate.reason}`,
        cls: "forge-restore-meta",
      });
      row.createEl("div", {
        text: `${describeRestoreValue(candidate.operation.after)} -> ${describeRestoreValue(candidate.operation.before)}`,
        cls: "forge-restore-backup",
      });
    }

    const buttonRow = contentEl.createDiv("forge-button-row");

    const restoreBtn = buttonRow.createEl("button", {
      text: `Restore ${selectedCount} selected`,
      cls: "mod-cta",
    });
    restoreBtn.disabled = selectedCount === 0;
    restoreBtn.addEventListener("click", () => {
      void (async () => {
        const selected = this.candidates.filter((c) => c.selected);
        this.close();
        await this.applyOperationRestore(manifest, selected);
      })();
    });

    const backBtn = buttonRow.createEl("button", { text: "Back" });
    backBtn.addEventListener("click", () => this.renderList());

    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
  }

  private renderLegacyConfirm(): void {
    const { contentEl } = this;
    const manifest = this.selected!;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Confirm legacy restore" });
    contentEl.createEl("p", {
      text: manifest.description || manifest.run_id,
      cls: "forge-patch-description",
    });
    contentEl.createEl("p", {
      text: `Applied: ${manifest.applied_at ? new Date(manifest.applied_at).toLocaleString() : "Unknown date"}`,
      cls: "setting-item-description",
    });

    contentEl.createEl("h3", { text: `${manifest.changes.length} file(s) will be restored` });

    const list = contentEl.createEl("ul", { cls: "forge-change-list" });
    for (const change of manifest.changes.slice(0, 20)) {
      list.createEl("li", { text: change.file });
    }
    if (manifest.changes.length > 20) {
      list.createEl("li", { text: `...and ${manifest.changes.length - 20} more`, cls: "forge-more" });
    }

    contentEl.createEl("p", {
      text: "This older manifest does not contain operation data. Restore will overwrite current files with backup content.",
      cls: "forge-error-note",
    });

    const buttonRow = contentEl.createDiv("forge-button-row");

    const restoreBtn = buttonRow.createEl("button", { text: "Restore files", cls: "mod-cta mod-warning" });
    restoreBtn.addEventListener("click", () => {
      void (async () => {
        this.close();
        await this.applyLegacyRestore(manifest);
      })();
    });

    const backBtn = buttonRow.createEl("button", { text: "Back" });
    backBtn.addEventListener("click", () => this.renderList());

    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
  }

  private async applyOperationRestore(
    manifest: PatchManifest,
    selected: RestoreCandidate[]
  ): Promise<void> {
    const operations = selected.map((candidate) => candidate.operation);
    const documents = await loadRestoreDocuments(this.app, operations);
    const restore = applyPatchRestoreOperations({
      documents,
      operations,
      settings: this.plugin.settings,
      stringifyYaml: serializeYaml,
    });
    const writeErrors = await writeRestoreDocumentUpdates(this.app, restore.documents, operations);
    const writeErrorOperationIds = new Set(writeErrors.map((result) => result.operation.id));
    const results: RestoreApplyResult[] = [
      ...restore.results.filter((result) =>
        !(result.status === "restored" && writeErrorOperationIds.has(result.operation.id))
      ),
      ...writeErrors,
    ];

    const reportPath = await writeRestoreReport(this.app, this.plugin, manifest, results, false);
    await this.plugin.patchHistoryService.readHistory("patch-history");
    await this.plugin.recomposeHealthDashboard();

    const restored = results.filter((r) => r.status === "restored").length;
    const conflicts = results.filter((r) => r.status === "conflicted").length;
    const errors = results.filter((r) => r.status === "error").length;

    new Notice(
      `Forge: Restored ${restored} operation(s). ${conflicts} conflict(s), ${errors} error(s).`,
      errors || conflicts ? 7000 : 5000
    );
    void this.app.workspace.openLinkText(reportPath, "", false);
  }

  private async applyLegacyRestore(manifest: PatchManifest): Promise<void> {
    const { app } = this;
    let restored = 0;
    let failed = 0;
    const results: RestoreApplyResult[] = [];

    for (const change of manifest.changes) {
      const backupPath = normalizePath(change.backup);
      const targetPath = normalizePath(change.file);

      if (!(await app.vault.adapter.exists(backupPath))) {
        console.warn(`[Forge] Backup not found: ${change.backup}`);
        failed++;
        continue;
      }

      try {
        const backupContent = await app.vault.adapter.read(backupPath);
        const targetFile = app.vault.getAbstractFileByPath(targetPath);

        if (targetFile instanceof TFile) {
          await app.vault.modify(targetFile, backupContent);
        } else {
          const folder = targetPath.includes("/")
            ? targetPath.substring(0, targetPath.lastIndexOf("/"))
            : "";
          if (folder) await ensureFolder(app, folder);
          await app.vault.create(targetPath, backupContent);
        }

        restored++;
      } catch (e) {
        console.warn(`[Forge] Could not restore ${change.file}:`, e);
        failed++;
      }
    }

    await writeRestoreReport(this.app, this.plugin, manifest, results, true, {
      restored,
      conflicted: 0,
      skipped: 0,
      errors: failed,
    });
    await this.plugin.patchHistoryService.readHistory("patch-history");
    await this.plugin.recomposeHealthDashboard();

    if (failed > 0) {
      new Notice(`Forge: Restored ${restored} file(s). ${failed} backup(s) not found.`, 7000);
    } else {
      new Notice(`Forge: Restored ${restored} file(s) from legacy patch run.`, 5000);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// ── Operation restore ─────────────────────────────────────────────────────────

async function evaluateRestoreCandidates(
  app: App,
  manifest: PatchManifest
): Promise<RestoreCandidate[]> {
  const documents = await loadRestoreDocuments(app, manifest.operations ?? []);
  return evaluateCorePatchRestoreCandidates(manifest, documents);
}

async function synthesizeLegacyOperationCandidates(
  app: App,
  plugin: ForgePlugin,
  manifest: PatchManifest
): Promise<RestoreCandidate[]> {
  const patchFile = await loadArchivedPatchFile(app, plugin, manifest);
  if (!patchFile || patchFile.operations.length === 0) return [];

  const targetPaths = new Set(patchFile.operations
    .map((operation) => operation.target ? normalizePath(operation.target) : "")
    .filter((path) => path.length > 0));
  const currentDocuments = await loadRestoreDocumentsForPaths(app, [...targetPaths]);
  const backupDocuments = await loadLegacyBackupDocuments(app, manifest, targetPaths);

  return buildLegacyPatchRestoreCandidates({
    patchFile,
    manifest,
    currentDocuments,
    backupDocuments,
  });
}

async function loadArchivedPatchFile(
  app: App,
  plugin: ForgePlugin,
  manifest: PatchManifest
): Promise<PatchFile | null> {
  const paths = getVaultPaths(plugin.settings);
  const candidates = [
    normalizePath(manifest.patch_file),
    normalizePath(`${paths.patchApplied}/${manifest.run_id}-vault-patch.md`),
    normalizePath(`${paths.patchApplied}/${manifest.run_id}-vault-patch.yaml`),
    normalizePath(`${paths.patchApplied}/${manifest.run_id}-vault-patch.yml`),
  ];

  for (const path of candidates) {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) continue;

    try {
      const raw = await app.vault.read(file);
      const patch = parsePatchFile(raw, path, parseYaml);
      if (patch) return patch;
    } catch {
      continue;
    }
  }

  return null;
}

async function loadRestoreDocuments(
  app: App,
  operations: PatchOperationChange[]
): Promise<ForgeDocument[]> {
  const paths = new Set<string>();
  for (const operation of operations) {
    paths.add(normalizePath(operation.file_after));
    paths.add(normalizePath(operation.file_before));
  }

  return loadRestoreDocumentsForPaths(app, [...paths]);
}

async function loadRestoreDocumentsForPaths(
  app: App,
  paths: string[]
): Promise<ForgeDocument[]> {
  const documents: ForgeDocument[] = [];
  for (const path of paths) {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) continue;

    try {
      const content = await app.vault.read(file);
      documents.push(createForgeDocument({
        path: file.path,
        content,
        parseYaml,
      }));
    } catch {
      // Missing or unreadable files are reported by the core restore evaluator.
    }
  }

  return documents;
}

async function loadLegacyBackupDocuments(
  app: App,
  manifest: PatchManifest,
  targetPaths: ReadonlySet<string>
): Promise<LegacyPatchRestoreBackupDocument[]> {
  const documents: LegacyPatchRestoreBackupDocument[] = [];

  for (const change of manifest.changes ?? []) {
    const targetPath = normalizePath(change.file);
    if (!targetPaths.has(targetPath)) continue;

    const backupPath = normalizePath(change.backup);
    if (!(await app.vault.adapter.exists(backupPath))) continue;

    try {
      const backupRaw = await app.vault.adapter.read(backupPath);
      const backupDocument = createForgeDocument({
        path: targetPath,
        content: backupRaw,
        parseYaml,
      });
      documents.push({
        file: targetPath,
        frontmatter: backupDocument.frontmatter,
      });
    } catch {
      // Unreadable backups cannot be reconstructed and will fall back to legacy restore.
    }
  }

  return documents;
}

async function writeRestoreDocumentUpdates(
  app: App,
  updates: PatchDocumentUpdate[],
  operations: PatchOperationChange[]
): Promise<RestoreApplyResult[]> {
  const errors: RestoreApplyResult[] = [];

  for (const update of updates) {
    const operation = operationForUpdate(update, operations);
    if (!operation) continue;

    const sourcePath = normalizePath(update.pathBefore);
    const targetPath = normalizePath(update.pathAfter);
    const sourceFile = app.vault.getAbstractFileByPath(sourcePath);
    if (!(sourceFile instanceof TFile)) {
      errors.push({ operation, status: "error", detail: "Current file is missing" });
      continue;
    }

    try {
      if (sourcePath.toLowerCase() === targetPath.toLowerCase()) {
        await app.vault.modify(sourceFile, update.contentAfter);
        continue;
      }

      if (app.vault.getAbstractFileByPath(targetPath)) {
        errors.push({ operation, status: "conflicted", detail: "Original path is occupied" });
        continue;
      }

      const folder = targetPath.includes("/") ? targetPath.substring(0, targetPath.lastIndexOf("/")) : "";
      if (folder) await ensureFolder(app, folder);

      await app.vault.rename(sourceFile, targetPath);
      const movedFile = app.vault.getAbstractFileByPath(targetPath);
      if (movedFile instanceof TFile) {
        await app.vault.modify(movedFile, update.contentAfter);
      }
    } catch (error) {
      errors.push({
        operation,
        status: "error",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return errors;
}

function operationForUpdate(
  update: PatchDocumentUpdate,
  operations: PatchOperationChange[]
): PatchOperationChange | null {
  const before = normalizePath(update.pathBefore).toLowerCase();
  const after = normalizePath(update.pathAfter).toLowerCase();
  return operations.find((operation) =>
    normalizePath(operation.file_after).toLowerCase() === before ||
    normalizePath(operation.file_before).toLowerCase() === after
  ) ?? operations[0] ?? null;
}

function describeRestoreValue(value: PatchRestoreValue): string {
  if (!value.exists) return "<missing>";
  if (Array.isArray(value.value)) return `[${value.value.join(", ")}]`;
  if (typeof value.value === "string") return value.value;
  return JSON.stringify(value.value);
}

async function writeRestoreReport(
  app: App,
  plugin: ForgePlugin,
  manifest: PatchManifest,
  results: RestoreApplyResult[],
  legacy: boolean,
  summary?: { restored: number; conflicted: number; skipped: number; errors: number }
): Promise<string> {
  const artifact = buildPatchRestoreReportArtifact(plugin.settings, manifest, results, { legacy, summary });
  await ensureFolder(app, artifact.folder);

  const existing = app.vault.getAbstractFileByPath(normalizePath(artifact.path));
  if (existing instanceof TFile) {
    await app.vault.modify(existing, artifact.content);
  } else {
    await app.vault.create(normalizePath(artifact.path), artifact.content);
  }

  return artifact.path;
}
