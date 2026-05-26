// src/main.ts
// Forge — Obsidian plugin entry point.

import { Plugin, Notice, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, ForgeSettings } from "./settings";
import { ForgeSettingsTab } from "./settings-tab";
import { SchemaCache } from "./schema-cache";
import { LintService } from "./lint_service";
import { SchemaService } from "./schema_service";
import { OntologyService } from "./ontology_service";
import { PatchHistoryService } from "./patch_history_service";
import { DashboardService } from "./dashboard_service";
import {
  FORGE_HEALTH_DASHBOARD_VIEW,
  ForgeHealthDashboardView,
} from "./dashboard_view";
import { MigrationNoticeModal } from "./migration-notice";
import { runApplyPatch } from "./commands/apply-patch";
import { runVaultLint } from "./commands/run-lint";
import { runValidateSchema } from "./commands/validate-schema";
import { runNormalizeTags, runNormalizeFrontmatter } from "./commands/normalize";
import { runVaultMaintenance } from "./commands/maintenance";
import { runVaultRepair } from "./commands/repair";
import { runRestorePatch } from "./commands/restore-patch";
import { runRenameDataviewFolder } from "./commands/utilities";
import { installVaultForgeDocumentation } from "./docs";
import { runExportOverview } from "./commands/export-overview";
import { runExportOntology } from "./commands/export-ontology";
import { runRefineShapes } from "./commands/refine-shapes";
import { runShapeRepair } from "./commands/shape-repair";

export default class ForgePlugin extends Plugin {
  settings: ForgeSettings;
  schemaCache: SchemaCache;
  lintService: LintService;
  schemaService: SchemaService;
  ontologyService: OntologyService;
  patchHistoryService: PatchHistoryService;
  dashboardService: DashboardService;

  async onload(): Promise<void> {
    // Check for an existing data.json before loadSettings() creates it.
    // A missing file means this is a fresh install — no notice needed.
    // A present file with no lastInstalledVersion means a pre-1.0.0 user.
    const dataPath = `${this.manifest.dir}/data.json`;
    const hadDataFile = await this.app.vault.adapter.exists(dataPath);

    await this.loadSettings();

    const currentVersion = this.manifest.version;
    const lastVersion = this.settings.lastInstalledVersion;
    const isUpgradeFromLegacy = hadDataFile && !lastVersion;

    if (isUpgradeFromLegacy) {
      // Show the migration notice once. onClose writes the version so it
      // never fires again, even if the user dismisses without reading it.
      new MigrationNoticeModal(this.app, this.settings, async () => {
        this.settings.lastInstalledVersion = currentVersion;
        await this.saveSettings();
      }).open();
    } else if (!lastVersion || lastVersion !== currentVersion) {
      // Fresh install, or a future version bump with no notice defined.
      // Silently record the current version so future upgrade checks work.
      this.settings.lastInstalledVersion = currentVersion;
      await this.saveSettings();
    }

    // Initialise schema cache — vault access deferred until layout ready
    this.schemaCache = new SchemaCache(this.app, this.settings);
    this.lintService = new LintService(this.app, this.settings);
    this.schemaService = new SchemaService(this.app, this.settings, this.schemaCache);
    this.ontologyService = new OntologyService(this.app, this.settings);
    this.patchHistoryService = new PatchHistoryService(this.app, this.settings);
    this.dashboardService = new DashboardService(this.app, this.settings, {
      lintService: this.lintService,
      schemaService: this.schemaService,
      ontologyService: this.ontologyService,
      patchHistoryService: this.patchHistoryService,
    });

    this.registerView(
      FORGE_HEALTH_DASHBOARD_VIEW,
      (leaf: WorkspaceLeaf) => new ForgeHealthDashboardView(leaf, this)
    );

    // Register commands and settings tab immediately — these don't need vault access
    this.addCommand({
      id: "apply-vault-patch",
      name: "Apply Vault Patch",
      callback: () => {
        runApplyPatch(this).catch((e: Error) => {
          new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[Forge] apply-vault-patch error:", e);
        });
      },
    });

    this.addCommand({
      id: "run-vault-lint",
      name: "Run Vault Lint",
      callback: () => {
        runVaultLint(this).catch((e: Error) => {
          new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[Forge] run-vault-lint error:", e);
        });
      },
    });

    this.addCommand({
      id: "validate-schema",
      name: "Validate Schema",
      callback: () => {
        runValidateSchema(this).catch((e: Error) => {
          new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[Forge] validate-schema error:", e);
        });
      },
    });

    this.addCommand({
      id: "normalize-tags",
      name: "Normalize Tags",
      callback: () => {
        runNormalizeTags(this).catch((e: Error) => {
          new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[Forge] normalize-tags error:", e);
        });
      },
    });

    this.addCommand({
      id: "normalize-frontmatter",
      name: "Normalize Frontmatter",
      callback: () => {
        runNormalizeFrontmatter(this).catch((e: Error) => {
          new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[Forge] normalize-frontmatter error:", e);
        });
      },
    });

    this.addCommand({
      id: "vault-maintenance",
      name: "Vault Maintenance",
      callback: () => {
        runVaultMaintenance(this).catch((e: Error) => {
          new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[Forge] vault-maintenance error:", e);
        });
      },
    });

    this.addCommand({
      id: "vault-repair",
      name: "Vault Repair",
      callback: () => {
        runVaultRepair(this).catch((e: Error) => {
          new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[Forge] vault-repair error:", e);
        });
      },
    });

    this.addCommand({
      id: "restore-patch-run",
      name: "Restore Patch Run",
      callback: () => {
        runRestorePatch(this).catch((e: Error) => {
          new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[Forge] restore-patch-run error:", e);
        });
      },
    });

    this.addCommand({
      id: "rename-dataview-folder",
      name: "Rename Dataview Folder",
      callback: () => {
        runRenameDataviewFolder(this).catch((e: Error) => {
          new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[Forge] rename-dataview-folder error:", e);
        });
      },
    });

    this.addCommand({
      id: "install-documentation",
      name: "Install Documentation",
      callback: () => {
        installVaultForgeDocumentation(this.app, this.settings).catch((e: Error) => {
          new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[Forge] install-documentation error:", e);
        });
      },
    });


    this.addCommand({
      id: "export-vault-overview",
      name: "Export Vault Overview",
      callback: () => {
        runExportOverview(this).catch((e: Error) => {
          new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[Forge] export-vault-overview error:", e);
        });
      },
    });

    this.addCommand({
      id: "export-ontology-index",
      name: "Export Ontology Index",
      callback: () => {
        runExportOntology(this).catch((e: Error) => {
          new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[Forge] export-ontology-index error:", e);
        });
      },
    });

    this.addCommand({
      id: "refine-shapes",
      name: "Refine Shape Templates",
      callback: () => {
        runRefineShapes(this).catch((e: Error) => {
          new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[Forge] refine-shapes error:", e);
        });
      },
    });

    this.addCommand({
      id: "shape-repair",
      name: "Run Shape Repair",
      callback: () => {
        runShapeRepair(this).catch((e: Error) => {
          new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[Forge] shape-repair error:", e);
        });
      },
    });

    this.addCommand({
      id: "shape-repair-dry-run",
      name: "Run Shape Repair (Dry Run)",
      callback: () => {
        runShapeRepair(this, true).catch((e: Error) => {
          new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[Forge] shape-repair-dry-run error:", e);
        });
      },
    });

    this.addCommand({
      id: "open-vault-health-dashboard",
      name: "Open Vault Health Dashboard",
      callback: () => {
        this.openHealthDashboard().catch((e: Error) => {
          new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[Forge] open-vault-health-dashboard error:", e);
        });
      },
    });

    this.addCommand({
      id: "refresh-vault-health-dashboard",
      name: "Refresh Vault Health Dashboard",
      callback: () => {
        this.dashboardService.refreshSnapshot()
          .then(() => new Notice("Forge: Vault Health Dashboard refreshed.", 4000))
          .catch((e: Error) => {
            new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
            console.error("[Forge] refresh-vault-health-dashboard error:", e);
          });
      },
    });

    this.addCommand({
      id: "export-dashboard-snapshot",
      name: "Export Dashboard Snapshot",
      callback: () => {
        this.dashboardService.exportSnapshot()
          .then((path) => new Notice(`Forge: Dashboard snapshot exported to ${path}`, 6000))
          .catch((e: Error) => {
            new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
            console.error("[Forge] export-dashboard-snapshot error:", e);
          });
      },
    });

    this.addSettingTab(new ForgeSettingsTab(this.app, this));

    // Defer all vault file access until the workspace layout is ready.
    // On iOS, the vault adapter is not fully mounted when onload() fires
    // on a cold start — accessing files here causes the plugin to fail.
    // onLayoutReady() is a no-op if layout is already ready (e.g. on re-enable).
    this.app.workspace.onLayoutReady(() => {
      // Warm schema cache — retry once after 3s if vault not ready yet (iOS sync delay)
      this.schemaCache.refresh().catch(() => {
        setTimeout(() => this.schemaCache.refresh().catch((e) => {
          console.warn("[Forge] Schema cache retry failed:", e);
        }), 3000);
      });
    });

    console.log("Forge loaded");
  }

  onunload(): void {
    console.log("Forge unloaded");
  }

  async openHealthDashboard(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(FORGE_HEALTH_DASHBOARD_VIEW);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
    await leaf.setViewState({
      type: FORGE_HEALTH_DASHBOARD_VIEW,
      active: true,
    });
    this.app.workspace.revealLeaf(leaf);
  }

  async recomposeHealthDashboard(): Promise<void> {
    try {
      await this.dashboardService.composeSnapshotFromLatest();
      const leaves = this.app.workspace.getLeavesOfType(FORGE_HEALTH_DASHBOARD_VIEW);
      for (const leaf of leaves) {
        if (leaf.view instanceof ForgeHealthDashboardView) {
          await leaf.view.reloadFromCache();
        }
      }
    } catch (e) {
      console.warn("[Forge] Could not recompose health dashboard:", e);
    }
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
    if (this.lintService) this.lintService = new LintService(this.app, this.settings);
    if (this.schemaService) this.schemaService = new SchemaService(this.app, this.settings, this.schemaCache);
    if (this.ontologyService) this.ontologyService = new OntologyService(this.app, this.settings);
    if (this.patchHistoryService) this.patchHistoryService = new PatchHistoryService(this.app, this.settings);
    if (this.dashboardService) {
      this.dashboardService = new DashboardService(this.app, this.settings, {
        lintService: this.lintService,
        schemaService: this.schemaService,
        ontologyService: this.ontologyService,
        patchHistoryService: this.patchHistoryService,
      });
    }
  }
}
