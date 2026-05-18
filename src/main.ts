// src/main.ts
// Vault Forge — Obsidian plugin entry point.

import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, VaultForgeSettings } from "./settings";
import { VaultForgeSettingsTab } from "./settings-tab";
import { writeConfigNote } from "./config-writer";
import { SchemaCache } from "./schema-cache";
import { runApplyPatch } from "./commands/apply-patch";
import { runVaultLint } from "./commands/run-lint";
import { runValidateSchema } from "./commands/validate-schema";
import { runNormalizeTags, runNormalizeFrontmatter } from "./commands/normalize";
import { runVaultMaintenance } from "./commands/maintenance";
import { runVaultRepair } from "./commands/repair";
import { runRestorePatch } from "./commands/restore-patch";
import { runRenameDataviewFolder } from "./commands/utilities";
import { installVaultForgeDocumentation } from "./docs";

export default class VaultForgePlugin extends Plugin {
  settings: VaultForgeSettings;
  schemaCache: SchemaCache;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Initialise schema cache — warms in background, never blocks load
    this.schemaCache = new SchemaCache(this.app, this.settings);
    this.schemaCache.refresh().catch(() => {});

    await writeConfigNote(this.app, this.settings);

    this.addCommand({
      id: "apply-vault-patch",
      name: "Apply Vault Patch",
      callback: () => runApplyPatch(this),
    });

    this.addCommand({
      id: "run-vault-lint",
      name: "Run Vault Lint",
      callback: () => runVaultLint(this),
    });

    this.addCommand({
      id: "validate-schema",
      name: "Validate Schema",
      callback: () => runValidateSchema(this),
    });

    this.addCommand({
      id: "normalize-tags",
      name: "Normalize Tags",
      callback: () => runNormalizeTags(this),
    });

    this.addCommand({
      id: "normalize-frontmatter",
      name: "Normalize Frontmatter",
      callback: () => runNormalizeFrontmatter(this),
    });

    this.addCommand({
      id: "vault-maintenance",
      name: "Vault Maintenance",
      callback: () => runVaultMaintenance(this),
    });

    this.addCommand({
      id: "vault-repair",
      name: "Vault Repair",
      callback: () => runVaultRepair(this),
    });

    this.addCommand({
      id: "restore-patch-run",
      name: "Restore Patch Run",
      callback: () => runRestorePatch(this),
    });

    this.addCommand({
      id: "rename-dataview-folder",
      name: "Rename Dataview Folder",
      callback: () => runRenameDataviewFolder(this),
    });

    this.addCommand({
      id: "install-documentation",
      name: "Install Documentation",
      callback: () => installVaultForgeDocumentation(this.app, this.settings),
    });

    this.addSettingTab(new VaultForgeSettingsTab(this.app, this));

    console.log("Vault Forge loaded");
  }

  onunload(): void {
    console.log("Vault Forge unloaded");
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) ?? {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);

    // Migrate old saved patch path from legacy raw YAML to patch note format.
    if (
      !loaded.patchDefaultFile ||
      loaded.patchDefaultFile === "System/Exports/vault-patch.yaml"
    ) {
      this.settings.patchDefaultFile = DEFAULT_SETTINGS.patchDefaultFile;
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    if (this.schemaCache) {
      this.schemaCache.updateSettings(this.settings);
    }
    await writeConfigNote(this.app, this.settings);
  }
}
