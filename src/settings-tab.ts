// src/settings-tab.ts
// Settings UI for Vault Forge.
// Renders in Obsidian's Settings → Vault Forge panel.
//
// Field Identity section now supports:
//   - Load from Schema button — detects field names from schema.md
//   - Dynamic dropdowns populated from schema field names
//   - Falls back to text inputs if schema not yet loaded

import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type VaultForgePlugin from "./main";

export class VaultForgeSettingsTab extends PluginSettingTab {
  plugin: VaultForgePlugin;

  constructor(app: App, plugin: VaultForgePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ── Field Identity ──────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Field Identity" });
    containerEl.createEl("p", {
      text: "Which frontmatter fields carry semantic meaning in your vault. Use Load from Schema to auto-detect from schema.md.",
      cls: "setting-item-description",
    });

    // Load from Schema button
    new Setting(containerEl)
      .setName("Load from Schema")
      .setDesc("Auto-detect field names from schema.md and update the fields below.")
      .addButton((btn) => {
        btn.setButtonText("Load from Schema").onClick(async () => {
          await this.plugin.schemaCache.refresh();
          const detected = this.plugin.schemaCache.detectIdentityFields(this.plugin.settings);

          if (Object.keys(detected).length === 0) {
            new Notice("Vault Forge: Could not load schema.md — check the schema path in System Paths.", 5000);
            return;
          }

          Object.assign(this.plugin.settings, detected);
          await this.plugin.saveSettings();
          this.display(); // re-render with updated values
          new Notice("Vault Forge: Field identity updated from schema.", 3000);
        });
      });

    // Get field names for dropdowns
    const fieldNames = this.plugin.schemaCache.getFieldNames();
    const hasSchema = fieldNames.length > 0;

    this.renderIdentityField(
      containerEl,
      "Type field",
      "Frontmatter field that identifies what a note is.",
      "typeField",
      fieldNames,
      hasSchema
    );

    this.renderIdentityField(
      containerEl,
      "Status field",
      "Frontmatter field for note status.",
      "statusField",
      fieldNames,
      hasSchema
    );

    this.renderIdentityField(
      containerEl,
      "Tags field",
      "Frontmatter field for tags.",
      "tagsField",
      fieldNames,
      hasSchema
    );

    this.renderIdentityField(
      containerEl,
      "Created field",
      "Frontmatter field for creation date.",
      "createdField",
      fieldNames,
      hasSchema
    );

    this.renderIdentityField(
      containerEl,
      "Updated field",
      "Frontmatter field for last modified date.",
      "updatedField",
      fieldNames,
      hasSchema
    );


    // ── System Paths ────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "System Paths" });
    containerEl.createEl("p", {
      text: "All paths are relative to your vault root.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("System folder")
      .setDesc("Root folder for all vault system files.")
      .addText((text) =>
        text
          .setPlaceholder("System")
          .setValue(this.plugin.settings.systemFolder)
          .onChange(async (value) => {
            this.plugin.settings.systemFolder = value.trim() || "System";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Vault Forge folder")
      .setDesc("Folder for Vault Forge configuration and patch archives.")
      .addText((text) =>
        text
          .setPlaceholder("System/VaultForge")
          .setValue(this.plugin.settings.vaultForgeFolder)
          .onChange(async (value) => {
            this.plugin.settings.vaultForgeFolder = value.trim() || "System/VaultForge";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Schema note")
      .setDesc("Path to schema.md relative to vault root.")
      .addText((text) =>
        text
          .setPlaceholder("System/Registry/schema.md")
          .setValue(`${this.plugin.settings.schemaNoteFolder}/${this.plugin.settings.schemaNoteFile}`)
          .onChange(async (value) => {
            const trimmed = value.trim() || "System/Registry/schema.md";
            const lastSlash = trimmed.lastIndexOf("/");
            this.plugin.settings.schemaNoteFolder =
              lastSlash >= 0 ? trimmed.substring(0, lastSlash) : "System/Registry";
            this.plugin.settings.schemaNoteFile =
              lastSlash >= 0 ? trimmed.substring(lastSlash + 1) : "schema.md";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Exports folder")
      .setDesc("Folder where inventory, lint reports, and indexes are written.")
      .addText((text) =>
        text
          .setPlaceholder("System/Exports")
          .setValue(this.plugin.settings.exportsFolder)
          .onChange(async (value) => {
            this.plugin.settings.exportsFolder = value.trim() || "System/Exports";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Patches folder")
      .setDesc("Folder where applied patch files are archived.")
      .addText((text) =>
        text
          .setPlaceholder("System/VaultForge/Patches")
          .setValue(this.plugin.settings.patchesFolder)
          .onChange(async (value) => {
            this.plugin.settings.patchesFolder = value.trim() || "System/VaultForge/Patches";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Inbox folder")
      .setDesc("Folder for draft notes awaiting import.")
      .addText((text) =>
        text
          .setPlaceholder("System/Inbox")
          .setValue(this.plugin.settings.inboxFolder)
          .onChange(async (value) => {
            this.plugin.settings.inboxFolder = value.trim() || "System/Inbox";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Patterns folder")
      .setDesc("Folder containing pattern notes for lint validation.")
      .addText((text) =>
        text
          .setPlaceholder("System/Patterns")
          .setValue(this.plugin.settings.patternsFolder)
          .onChange(async (value) => {
            this.plugin.settings.patternsFolder = value.trim() || "System/Patterns";
            await this.plugin.saveSettings();
          })
      );

    // ── Patch ────────────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Patch" });

    new Setting(containerEl)
      .setName("Default patch file")
      .setDesc("Path to the patch YAML file loaded by Apply Vault Patch.")
      .addText((text) =>
        text
          .setPlaceholder("System/Exports/vault-patch.yaml")
          .setValue(this.plugin.settings.patchDefaultFile)
          .onChange(async (value) => {
            this.plugin.settings.patchDefaultFile =
              value.trim() || "System/Exports/vault-patch.yaml";
            await this.plugin.saveSettings();
          })
      );

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

  private renderIdentityField(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    settingKey: keyof import("./settings").VaultForgeSettings,
    fieldNames: string[],
    hasSchema: boolean
  ): void {
    const currentValue = String(this.plugin.settings[settingKey] ?? "");

    if (hasSchema) {
      // Render as dropdown with schema field names
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addDropdown((dd) => {
          // Add a blank option in case the current value isn't in the schema
          if (!fieldNames.includes(currentValue)) {
            dd.addOption(currentValue, `${currentValue} (custom)`);
          }
          for (const field of fieldNames) {
            dd.addOption(field, field);
          }
          dd.setValue(currentValue);
          dd.onChange(async (value) => {
            (this.plugin.settings as any)[settingKey] = value;
            await this.plugin.saveSettings();
          });
        });
    } else {
      // Fallback to text input if schema not loaded
      new Setting(containerEl)
        .setName(name)
        .setDesc(`${desc} (Load from Schema to see available fields)`)
        .addText((text) =>
          text
            .setValue(currentValue)
            .onChange(async (value) => {
              (this.plugin.settings as any)[settingKey] = value.trim() || currentValue;
              await this.plugin.saveSettings();
            })
        );
    }
  }
}
