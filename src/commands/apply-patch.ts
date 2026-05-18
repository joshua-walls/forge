// src/commands/apply-patch.ts
// Apply Vault Patch command.
//
// Flow:
//   1. Load patch file from settings.patchDefaultFile
//   2. Run dry-run pass — collect what would change
//   3. Show modal: summary of changes, errors, confirm/cancel
//   4. On confirm: apply patch, write backups, write manifest, write report
//   5. Show result notice
//   6. If settings.patchAutoLintAfterApply: trigger lint (Milestone 4)

import { App, Modal, Notice, Setting, TFile, normalizePath } from "obsidian";
import type VaultForgePlugin from "../main";
import { getVaultPaths } from "../vault-paths";
import {
  loadPatchFile,
  applyPatch,
  PatchRunResult,
  PatchOpResult,
} from "../patch-engine";
import {
  writeRestoreManifest,
  archivePatchFile,
  writePatchReport,
} from "../patch-manifest";
import { runVaultLint } from "./run-lint";
import { ensureFolder, todayString } from "../utils/files";

// ── Entry point ───────────────────────────────────────────────────────────────

export async function runApplyPatch(plugin: VaultForgePlugin): Promise<void> {
  const { app, settings } = plugin;
  const paths = getVaultPaths(settings);

  // Load patch file. If the default patch note does not exist yet,
  // create a schema-valid template so the user has a real note to edit.
  let patchFile = await loadPatchFile(app, paths.patchFile);

  if (!patchFile) {
    const created = await createPatchTemplateIfMissing(app, paths.patchFile);

    if (created) {
      new Notice(
        `Vault Forge: Created patch note at ${paths.patchFile}. Add operations, then run Apply Vault Patch again.`,
        7000
      );
      return;
    }

    new Notice(
      `Vault Forge: Patch file not found or has no YAML block at ${paths.patchFile}`,
      7000
    );
    return;
  }

  if (patchFile.operations.length === 0) {
    new Notice("Vault Forge: Patch file has no operations.", 4000);
    return;
  }

  // Dry run
  new Notice("Vault Forge: Running dry pass…", 2000);
  const dryResult = await applyPatch(
    app,
    settings,
    patchFile,
    paths.patchFile,
    true
  );

  // Show modal
  new PatchConfirmModal(app, plugin, patchFile.meta.description ?? "", dryResult, async () => {
    // Apply
    new Notice("Vault Forge: Applying patch…", 2000);
    const applyResult = await applyPatch(
      app,
      settings,
      patchFile,
      paths.patchFile,
      false
    );

    // Write manifest + report + archive
    await writeRestoreManifest(app, settings, applyResult);
    await archivePatchFile(app, settings, applyResult);
    const reportPath = await writePatchReport(app, settings, applyResult);

    const changed = applyResult.results.filter((r) => r.status === "changed").length;
    const errors  = applyResult.results.filter((r) => r.status === "error").length;

    if (errors > 0) {
      new Notice(
        `Vault Forge: Patch applied with ${errors} error(s). Changed: ${changed}. See report.`,
        7000
      );
    } else {
      new Notice(
        `Vault Forge: Patch applied. ${changed} file(s) changed.`,
        5000
      );
    }

    // Open the report
    const reportFile = app.vault.getAbstractFileByPath(normalizePath(reportPath));
    if (reportFile) {
      app.workspace.openLinkText(reportPath, "", false);
    }

    // Auto-lint after patch apply
    if (settings.patchAutoLintAfterApply) {
      await runVaultLint(plugin);
    }
  }).open();
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

  const today = todayString();
  const content = [
    "---",
    "type: procedure",
    "status: draft",
    "tags:",
    "  - tool/vault-forge",
    `created: ${today}`,
    `updated: ${today}`,
    "ai_private: false",
    "review_cycle: never",
    "---",
    "",
    "# Vault Patch",
    "",
    "Patch file for Vault Forge.",
    "",
    "## Patch",
    "",
    "```yaml",
    "meta:",
    "  description: Manual vault patch",
    "",
    "operations: []",
    "```",
    "",
  ].join("\n");

  await app.vault.create(normalizedPath, content);
  return true;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

class PatchConfirmModal extends Modal {
  private plugin: VaultForgePlugin;
  private description: string;
  private dryResult: PatchRunResult;
  private onConfirm: () => Promise<void>;

  constructor(
    app: App,
    plugin: VaultForgePlugin,
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

    contentEl.createEl("h2", { text: "Apply Vault Patch" });

    if (this.description) {
      contentEl.createEl("p", {
        text: this.description,
        cls: "vault-forge-patch-description",
      });
    }

    // Summary counts
    const summary = contentEl.createDiv("vault-forge-patch-summary");

    const countEl = summary.createDiv("vault-forge-patch-counts");
    countEl.createSpan({
      text: `${changed.length} changes`,
      cls: changed.length > 0 ? "vault-forge-count-changed" : "vault-forge-count-zero",
    });
    countEl.createSpan({ text: "  |  " });
    countEl.createSpan({
      text: `${skipped.length} skipped`,
      cls: "vault-forge-count-skipped",
    });
    countEl.createSpan({ text: "  |  " });
    countEl.createSpan({
      text: `${errors.length} errors`,
      cls: errors.length > 0 ? "vault-forge-count-error" : "vault-forge-count-zero",
    });

    // Errors section — shown prominently
    if (errors.length > 0) {
      contentEl.createEl("h3", { text: "Errors" });
      const errorList = contentEl.createEl("ul", { cls: "vault-forge-error-list" });
      for (const r of errors.slice(0, 10)) {
        errorList.createEl("li", { text: `[${r.op}] ${r.file} — ${r.detail}` });
      }
      if (errors.length > 10) {
        errorList.createEl("li", { text: `…and ${errors.length - 10} more` });
      }
      contentEl.createEl("p", {
        text: "Errors will not be applied. You can still proceed with the successful operations.",
        cls: "vault-forge-error-note",
      });
    }

    // Changes preview
    if (changed.length > 0) {
      contentEl.createEl("h3", { text: "Changes" });
      const changeList = contentEl.createEl("ul", { cls: "vault-forge-change-list" });
      for (const r of changed.slice(0, 20)) {
        changeList.createEl("li", { text: `${r.file} — ${r.detail}` });
      }
      if (changed.length > 20) {
        changeList.createEl("li", {
          text: `…and ${changed.length - 20} more`,
          cls: "vault-forge-more",
        });
      }
    }

    if (changed.length === 0 && errors.length === 0) {
      contentEl.createEl("p", {
        text: "No changes needed — vault already matches the patch.",
        cls: "vault-forge-no-changes",
      });
    }

    // Backup notice
    if (this.plugin.settings.patchBackupEnabled && changed.length > 0) {
      contentEl.createEl("p", {
        text: `Backups will be written to System/VaultForge/Patches/Backups/`,
        cls: "vault-forge-backup-notice",
      });
    }

    // Buttons
    const buttonRow = contentEl.createDiv("vault-forge-button-row");

    if (changed.length > 0) {
      const applyBtn = buttonRow.createEl("button", {
        text: "Apply",
        cls: "mod-cta",
      });
      applyBtn.addEventListener("click", async () => {
        this.close();
        await this.onConfirm();
      });
    }

    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
