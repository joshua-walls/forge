// src/settings-tab.ts
// Settings UI for Vault Forge.
// Renders in Obsidian's Settings → Vault Forge panel.

import {
  App,
  FuzzySuggestModal,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
  TFolder,
} from "obsidian";
import type VaultForgePlugin from "./main";
import { installVaultForgeDocumentation } from "./docs";

export class VaultForgeSettingsTab extends PluginSettingTab {
  plugin: VaultForgePlugin;

  constructor(app: App, plugin: VaultForgePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ── Documentation ──────────────────────────────────────────────
    new Setting(containerEl)
      .setName("Install Documentation")
      .setDesc(
        "Writes vault-native docs into your Vault Forge folder — command reference, schema guide, patch examples, and troubleshooting. Skips notes that already exist."
      )
      .addButton((btn) => {
        btn
          .setButtonText("Install Docs")
          .setCta()
          .onClick(async () => {
            await installVaultForgeDocumentation(this.plugin.app, this.plugin.settings);
          });
      });

    // ── System Paths ────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "System Paths" });
    containerEl.createEl("p", {
      text: "All paths are relative to your vault root.",
      cls: "setting-item-description",
    });

    this.renderFolderPathSetting(
      containerEl,
      "System folder",
      "Root folder for all vault system files.",
      "systemFolder",
      "System"
    );

    this.renderFolderPathSetting(
      containerEl,
      "Vault Forge folder",
      "Folder for Vault Forge configuration and patch archives.",
      "vaultForgeFolder",
      "System/VaultForge"
    );

    this.renderSchemaNoteSetting(containerEl);

    this.renderFolderPathSetting(
      containerEl,
      "Exports folder",
      "Folder where inventory, lint reports, and indexes are written.",
      "exportsFolder",
      "System/Exports"
    );

    this.renderFolderPathSetting(
      containerEl,
      "Patches folder",
      "Folder where applied patch files are archived.",
      "patchesFolder",
      "System/VaultForge/Patches"
    );

    this.renderFolderPathSetting(
      containerEl,
      "Inbox folder",
      "Folder for draft notes awaiting import.",
      "inboxFolder",
      "System/Inbox"
    );

    this.renderFolderPathSetting(
      containerEl,
      "Patterns folder",
      "Folder containing pattern notes for lint validation.",
      "patternsFolder",
      "System/Patterns"
    );

    // ── Patch ────────────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Patch" });

    this.renderPatchFileSetting(containerEl);

    new Setting(containerEl)
      .setName("Backup before patch")
      .setDesc(
        "Create a backup of each modified file before applying a patch. Backups are stored in System/VaultForge/Patches/Backups/."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.patchBackupEnabled)
          .onChange(async (value) => {
            this.plugin.settings.patchBackupEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Generate restore manifest")
      .setDesc(
        "Write a manifest file alongside each patch run so you can restore a full patch run in one step. Only active when backups are enabled."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.patchGenerateManifest)
          .onChange(async (value) => {
            this.plugin.settings.patchGenerateManifest = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Run lint after patch")
      .setDesc("Automatically run Vault Lint after a patch is applied.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.patchAutoLintAfterApply)
          .onChange(async (value) => {
            this.plugin.settings.patchAutoLintAfterApply = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Run maintenance after patch")
      .setDesc("Automatically run Vault Maintenance after a patch is applied.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.patchAutoMaintenanceAfterApply)
          .onChange(async (value) => {
            this.plugin.settings.patchAutoMaintenanceAfterApply = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Lint ─────────────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Lint" });

    new Setting(containerEl)
      .setName("Strict mode")
      .setDesc("Treat warnings as errors.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.lintStrictMode)
          .onChange(async (value) => {
            this.plugin.settings.lintStrictMode = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Lint run retention")
      .setDesc("Number of lint run notes to keep.")
      .addSlider((slider) =>
        slider
          .setLimits(5, 100, 5)
          .setValue(this.plugin.settings.lintRunRetentionCount)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.lintRunRetentionCount = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Lint file links")
      .setDesc("Wrap file paths in [[wikilinks]] in lint run notes so you can navigate directly to affected files.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.lintFileLinks)
          .onChange(async (value) => {
            this.plugin.settings.lintFileLinks = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Maintenance ───────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Maintenance" });

    new Setting(containerEl)
      .setName("Backup retention (days)")
      .setDesc("Delete patch backup files older than this many days.")
      .addSlider((slider) =>
        slider
          .setLimits(1, 90, 1)
          .setValue(this.plugin.settings.backupRetentionDays)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.backupRetentionDays = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Inbox retention (days)")
      .setDesc("Delete inbox files older than this many days.")
      .addSlider((slider) =>
        slider
          .setLimits(1, 90, 1)
          .setValue(this.plugin.settings.inboxRetentionDays)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.inboxRetentionDays = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Lint history retention (days)")
      .setDesc("Trim lint history entries older than this many days.")
      .addSlider((slider) =>
        slider
          .setLimits(1, 365, 1)
          .setValue(this.plugin.settings.lintHistoryRetentionDays)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.lintHistoryRetentionDays = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Lint history max entries")
      .setDesc("Hard cap on the number of lint history entries to retain.")
      .addSlider((slider) =>
        slider
          .setLimits(10, 500, 10)
          .setValue(this.plugin.settings.lintHistoryMaxEntries)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.lintHistoryMaxEntries = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Patch report retention")
      .setDesc("Number of patch report notes to keep.")
      .addSlider((slider) =>
        slider
          .setLimits(5, 100, 5)
          .setValue(this.plugin.settings.patchReportRetentionCount)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.patchReportRetentionCount = value;
            await this.plugin.saveSettings();
          })
      );
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private renderFolderPathSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    settingKey: keyof import("./settings").VaultForgeSettings,
    fallback: string
  ): void {
    const currentValue = String(this.plugin.settings[settingKey] ?? fallback);

    new Setting(containerEl)
      .setName(name)
      .setDesc(`${desc} Current: ${currentValue}`)
      .addButton((btn) =>
        btn.setButtonText("Choose").onClick(() => {
          new FolderSuggestModal(this.app, async (folder) => {
            const selectedPath = folder.path || fallback;
            (this.plugin.settings as any)[settingKey] = selectedPath;
            await this.plugin.saveSettings();
            this.display();
          }).open();
        })
      );
  }

  private renderSchemaNoteSetting(containerEl: HTMLElement): void {
    const currentPath = `${this.plugin.settings.schemaNoteFolder}/${this.plugin.settings.schemaNoteFile}`;

    new Setting(containerEl)
      .setName("Schema note")
      .setDesc(`Path to schema.md relative to vault root. Current: ${currentPath}`)
      .addButton((btn) =>
        btn.setButtonText("Choose").onClick(() => {
          new MarkdownFileSuggestModal(this.app, async (file) => {
            const lastSlash = file.path.lastIndexOf("/");
            this.plugin.settings.schemaNoteFolder =
              lastSlash >= 0 ? file.path.substring(0, lastSlash) : "";
            this.plugin.settings.schemaNoteFile =
              lastSlash >= 0 ? file.path.substring(lastSlash + 1) : file.path;
            await this.plugin.saveSettings();
            this.display();
          }).open();
        })
      );
  }

  private renderPatchFileSetting(containerEl: HTMLElement): void {
    const fallback = "System/VaultForge/Patches/vault-patch.md";
    const currentPath = this.plugin.settings.patchDefaultFile || fallback;

    new Setting(containerEl)
      .setName("Default patch file")
      .setDesc(`Path to the patch note loaded by Apply Vault Patch. Current: ${currentPath}`)
      .addButton((btn) =>
        btn.setButtonText("Choose").onClick(() => {
          new PatchFileSuggestModal(this.app, async (file) => {
            this.plugin.settings.patchDefaultFile = file.path;
            await this.plugin.saveSettings();
            this.display();
          }).open();
        })
      );

  }

}

class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  constructor(
    app: App,
    private onChooseFolder: (folder: TFolder) => void
  ) {
    super(app);
    this.setPlaceholder("Choose a folder...");
  }

  getItems(): TFolder[] {
    const folders: TFolder[] = [];

    const walk = (file: TAbstractFile) => {
      if (file instanceof TFolder) {
        folders.push(file);
        for (const child of file.children) {
          walk(child);
        }
      }
    };

    walk(this.app.vault.getRoot());
    return folders;
  }

  getItemText(folder: TFolder): string {
    return folder.path || "/";
  }

  onChooseItem(folder: TFolder): void {
    this.onChooseFolder(folder);
  }
}

class MarkdownFileSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private onChooseFile: (file: TFile) => void
  ) {
    super(app);
    this.setPlaceholder("Choose a markdown note...");
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChooseFile(file);
  }
}

class PatchFileSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private onChooseFile: (file: TFile) => void
  ) {
    super(app);
    this.setPlaceholder("Choose a patch note or YAML file...");
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((file) => {
      const path = file.path.toLowerCase();
      return path.endsWith(".md") || path.endsWith(".yaml") || path.endsWith(".yml");
    });
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChooseFile(file);
  }
}
