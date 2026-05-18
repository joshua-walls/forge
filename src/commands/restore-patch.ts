// src/commands/restore-patch.ts
// Restore Patch Run command.
//
// Reads all *-patch-manifest.json files from System/VaultForge/Patches/.
// Presents a list of past patch runs.
// On selection, restores each file from its .bak backup.

import { App, Modal, Notice, TFile } from "obsidian";
import type VaultForgePlugin from "../main";
import { getVaultPaths } from "../vault-paths";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ManifestChange {
  file: string;
  backup: string;
}

interface PatchManifest {
  run_id: string;
  patch_file: string;
  description: string;
  applied_at: string;
  schema_version: string;
  changes: ManifestChange[];
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function runRestorePatch(plugin: VaultForgePlugin): Promise<void> {
  const { app, settings } = plugin;
  const paths = getVaultPaths(settings);

  // Find all manifest files
  const manifestFiles = app.vault.getFiles().filter(
    (f) => f.path.startsWith(paths.patches) && f.name.endsWith("-patch-manifest.json")
  ).sort((a, b) => b.name.localeCompare(a.name)); // newest first

  if (manifestFiles.length === 0) {
    new Notice("Vault Forge: No patch manifests found. Apply a patch with backups enabled first.", 6000);
    return;
  }

  // Load manifests
  const manifests: PatchManifest[] = [];
  for (const file of manifestFiles) {
    try {
      const raw = await app.vault.read(file);
      manifests.push(JSON.parse(raw));
    } catch {
      // Skip unreadable manifests
    }
  }

  if (manifests.length === 0) {
    new Notice("Vault Forge: Could not read any patch manifests.", 5000);
    return;
  }

  new RestorePatchModal(app, plugin, manifests).open();
}

// ── Modal ─────────────────────────────────────────────────────────────────────

class RestorePatchModal extends Modal {
  private plugin: VaultForgePlugin;
  private manifests: PatchManifest[];
  private selected: PatchManifest | null = null;

  constructor(app: App, plugin: VaultForgePlugin, manifests: PatchManifest[]) {
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
      text: "Select a patch run to restore. All files changed by that patch will be replaced with their backups.",
      cls: "setting-item-description",
    });

    const list = contentEl.createDiv("vault-forge-restore-list");

    for (const manifest of this.manifests) {
      const item = list.createDiv("vault-forge-restore-item");
      item.addEventListener("click", () => {
        this.selected = manifest;
        this.renderConfirm();
      });

      const date = new Date(manifest.applied_at).toLocaleString();
      item.createEl("div", { text: manifest.description || manifest.run_id, cls: "vault-forge-restore-title" });
      item.createEl("div", { text: `${date} — ${manifest.changes.length} file(s)`, cls: "vault-forge-restore-meta" });
    }

    const closeBtn = contentEl.createEl("button", { text: "Cancel" });
    closeBtn.addEventListener("click", () => this.close());
  }

  private renderConfirm(): void {
    const { contentEl } = this;
    const manifest = this.selected!;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Confirm Restore" });
    contentEl.createEl("p", {
      text: manifest.description || manifest.run_id,
      cls: "vault-forge-patch-description",
    });
    contentEl.createEl("p", {
      text: `Applied: ${new Date(manifest.applied_at).toLocaleString()}`,
      cls: "setting-item-description",
    });

    contentEl.createEl("h3", { text: `${manifest.changes.length} file(s) will be restored` });

    const list = contentEl.createEl("ul", { cls: "vault-forge-change-list" });
    for (const change of manifest.changes.slice(0, 20)) {
      list.createEl("li", { text: change.file });
    }
    if (manifest.changes.length > 20) {
      list.createEl("li", { text: `…and ${manifest.changes.length - 20} more`, cls: "vault-forge-more" });
    }

    contentEl.createEl("p", {
      text: "This will overwrite the current versions of these files with their pre-patch backups. This cannot be undone.",
      cls: "vault-forge-error-note",
    });

    const buttonRow = contentEl.createDiv("vault-forge-button-row");

    const restoreBtn = buttonRow.createEl("button", { text: "Restore", cls: "mod-cta mod-warning" });
    restoreBtn.addEventListener("click", async () => {
      this.close();
      await this.applyRestore(manifest);
    });

    const backBtn = buttonRow.createEl("button", { text: "Back" });
    backBtn.addEventListener("click", () => this.renderList());

    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
  }

  private async applyRestore(manifest: PatchManifest): Promise<void> {
    const { app } = this;
    let restored = 0;
    let failed = 0;

    for (const change of manifest.changes) {
      const backupFile = app.vault.getAbstractFileByPath(change.backup);
      if (!(backupFile instanceof TFile)) {
        console.warn(`[VaultForge] Backup not found: ${change.backup}`);
        failed++;
        continue;
      }

      try {
        const backupContent = await app.vault.read(backupFile);
        const targetFile = app.vault.getAbstractFileByPath(change.file);

        if (targetFile instanceof TFile) {
          await app.vault.modify(targetFile, backupContent);
        } else {
          await app.vault.create(change.file, backupContent);
        }

        restored++;
      } catch (e) {
        console.warn(`[VaultForge] Could not restore ${change.file}:`, e);
        failed++;
      }
    }

    if (failed > 0) {
      new Notice(`Vault Forge: Restored ${restored} file(s). ${failed} backup(s) not found.`, 7000);
    } else {
      new Notice(`Vault Forge: Restored ${restored} file(s) from patch run.`, 5000);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
