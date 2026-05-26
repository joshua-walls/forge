// src/commands/restore-patch.ts
// Restore Patch Run command.
//
// Reads all *-patch-manifest.json files from System/Forge/Patches/Reports/.
// Presents a list of past patch runs.
// On selection, restores each file from its .bak backup.

import { App, Modal, Notice, TFile, normalizePath } from "obsidian";
import type ForgePlugin from "../main";
import { getVaultPaths } from "../vault-paths";
import { ensureFolder } from "../utils/files";

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

export async function runRestorePatch(plugin: ForgePlugin): Promise<void> {
  const { app, settings } = plugin;
  const paths = getVaultPaths(settings);

  // Find all manifest files. Current manifests live in Reports; legacy
  // manifests may live directly in the patch folder.
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
  }).sort((a, b) => b.name.localeCompare(a.name)); // newest first

  if (manifestFiles.length === 0) {
    new Notice("Forge: No patch manifests found. Apply a patch with backups enabled first.", 6000);
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
      text: "Select a patch run to restore. All files changed by that patch will be replaced with their backups.",
      cls: "setting-item-description",
    });

    const list = contentEl.createDiv("forge-restore-list");

    for (const manifest of this.manifests) {
      const item = list.createDiv("forge-restore-item");
      item.addEventListener("click", () => {
        this.selected = manifest;
        this.renderConfirm();
      });

      const date = new Date(manifest.applied_at).toLocaleString();
      item.createEl("div", { text: manifest.description || manifest.run_id, cls: "forge-restore-title" });
      item.createEl("div", { text: `${date} — ${manifest.changes.length} file(s)`, cls: "forge-restore-meta" });
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
      cls: "forge-patch-description",
    });
    contentEl.createEl("p", {
      text: `Applied: ${new Date(manifest.applied_at).toLocaleString()}`,
      cls: "setting-item-description",
    });

    contentEl.createEl("h3", { text: `${manifest.changes.length} file(s) will be restored` });

    const list = contentEl.createEl("ul", { cls: "forge-change-list" });
    for (const change of manifest.changes.slice(0, 20)) {
      list.createEl("li", { text: change.file });
    }
    if (manifest.changes.length > 20) {
      list.createEl("li", { text: `…and ${manifest.changes.length - 20} more`, cls: "forge-more" });
    }

    contentEl.createEl("p", {
      text: "This will overwrite the current versions of these files with their pre-patch backups. This cannot be undone.",
      cls: "forge-error-note",
    });

    const buttonRow = contentEl.createDiv("forge-button-row");

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

    if (failed > 0) {
      new Notice(`Forge: Restored ${restored} file(s). ${failed} backup(s) not found.`, 7000);
    } else {
      new Notice(`Forge: Restored ${restored} file(s) from patch run.`, 5000);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
