// src/commands/utilities.ts
// Rename Dataview Folder command.
//
// Port of Rename-DataviewFolder.ps1.
// Replaces folder path references inside dataview code blocks only.
// Lines outside dataview blocks are never touched.
// Takes current and new folder path via a modal input form.

import { App, Modal, Notice, Setting, TFile } from "obsidian";
import type ForgePlugin from "../main";
import { getVaultPaths } from "../vault-paths";
import { getMarkdownFiles } from "../utils/files";

// ── Rename Dataview Folder ────────────────────────────────────────────────────

export async function runRenameDataviewFolder(plugin: ForgePlugin): Promise<void> {
  new RenameDataviewModal(plugin.app, plugin).open();
}

class RenameDataviewModal extends Modal {
  private plugin: ForgePlugin;
  private currentFolder = "";
  private newFolder = "";
  private scanScope = "";

  constructor(app: App, plugin: ForgePlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Rename dataview folder" });
    contentEl.createEl("p", {
      text: "Updates folder path references inside dataview blocks only. Lines outside dataview blocks are never touched.",
      cls: "setting-item-description",
    });

    new Setting(contentEl)
      .setName("Current folder path")
      .setDesc("The folder path currently referenced in dataview queries.")
      .addText((t) => {
        t.setPlaceholder("Work/skills");
        t.onChange((val) => { this.currentFolder = val.trim().replace(/^["']+|["']+$/g, "").replace(/\/+$/, ""); });
      });

    new Setting(contentEl)
      .setName("New folder path")
      .setDesc("The replacement folder path.")
      .addText((t) => {
        t.setPlaceholder("Work/disciplines");
        t.onChange((val) => { this.newFolder = val.trim().replace(/^["']+|["']+$/g, "").replace(/\/+$/, ""); });
      });

    new Setting(contentEl)
      .setName("Scope (optional)")
      .setDesc("Limit scanning to a subfolder. Leave empty to scan the entire vault.")
      .addText((t) => {
        t.setPlaceholder("Work");
        t.onChange((val) => { this.scanScope = val.trim(); });
      });

    const buttonRow = contentEl.createDiv("forge-button-row");

    const previewBtn = buttonRow.createEl("button", { text: "Preview", cls: "mod-cta" });
    previewBtn.addEventListener("click", () => {
      void (async () => {
        if (!this.currentFolder || !this.newFolder) {
          new Notice("Forge: Both folder paths are required.", 3000);
          return;
        }
        if (this.currentFolder === this.newFolder) {
          new Notice("Forge: Current and new folder paths are the same.", 3000);
          return;
        }
        this.close();
        await this.runRename(true);
      })();
    });

    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
  }

  private async runRename(dryRun: boolean): Promise<void> {
    const { app, plugin } = this;
    const paths = getVaultPaths(plugin.settings);

    const files = getMarkdownFiles(
      app,
      this.scanScope || undefined
    ).filter((f) => !f.path.startsWith(paths.forge));

    const candidates: { file: TFile; updated: string }[] = [];

    for (const file of files) {
      const content = await app.vault.read(file);

      // Quick pre-check
      if (!/(?:```|~~~)dataview/.test(content)) continue;

      const updated = updateDataviewFolderRefs(content, this.currentFolder, this.newFolder);
      if (updated !== content) {
        candidates.push({ file, updated });
      }
    }

    if (candidates.length === 0) {
      new Notice(
        `Forge: No dataview references to "${this.currentFolder}" found.`,
        4000
      );
      return;
    }

    new DataviewRenameConfirmModal(
      app,
      plugin,
      this.currentFolder,
      this.newFolder,
      candidates
    ).open();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function updateDataviewFolderRefs(
  content: string,
  current: string,
  newFolder: string
): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inDataview = false;

  for (const line of lines) {
    const trimmed = line.trimEnd();

    if (/^(?:```|~~~)dataview\s*$/.test(trimmed)) {
      inDataview = true;
      result.push(line);
      continue;
    }

    if (inDataview && /^(?:```|~~~)\s*$/.test(trimmed)) {
      inDataview = false;
      result.push(line);
      continue;
    }

    if (inDataview) {
      result.push(line.split(current).join(newFolder));
    } else {
      result.push(line);
    }
  }

  return result.join("\n");
}

class DataviewRenameConfirmModal extends Modal {
  private plugin: ForgePlugin;
  private currentFolder: string;
  private newFolder: string;
  private candidates: { file: TFile; updated: string }[];

  constructor(
    app: App,
    plugin: ForgePlugin,
    currentFolder: string,
    newFolder: string,
    candidates: { file: TFile; updated: string }[]
  ) {
    super(app);
    this.plugin = plugin;
    this.currentFolder = currentFolder;
    this.newFolder = newFolder;
    this.candidates = candidates;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Rename dataview folder — confirm" });
    contentEl.createEl("p", {
      text: `"${this.currentFolder}" → "${this.newFolder}"`,
      cls: "forge-patch-description",
    });
    contentEl.createEl("p", {
      text: `${this.candidates.length} file(s) will be updated.`,
    });

    const list = contentEl.createEl("ul", { cls: "forge-change-list" });
    for (const { file } of this.candidates.slice(0, 20)) {
      list.createEl("li", { text: file.path });
    }
    if (this.candidates.length > 20) {
      list.createEl("li", {
        text: `…and ${this.candidates.length - 20} more`,
        cls: "forge-more",
      });
    }

    if (this.plugin.settings.patchBackupEnabled) {
      contentEl.createEl("p", {
        text: "Backups will be written to system/forge/patches/backups/",
        cls: "forge-backup-notice",
      });
    }

    const buttonRow = contentEl.createDiv("forge-button-row");

    const applyBtn = buttonRow.createEl("button", { text: "Apply", cls: "mod-cta" });
    applyBtn.addEventListener("click", () => {
      void (async () => {
        this.close();

        const paths = getVaultPaths(this.plugin.settings);
        let changed = 0;

        for (const { file, updated } of this.candidates) {
          if (this.plugin.settings.patchBackupEnabled) {
            const { backupNote } = await import("../utils/frontmatter");
            await backupNote(this.app, file, paths.patchBackups);
          }
          await this.app.vault.modify(file, updated);
          changed++;
        }

        new Notice(
          `Forge: Updated dataview references in ${changed} file(s).`,
          4000
        );
      })();
    });

    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
