// src/main.ts
// Vault Forge — Obsidian plugin entry point.

import { Plugin, Notice } from "obsidian";
import { DEFAULT_SETTINGS, VaultForgeSettings } from "./settings";
import { VaultForgeSettingsTab } from "./settings-tab";
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

    // Initialise schema cache — vault access deferred until layout ready
    this.schemaCache = new SchemaCache(this.app, this.settings);

    // Register commands and settings tab immediately — these don't need vault access
    this.addCommand({
      id: "apply-vault-patch",
      name: "Apply Vault Patch",
      callback: () => {
        runApplyPatch(this).catch((e: Error) => {
          new Notice(`Vault Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[VaultForge] apply-vault-patch error:", e);
        });
      },
    });

    this.addCommand({
      id: "run-vault-lint",
      name: "Run Vault Lint",
      callback: () => {
        runVaultLint(this).catch((e: Error) => {
          new Notice(`Vault Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[VaultForge] run-vault-lint error:", e);
        });
      },
    });

    this.addCommand({
      id: "validate-schema",
      name: "Validate Schema",
      callback: () => {
        runValidateSchema(this).catch((e: Error) => {
          new Notice(`Vault Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[VaultForge] validate-schema error:", e);
        });
      },
    });

    this.addCommand({
      id: "normalize-tags",
      name: "Normalize Tags",
      callback: () => {
        runNormalizeTags(this).catch((e: Error) => {
          new Notice(`Vault Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[VaultForge] normalize-tags error:", e);
        });
      },
    });

    this.addCommand({
      id: "normalize-frontmatter",
      name: "Normalize Frontmatter",
      callback: () => {
        runNormalizeFrontmatter(this).catch((e: Error) => {
          new Notice(`Vault Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[VaultForge] normalize-frontmatter error:", e);
        });
      },
    });

    this.addCommand({
      id: "vault-maintenance",
      name: "Vault Maintenance",
      callback: () => {
        runVaultMaintenance(this).catch((e: Error) => {
          new Notice(`Vault Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[VaultForge] vault-maintenance error:", e);
        });
      },
    });

    this.addCommand({
      id: "vault-repair",
      name: "Vault Repair",
      callback: () => {
        runVaultRepair(this).catch((e: Error) => {
          new Notice(`Vault Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[VaultForge] vault-repair error:", e);
        });
      },
    });

    this.addCommand({
      id: "restore-patch-run",
      name: "Restore Patch Run",
      callback: () => {
        runRestorePatch(this).catch((e: Error) => {
          new Notice(`Vault Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[VaultForge] restore-patch-run error:", e);
        });
      },
    });

    this.addCommand({
      id: "rename-dataview-folder",
      name: "Rename Dataview Folder",
      callback: () => {
        runRenameDataviewFolder(this).catch((e: Error) => {
          new Notice(`Vault Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[VaultForge] rename-dataview-folder error:", e);
        });
      },
    });

    this.addCommand({
      id: "install-documentation",
      name: "Install Documentation",
      callback: () => {
        installVaultForgeDocumentation(this.app, this.settings).catch((e: Error) => {
          new Notice(`Vault Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[VaultForge] install-documentation error:", e);
        });
      },
    });

    this.addSettingTab(new VaultForgeSettingsTab(this.app, this));

    // Defer all vault file access until the workspace layout is ready.
    // On iOS, the vault adapter is not fully mounted when onload() fires
    // on a cold start — accessing files here causes the plugin to fail.
    // onLayoutReady() is a no-op if layout is already ready (e.g. on re-enable).
    this.app.workspace.onLayoutReady(() => {
      // Warm schema cache — retry once after 3s if vault not ready yet (iOS sync delay)
      this.schemaCache.refresh().catch(() => {
        setTimeout(() => this.schemaCache.refresh().catch((e) => {
          console.warn("[VaultForge] Schema cache retry failed:", e);
        }), 3000);
      });
    });

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
  }
}
