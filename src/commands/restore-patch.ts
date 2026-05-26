// src/commands/restore-patch.ts
// Restore Patch Run command.
//
// Forge 1.2 manifests restore individual operations when possible. Legacy
// manifests still fall back to full-file .bak replacement with a clear warning.

import { App, Modal, Notice, TFile, normalizePath, parseYaml } from "obsidian";
import type ForgePlugin from "../main";
import { getVaultPaths } from "../vault-paths";
import { ensureFolder, localTimestamp, todayString } from "../utils/files";
import { readNote, writeNote, parseNote } from "../utils/frontmatter";
import { getTags, setTags, normalizeTags, addTag, removeTag, replaceTag } from "../utils/tags";
import type {
  PatchFile,
  PatchOperationChange,
  PatchRestoreValue,
} from "../patch-engine";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ManifestChange {
  file: string;
  backup: string;
}

interface PatchManifest {
  manifest_version?: number;
  run_id: string;
  patch_file: string;
  description: string;
  applied_at: string;
  schema_version: string;
  changes: ManifestChange[];
  operations?: PatchOperationChange[];
}

type RestoreStatus =
  | "reversible"
  | "conflicted"
  | "missing_target"
  | "unsupported"
  | "already_restored"
  | "error";

interface RestoreCandidate {
  operation: PatchOperationChange;
  status: RestoreStatus;
  reason: string;
  selected: boolean;
}

interface RestoreApplyResult {
  operation: PatchOperationChange;
  status: "restored" | "skipped" | "conflicted" | "error";
  detail: string;
}

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
      manifests.push(JSON.parse(raw));
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

    contentEl.createEl("h2", { text: "Restore Patch Run" });
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
      item.addEventListener("click", async () => {
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

    contentEl.createEl("h2", { text: "Restore Patch Operations" });
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
    restoreBtn.addEventListener("click", async () => {
      const selected = this.candidates.filter((c) => c.selected);
      this.close();
      await this.applyOperationRestore(manifest, selected);
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

    contentEl.createEl("h2", { text: "Confirm Legacy Restore" });
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
    restoreBtn.addEventListener("click", async () => {
      this.close();
      await this.applyLegacyRestore(manifest);
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
    const results: RestoreApplyResult[] = [];

    for (const candidate of selected) {
      const fresh = await evaluateRestoreOperation(this.app, candidate.operation);
      if (fresh.status !== "reversible") {
        results.push({
          operation: candidate.operation,
          status: fresh.status === "conflicted" ? "conflicted" : "skipped",
          detail: fresh.reason,
        });
        continue;
      }

      results.push(await applyReverseOperation(
        this.app,
        this.plugin.settings.frontmatterFieldOrder,
        candidate.operation
      ));
    }

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
    this.app.workspace.openLinkText(reportPath, "", false);
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

    await writeRestoreReport(this.app, this.plugin, manifest, results, true);
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
  const operations = manifest.operations ?? [];
  const candidates: RestoreCandidate[] = [];

  for (const operation of operations) {
    const evaluated = await evaluateRestoreOperation(app, operation);
    candidates.push({
      operation,
      status: evaluated.status,
      reason: evaluated.reason,
      selected: evaluated.status === "reversible",
    });
  }

  return candidates;
}

async function synthesizeLegacyOperationCandidates(
  app: App,
  plugin: ForgePlugin,
  manifest: PatchManifest
): Promise<RestoreCandidate[]> {
  const patchFile = await loadArchivedPatchFile(app, plugin, manifest);
  if (!patchFile || patchFile.operations.length === 0) return [];

  const byFile = new Map<string, ManifestChange>();
  for (const change of manifest.changes ?? []) {
    byFile.set(normalizePath(change.file), change);
  }

  const candidates: RestoreCandidate[] = [];
  let seq = 0;

  for (let opIndex = 0; opIndex < patchFile.operations.length; opIndex++) {
    const op = patchFile.operations[opIndex];
    const target = op.target ? normalizePath(op.target) : null;
    if (!target) continue;

    const manifestChange = byFile.get(target);
    if (!manifestChange) continue;

    const file = app.vault.getAbstractFileByPath(target);
    if (!(file instanceof TFile)) continue;

    const backupPath = normalizePath(manifestChange.backup);
    if (!(await app.vault.adapter.exists(backupPath))) continue;

    const backupRaw = await app.vault.adapter.read(backupPath);
    const beforeNote = parseNote(backupRaw, file);
    const currentNote = await readNote(app, file);
    if (!currentNote) continue;

    const change = synthesizeLegacyOperationChange(
      op,
      manifestChange,
      file,
      beforeNote.frontmatter,
      ++seq,
      opIndex
    );

    if (!change) continue;

    const evaluated = await evaluateRestoreOperation(app, change);
    candidates.push({
      operation: change,
      status: evaluated.status,
      reason: `Reconstructed from legacy manifest: ${evaluated.reason}`,
      selected: evaluated.status === "reversible",
    });
  }

  return candidates;
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
      const yaml = extractPatchYaml(raw, path);
      if (!yaml.trim()) continue;
      const parsed = parseYaml(yaml) as Record<string, unknown>;
      return {
        meta: (parsed?.meta ?? {}) as PatchFile["meta"],
        operations: Array.isArray(parsed?.operations)
          ? (parsed.operations as PatchFile["operations"])
          : [],
      };
    } catch {
      continue;
    }
  }

  return null;
}

function synthesizeLegacyOperationChange(
  op: PatchFile["operations"][number],
  manifestChange: ManifestChange,
  file: TFile,
  beforeFm: Record<string, unknown>,
  seq: number,
  opIndex: number
): PatchOperationChange | null {
  const id = `legacy-op-${String(seq).padStart(5, "0")}`;
  const normalizedFile = normalizePath(file.path);
  const backup = manifestChange.backup;

  switch (op.op) {
    case "set_field": {
      if (!op.field) return null;
      if (!Object.prototype.hasOwnProperty.call(op, "value") || op.value === undefined) return null;
      const before = valueFromFrontmatter(beforeFm, op.field);
      const after: PatchRestoreValue = { exists: true, value: op.value };
      return {
        id,
        op_index: opIndex,
        op: op.op,
        file_before: normalizedFile,
        file_after: normalizedFile,
        status: "changed",
        label: `${op.op} ${op.field}`,
        target: { kind: "frontmatter_field", field: op.field },
        before,
        after,
        reverse: {
          kind: "set_field",
          field: op.field,
          value: before.exists ? before.value : undefined,
          delete_if_missing_before: !before.exists,
        },
        backup,
      };
    }
    case "remove_field": {
      if (!op.field) return null;
      const before = valueFromFrontmatter(beforeFm, op.field);
      return {
        id,
        op_index: opIndex,
        op: op.op,
        file_before: normalizedFile,
        file_after: normalizedFile,
        status: "changed",
        label: `${op.op} ${op.field}`,
        target: { kind: "frontmatter_field", field: op.field },
        before,
        after: { exists: false },
        reverse: {
          kind: "set_field",
          field: op.field,
          value: before.exists ? before.value : undefined,
          delete_if_missing_before: !before.exists,
        },
        backup,
      };
    }
    case "add_tag":
    case "remove_tag":
    case "replace_tag":
    case "normalize_tags": {
      const beforeTags = normalizeTags(getTags(beforeFm));
      const afterTags = synthesizeLegacyTagsAfter(op, beforeTags);
      if (!afterTags) return null;
      return {
        id,
        op_index: opIndex,
        op: op.op,
        file_before: normalizedFile,
        file_after: normalizedFile,
        status: "changed",
        label: op.op,
        target: { kind: "frontmatter_tags" },
        before: { exists: true, value: beforeTags },
        after: { exists: true, value: afterTags },
        reverse: { kind: "set_tags", value: beforeTags },
        backup,
      };
    }
    default:
      return null;
  }
}

function synthesizeLegacyTagsAfter(
  op: PatchFile["operations"][number],
  beforeTags: string[]
): string[] | null {
  switch (op.op) {
    case "add_tag":
      return op.tag ? normalizeTags(addTag(beforeTags, op.tag)) : null;
    case "remove_tag":
      return op.tag ? normalizeTags(removeTag(beforeTags, op.tag)) : null;
    case "replace_tag":
      return op.old_tag && op.new_tag
        ? normalizeTags(replaceTag(beforeTags, op.old_tag, op.new_tag))
        : null;
    case "normalize_tags":
      return normalizeTags(beforeTags);
    default:
      return null;
  }
}

async function evaluateRestoreOperation(
  app: App,
  operation: PatchOperationChange
): Promise<{ status: RestoreStatus; reason: string }> {
  try {
    switch (operation.target.kind) {
      case "frontmatter_field": {
        const file = app.vault.getAbstractFileByPath(normalizePath(operation.file_after));
        if (!(file instanceof TFile)) return { status: "missing_target", reason: "Current file is missing" };

        const note = await readNote(app, file);
        if (!note) return { status: "error", reason: "Could not read current file" };

        const current = restoreValue(note.frontmatter[operation.target.field]);
        return compareCurrentToManifest(current, operation.before, operation.after);
      }
      case "frontmatter_tags": {
        const file = app.vault.getAbstractFileByPath(normalizePath(operation.file_after));
        if (!(file instanceof TFile)) return { status: "missing_target", reason: "Current file is missing" };

        const note = await readNote(app, file);
        if (!note) return { status: "error", reason: "Could not read current file" };

        const current = restoreValue(normalizeTags(getTags(note.frontmatter)));
        return compareCurrentToManifest(current, normalizeManifestArray(operation.before), normalizeManifestArray(operation.after));
      }
      case "frontmatter_order": {
        const file = app.vault.getAbstractFileByPath(normalizePath(operation.file_after));
        if (!(file instanceof TFile)) return { status: "missing_target", reason: "Current file is missing" };

        const note = await readNote(app, file);
        if (!note) return { status: "error", reason: "Could not read current file" };

        const current = restoreValue(Object.keys(note.frontmatter));
        return compareCurrentToManifest(current, operation.before, operation.after);
      }
      case "note_move": {
        const currentFile = app.vault.getAbstractFileByPath(normalizePath(operation.file_after));
        const originalPath = app.vault.getAbstractFileByPath(normalizePath(operation.file_before));
        if (currentFile instanceof TFile && !originalPath) {
          return { status: "reversible", reason: "Ready to move note back" };
        }
        if (!currentFile && originalPath instanceof TFile) {
          return { status: "already_restored", reason: "Note is already back at its original path" };
        }
        if (!currentFile) return { status: "missing_target", reason: "Moved note is missing" };
        return { status: "conflicted", reason: "Original path is occupied" };
      }
      default:
        return { status: "unsupported", reason: "Operation target is unsupported" };
    }
  } catch (e) {
    return { status: "error", reason: String(e) };
  }
}

async function applyReverseOperation(
  app: App,
  fieldOrder: string[],
  operation: PatchOperationChange
): Promise<RestoreApplyResult> {
  try {
    switch (operation.reverse.kind) {
      case "set_field": {
        const file = app.vault.getAbstractFileByPath(normalizePath(operation.file_after));
        if (!(file instanceof TFile)) return result(operation, "error", "Current file is missing");
        const note = await readNote(app, file);
        if (!note) return result(operation, "error", "Could not read current file");

        if (operation.reverse.delete_if_missing_before) {
          delete note.frontmatter[operation.reverse.field];
        } else {
          note.frontmatter[operation.reverse.field] = operation.reverse.value;
        }
        await writeNote(app, note, fieldOrder);
        return result(operation, "restored", "Field restored");
      }
      case "set_tags": {
        const file = app.vault.getAbstractFileByPath(normalizePath(operation.file_after));
        if (!(file instanceof TFile)) return result(operation, "error", "Current file is missing");
        const note = await readNote(app, file);
        if (!note) return result(operation, "error", "Could not read current file");

        setTags(note.frontmatter, operation.reverse.value);
        await writeNote(app, note, fieldOrder);
        return result(operation, "restored", "Tags restored");
      }
      case "set_frontmatter_order": {
        const file = app.vault.getAbstractFileByPath(normalizePath(operation.file_after));
        if (!(file instanceof TFile)) return result(operation, "error", "Current file is missing");
        const note = await readNote(app, file);
        if (!note) return result(operation, "error", "Could not read current file");

        await writeNote(app, note, operation.reverse.keys);
        return result(operation, "restored", "Frontmatter order restored");
      }
      case "move_note": {
        const from = normalizePath(operation.reverse.from);
        const to = normalizePath(operation.reverse.to);
        const file = app.vault.getAbstractFileByPath(from);
        if (!(file instanceof TFile)) return result(operation, "error", "Moved note is missing");
        if (app.vault.getAbstractFileByPath(to)) return result(operation, "conflicted", "Original path is occupied");

        const folder = to.includes("/") ? to.substring(0, to.lastIndexOf("/")) : "";
        if (folder) await ensureFolder(app, folder);
        await app.vault.rename(file, to);
        return result(operation, "restored", "Note moved back");
      }
    }
  } catch (e) {
    return result(operation, "error", String(e));
  }
}

function compareCurrentToManifest(
  current: PatchRestoreValue,
  before: PatchRestoreValue,
  after: PatchRestoreValue
): { status: RestoreStatus; reason: string } {
  if (sameRestoreValue(current, after)) {
    return { status: "reversible", reason: "Current value still matches patch output" };
  }
  if (sameRestoreValue(current, before)) {
    return { status: "already_restored", reason: "Value already matches pre-patch state" };
  }
  return { status: "conflicted", reason: "Current value changed after patch apply" };
}

function result(
  operation: PatchOperationChange,
  status: RestoreApplyResult["status"],
  detail: string
): RestoreApplyResult {
  return { operation, status, detail };
}

function valueFromFrontmatter(
  frontmatter: Record<string, unknown>,
  field: string
): PatchRestoreValue {
  return Object.prototype.hasOwnProperty.call(frontmatter, field)
    ? { exists: true, value: frontmatter[field] }
    : { exists: false };
}

function restoreValue(value: unknown): PatchRestoreValue {
  return value === undefined ? { exists: false } : { exists: true, value };
}

function normalizeManifestArray(value: PatchRestoreValue): PatchRestoreValue {
  if (!value.exists || !Array.isArray(value.value)) return value;
  return { exists: true, value: normalizeTags(value.value.map((v) => String(v))) };
}

function sameRestoreValue(a: PatchRestoreValue, b: PatchRestoreValue): boolean {
  if (a.exists !== b.exists) return false;
  if (!a.exists && !b.exists) return true;
  if (!a.exists || !b.exists) return false;
  return stableStringify(a.value) === stableStringify(b.value);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function describeRestoreValue(value: PatchRestoreValue): string {
  if (!value.exists) return "<missing>";
  if (Array.isArray(value.value)) return `[${value.value.join(", ")}]`;
  if (typeof value.value === "string") return value.value;
  return JSON.stringify(value.value);
}

function extractPatchYaml(raw: string, patchFilePath: string): string {
  if (!patchFilePath.toLowerCase().endsWith(".md")) return raw;
  const match = raw.match(/```ya?ml\s*\r?\n([\s\S]*?)```/i);
  return match?.[1]?.trim() ?? "";
}

async function writeRestoreReport(
  app: App,
  plugin: ForgePlugin,
  manifest: PatchManifest,
  results: RestoreApplyResult[],
  legacy: boolean
): Promise<string> {
  const paths = getVaultPaths(plugin.settings);
  await ensureFolder(app, paths.patchReports);

  const reportPath = normalizePath(
    `${paths.patchReports}/${manifest.run_id}-patch-report-restore.md`
  );
  const today = todayString();
  const restored = results.filter((r) => r.status === "restored");
  const conflicted = results.filter((r) => r.status === "conflicted");
  const skipped = results.filter((r) => r.status === "skipped");
  const errors = results.filter((r) => r.status === "error");

  const lines = [
    "---",
    "type: reference",
    "status: active",
    "tags:",
    "  - meta/patch-report",
    `created: ${today}`,
    `updated: ${today}`,
    "ai_private: false",
    "review_cycle: never",
    "---",
    "",
    `source:: ${manifest.patch_file}`,
    "patch_mode:: restore",
    `source_patch_run:: ${manifest.run_id}`,
    `restore_legacy:: ${legacy}`,
    `restored_count:: ${restored.length}`,
    `conflicted_count:: ${conflicted.length}`,
    `skipped_count:: ${skipped.length}`,
    `error_count:: ${errors.length}`,
    "",
    "# Patch Restore Report",
    "",
    "## Summary",
    "",
    `- Source run: ${manifest.run_id}`,
    `- Description: ${manifest.description || ""}`,
    `- Restored at: ${localTimestamp()}`,
    `- Legacy full-file restore: ${legacy ? "yes" : "no"}`,
    `- Restored: ${restored.length}`,
    `- Conflicted: ${conflicted.length}`,
    `- Skipped: ${skipped.length}`,
    `- Errors: ${errors.length}`,
    "",
  ];

  if (legacy) {
    lines.push("## Legacy Restore", "");
    lines.push("This restore used full-file backup replacement because the manifest did not contain operation-level restore data.", "");
  }

  for (const [heading, items] of [
    ["Restored", restored],
    ["Conflicted", conflicted],
    ["Skipped", skipped],
    ["Errors", errors],
  ] as const) {
    if (items.length === 0) continue;
    lines.push(`## ${heading}`, "");
    for (const item of items) {
      lines.push(`- \`[${item.operation.op}]\` \`${item.operation.file_after}\` - ${item.detail}`);
    }
    lines.push("");
  }

  const existing = app.vault.getAbstractFileByPath(reportPath);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, lines.join("\n"));
  } else {
    await app.vault.create(reportPath, lines.join("\n"));
  }

  return reportPath;
}
