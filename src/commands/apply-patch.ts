// src/commands/apply-patch.ts
// Apply Vault Patch command.
//
// Default command flow:
//   1. Load patch file from settings.patchDefaultFile
//   2. Run dry-run pass — collect what would change
//   3. Show modal: summary of changes, errors, confirm/cancel
//   4. On confirm: apply patch, write operation manifest, write report
//   5. Show result notice
//   6. If settings.patchAutoLintAfterApply: trigger lint (Milestone 4)

import { App, FuzzySuggestModal, Modal, Notice, TFile, normalizePath } from "obsidian";
import { createPatchTemplateContent } from "../patching/template";
import type ForgePlugin from "../main";
import { getVaultPaths } from "../vault/paths";
import {
  loadPatchFile,
  applyPatch,
  PatchRunResult,
} from "../patching/engine";
import {
  writeRestoreManifest,
  archivePatchFile,
  writePatchReport,
} from "../patching/manifest";
import { runVaultLint } from "./run-lint";
import { ensureFolder } from "../utils/files";

// ── Entry point ───────────────────────────────────────────────────────────────

export async function runApplyPatch(
  plugin: ForgePlugin,
  patchFilePath?: string
): Promise<void> {
  const { app, settings } = plugin;
  const paths = getVaultPaths(settings);
  const patchPath = patchFilePath ?? paths.patchFile;

  // Load patch file. If the default patch note does not exist yet,
  // create a schema-valid template so the user has a real note to edit.
  const patchFile = await loadPatchFile(app, patchPath);

  if (!patchFile) {
    if (!patchFilePath && await createPatchTemplateIfMissing(app, patchPath)) {
      new Notice(
        `Forge: Created patch note at ${patchPath}. Add operations, then run Apply Vault Patch again.`,
        7000
      );
      return;
    }

    new Notice(
      `Forge: Patch file not found or has no YAML block at ${patchPath}`,
      7000
    );
    return;
  }

  if (patchFile.operations.length === 0) {
    new Notice("Forge: Patch file has no operations.", 4000);
    return;
  }

  // Dry run
  new Notice("Forge: Running dry pass…", 2000);
  const dryResult = await applyPatch(
    app,
    settings,
    patchFile,
    patchPath,
    true
  );

  // Show modal
  new PatchConfirmModal(app, plugin, patchFile.meta.description ?? "", dryResult, async () => {
    // Apply
    new Notice("Forge: Applying patch…", 2000);
    const applyResult = await applyPatch(
      app,
      settings,
      patchFile,
      patchPath,
      false
    );

    // Write manifest + report + archive
    await writeRestoreManifest(app, settings, applyResult);
    await archivePatchFile(app, settings, applyResult);
    const reportPath = await writePatchReport(app, settings, applyResult);
    await plugin.patchHistoryService.readHistory("patch-history");

    const changed = applyResult.results.filter((r) => r.status === "changed").length;
    const errors  = applyResult.results.filter((r) => r.status === "error").length;

    if (errors > 0) {
      new Notice(
        `Forge: Patch applied with ${errors} error(s). Changed: ${changed}. See report.`,
        7000
      );
    } else {
      new Notice(
        `Forge: Patch applied. ${changed} file(s) changed.`,
        5000
      );
    }

    // Open the report
    const reportFile = app.vault.getAbstractFileByPath(normalizePath(reportPath));
    if (reportFile) {
      void app.workspace.openLinkText(reportPath, "", false);
    }

    // Auto-lint after patch apply
    if (settings.patchAutoLintAfterApply) {
      await runVaultLint(plugin);
    } else {
      await plugin.recomposeHealthDashboard();
    }
  }).open();
}

export async function runApplyPatchFromPatchesFolder(plugin: ForgePlugin): Promise<void> {
  const paths = getVaultPaths(plugin.settings);
  const patchesFolder = `${normalizePath(paths.patches).toLowerCase()}/`;
  const excludedFolders = [
    paths.patchApplied,
    paths.patchBackups,
    paths.patchReports,
  ].map((path) => `${normalizePath(path).toLowerCase()}/`);

  const patchFiles = plugin.app.vault.getFiles()
    .filter((file) => {
      const path = normalizePath(file.path).toLowerCase();
      return (
        path.startsWith(patchesFolder) &&
        !excludedFolders.some((folder) => path.startsWith(folder)) &&
        path.endsWith(".md")
      );
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  if (patchFiles.length === 0) {
    new Notice(`Forge: No patch notes found in ${paths.patches}.`, 5000);
    return;
  }

  new PatchFileSuggestModal(plugin.app, patchFiles, (file) => {
    void runApplyPatch(plugin, file.path).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unexpected error";
      new Notice(`Forge: ${message}`, 6000);
      console.error("[Forge] apply-patch-from-patches-folder error:", error);
    });
  }).open();
}

class PatchFileSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private files: TFile[],
    private onChoose: (file: TFile) => void
  ) {
    super(app);
    this.setPlaceholder("Choose a patch from the patches folder...");
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}

async function createPatchTemplateIfMissing(
  app: App,
  patchPath: string
): Promise<boolean> {
  const normalizedPath = normalizePath(patchPath);
  const existing = app.vault.getAbstractFileByPath(normalizedPath);

  if (existing instanceof TFile) return false;

  const folder = normalizedPath.includes("/")
    ? normalizedPath.substring(0, normalizedPath.lastIndexOf("/"))
    : "";

  if (folder) await ensureFolder(app, folder);

  await app.vault.create(normalizedPath, createPatchTemplateContent());
  return true;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

class PatchConfirmModal extends Modal {
  private plugin: ForgePlugin;
  private description: string;
  private dryResult: PatchRunResult;
  private onConfirm: () => Promise<void>;

  constructor(
    app: App,
    plugin: ForgePlugin,
    description: string,
    dryResult: PatchRunResult,
    onConfirm: () => Promise<void>
  ) {
    super(app);
    this.plugin = plugin;
    this.description = description;
    this.dryResult = dryResult;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    const changed = this.dryResult.results.filter((r) => r.status === "changed");
    const skipped = this.dryResult.results.filter((r) => r.status === "skipped");
    const errors  = this.dryResult.results.filter((r) => r.status === "error");

    contentEl.createEl("h2", { text: "Apply vault patch" });

    if (this.description) {
      contentEl.createEl("p", {
        text: this.description,
        cls: "forge-patch-description",
      });
    }

    // Summary counts
    const summary = contentEl.createDiv("forge-patch-summary");

    const countEl = summary.createDiv("forge-patch-counts");
    countEl.createSpan({
      text: `${changed.length} changes`,
      cls: changed.length > 0 ? "forge-count-changed" : "forge-count-zero",
    });
    countEl.createSpan({ text: "  |  " });
    countEl.createSpan({
      text: `${skipped.length} skipped`,
      cls: "forge-count-skipped",
    });
    countEl.createSpan({ text: "  |  " });
    countEl.createSpan({
      text: `${errors.length} errors`,
      cls: errors.length > 0 ? "forge-count-error" : "forge-count-zero",
    });

    // Errors section — shown prominently
    if (errors.length > 0) {
      contentEl.createEl("h3", { text: "Errors" });
      const errorList = contentEl.createEl("ul", { cls: "forge-error-list" });
      for (const r of errors.slice(0, 10)) {
        errorList.createEl("li", { text: `[${r.op}] ${r.file} — ${r.detail}` });
      }
      if (errors.length > 10) {
        errorList.createEl("li", { text: `…and ${errors.length - 10} more` });
      }
      contentEl.createEl("p", {
        text: "Errors will not be applied. You can still proceed with the successful operations.",
        cls: "forge-error-note",
      });
    }

    // Changes preview
    if (changed.length > 0) {
      contentEl.createEl("h3", { text: "Changes" });
      const changeList = contentEl.createEl("ul", { cls: "forge-change-list" });
      for (const r of changed.slice(0, 20)) {
        changeList.createEl("li", { text: `${r.file} — ${r.detail}` });
      }
      if (changed.length > 20) {
        changeList.createEl("li", {
          text: `…and ${changed.length - 20} more`,
          cls: "forge-more",
        });
      }
    }

    if (changed.length === 0 && errors.length === 0) {
      contentEl.createEl("p", {
        text: "No changes needed — vault already matches the patch.",
        cls: "forge-no-changes",
      });
    }

    // Restore manifest notice
    if (this.plugin.settings.patchGenerateManifest && changed.length > 0) {
      contentEl.createEl("p", {
        text: "Operation-level restore data will be written for this patch run.",
        cls: "forge-backup-notice",
      });
    }

    // Buttons
    const buttonRow = contentEl.createDiv("forge-button-row");

    if (changed.length > 0) {
      const applyBtn = buttonRow.createEl("button", {
        text: "Apply",
        cls: "mod-cta",
      });
      applyBtn.addEventListener("click", () => {
        void (async () => {
          this.close();
          await this.onConfirm();
        })();
      });
    }

    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
