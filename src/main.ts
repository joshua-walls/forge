// src/main.ts
// Forge — Obsidian plugin entry point.

import { Plugin, Notice, WorkspaceLeaf } from "obsidian";
import {
  DEFAULT_SETTINGS,
  type DashboardAutoRefreshIntervalMinutes,
  ForgeSettings,
} from "./settings";
import { ForgeSettingsTab } from "./settings-tab";
import { SchemaCache } from "./schema-cache";
import { LintService } from "./lint_service";
import { SchemaService } from "./schema_service";
import { OntologyService } from "./ontology_service";
import { ShapeLintService } from "./shape_lint_service";
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
import { runShapeLint } from "./commands/run-shape-lint";
import { getVaultPaths } from "./vault-paths";
import { DataviewExpansionService } from "./dataview_expansion_service";

type LegacyDashboardRuntimeSettings = {
  dashboardAutoRefreshEnabled?: boolean;
  dashboardAutoRefreshIntervalMinutes?: DashboardAutoRefreshIntervalMinutes;
  dataviewExpansionAutoUpdateOnSave?: boolean;
  dataviewExpansionAutoUpdateMode?: ForgeSettings["dataviewExpansionAutoUpdateMode"];
};

export default class ForgePlugin extends Plugin {
  settings: ForgeSettings;
  schemaCache: SchemaCache;
  lintService: LintService;
  schemaService: SchemaService;
  ontologyService: OntologyService;
  shapeLintService: ShapeLintService;
  patchHistoryService: PatchHistoryService;
  dashboardService: DashboardService;
  dataviewExpansionService: DataviewExpansionService;
  hasPendingExternalSettingsReload = false;
  private lastKnownSettingsMtime = 0;
  private readonly settingsPollIntervalMs = 5_000;

  async onload(): Promise<void> {
    // Check for an existing data.json before loadSettings() creates it.
    // A missing file means this is a fresh install — no notice needed.
    // A present file with no lastInstalledVersion means a pre-1.0.0 user.
    const dataPath = `${this.manifest.dir}/data.json`;
    const hadDataFile = await this.app.vault.adapter.exists(dataPath);

    await this.loadSettings();
    await this.captureSettingsMtime();

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

    // If this is a version upgrade and the dashboard pane is already open
    // (survived the disable/enable cycle), flag it to show the reload banner.
    if (lastVersion && lastVersion !== currentVersion) {
      this.app.workspace.onLayoutReady(() => {
        const leaves = this.app.workspace.getLeavesOfType(FORGE_HEALTH_DASHBOARD_VIEW);
        for (const leaf of leaves) {
          if (leaf.view instanceof ForgeHealthDashboardView) {
            leaf.view.needsReload = true;
            leaf.view.render();
          }
        }
      });
    }

    // Initialise schema cache — vault access deferred until layout ready
    this.schemaCache = new SchemaCache(this.app, this.settings);
    this.lintService = new LintService(this.app, this.settings);
    this.schemaService = new SchemaService(this.app, this.settings, this.schemaCache);
    this.ontologyService = new OntologyService(this.app, this.settings);
    this.shapeLintService = new ShapeLintService(this.app, this.settings);
    this.patchHistoryService = new PatchHistoryService(this.app, this.settings, this.manifest.version);
    this.dashboardService = new DashboardService(
      this.app,
      this.settings,
      {
        lintService: this.lintService,
        schemaService: this.schemaService,
        ontologyService: this.ontologyService,
        shapeLintService: this.shapeLintService,
        patchHistoryService: this.patchHistoryService,
      },
      this.manifest.version  // stamped into cache on every write
    );
    this.dataviewExpansionService = new DataviewExpansionService(this.app, this, this.settings);

    this.registerView(
      FORGE_HEALTH_DASHBOARD_VIEW,
      (leaf: WorkspaceLeaf) => new ForgeHealthDashboardView(leaf, this)
    );

    this.startSettingsSyncWatch();

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
      id: "open-schema-md",
      name: "Open schema.md",
      callback: () => {
        const paths = getVaultPaths(this.settings);
        this.app.workspace.openLinkText(paths.schemaMd, "", false);
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
      id: "refresh-dataview-expansion",
      name: "Refresh Dataview Expansion",
      callback: () => {
        this.dataviewExpansionService.refreshActiveFile(true).catch((e: Error) => {
          new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[Forge] refresh-dataview-expansion error:", e);
        });
      },
    });

    this.addCommand({
      id: "refresh-dataview-expansion-current-folder",
      name: "Refresh Dataview Expansion in Current Folder",
      callback: () => {
        this.dataviewExpansionService.refreshCurrentFolder(true).catch((e: Error) => {
          new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[Forge] refresh-dataview-expansion-current-folder error:", e);
        });
      },
    });

    this.addCommand({
      id: "refresh-dataview-expansion-whole-vault",
      name: "Refresh Dataview Expansion in Whole Vault",
      callback: () => {
        this.dataviewExpansionService.refreshWholeVault(true).catch((e: Error) => {
          new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[Forge] refresh-dataview-expansion-whole-vault error:", e);
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
      id: "export-vault-snapshot",
      name: "Export Vault Snapshot",
      callback: () => {
        runExportOverview(this).catch((e: Error) => {
          new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[Forge] export-vault-snapshot error:", e);
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
      id: "refresh-ontology-metrics",
      name: "Refresh Ontology Metrics",
      callback: () => {
        this.ontologyService.collectMetrics("refresh-vault-health-dashboard")
          .then(() => this.recomposeHealthDashboard())
          .then(() => new Notice("Forge: Ontology metrics refreshed.", 4000))
          .catch((e: Error) => {
            new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
            console.error("[Forge] refresh-ontology-metrics error:", e);
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
      id: "run-shape-lint",
      name: "Run Shape Lint",
      callback: () => {
        runShapeLint(this).catch((e: Error) => {
          new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          console.error("[Forge] run-shape-lint error:", e);
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

    this.addCommand({
      id: "view-patch-history",
      name: "View Patch History",
      callback: () => {
        this.patchHistoryService.readHistory("patch-history")
          .then(() => this.recomposeHealthDashboard())
          .then(() => this.openHealthDashboard())
          .then(() => new Notice("Forge: Patch history refreshed in the dashboard.", 5000))
          .catch((e: Error) => {
            new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
            console.error("[Forge] view-patch-history error:", e);
        });
      },
    });

    this.addCommand({
      id: "view-last-run",
      name: "View Last Forge Run",
      callback: () => {
        this.dashboardService.latestOperationalRun()
          .then((run) => {
            if (!run) {
              new Notice("Forge: No operational runs have been recorded yet.", 5000);
              return;
            }
            new Notice(
              `Forge: Last run was ${formatCommandName(run.command)}. Status: ${run.status}. Applied ${run.applied_items} item(s), with ${run.errors.length} error(s).`,
              7000
            );
          })
          .catch((e: Error) => {
            new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
            console.error("[Forge] view-last-run error:", e);
          });
      },
    });

    this.addSettingTab(new ForgeSettingsTab(this.app, this));

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        this.dataviewExpansionService.onFileModified(file);
      })
    );

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.dataviewExpansionService.onFileOpened(file);
      })
    );

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
      this.ensureHealthDashboardPanel().catch((e) => {
        console.warn("[Forge] Could not preload health dashboard panel:", e);
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

    const leaf = await this.app.workspace.ensureSideLeaf(FORGE_HEALTH_DASHBOARD_VIEW, "right", {
      active: true,
      reveal: true,
      split: false,
    });
    this.app.workspace.revealLeaf(leaf);
  }

  async ensureHealthDashboardPanel(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(FORGE_HEALTH_DASHBOARD_VIEW);
    if (leaves.length > 0) return;

    await this.app.workspace.ensureSideLeaf(FORGE_HEALTH_DASHBOARD_VIEW, "right", {
      active: false,
      reveal: false,
      split: false,
    });
  }

  openForgeSettings(): void {
    const setting = (this.app as any).setting;
    if (!setting?.open) {
      new Notice("Forge: Could not open settings from this Obsidian version.", 5000);
      return;
    }

    setting.open();
    setting.openTabById?.(this.manifest.id);
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
    const loaded = sanitizeLoadedSettings((await this.loadData()) ?? {});
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);

    if ("dataviewExpansionAutoUpdateOnSave" in loaded && !("dataviewExpansionAutoUpdateMode" in loaded)) {
      this.settings.dataviewExpansionAutoUpdateMode = (loaded as LegacyDashboardRuntimeSettings).dataviewExpansionAutoUpdateOnSave
        ? "edit_idle"
        : "off";
    }

    // Migrate old saved patch path from legacy raw YAML to patch note format.
    if (
      !loaded.patchDefaultFile ||
      loaded.patchDefaultFile === "System/Exports/vault-patch.yaml"
    ) {
      this.settings.patchDefaultFile = DEFAULT_SETTINGS.patchDefaultFile;
    }
  }

  async reloadSettingsFromDisk(): Promise<void> {
    await this.loadSettings();
    this.refreshRuntimeServices();
    this.hasPendingExternalSettingsReload = false;
    await this.captureSettingsMtime();

    const leaves = this.app.workspace.getLeavesOfType(FORGE_HEALTH_DASHBOARD_VIEW);
    for (const leaf of leaves) {
      if (leaf.view instanceof ForgeHealthDashboardView) {
        await leaf.view.onSettingsReloaded();
      }
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(settingsForPersistence(this.settings));
    this.refreshRuntimeServices();
    this.hasPendingExternalSettingsReload = false;
    await this.captureSettingsMtime();
    await this.refreshDashboardViewsForSettingsChange();
  }

  async applyRuntimeSettingsChange(): Promise<void> {
    this.refreshRuntimeServices();
    this.hasPendingExternalSettingsReload = false;
    await this.refreshDashboardViewsForSettingsChange();
  }

  private refreshRuntimeServices(): void {
    if (this.schemaCache) {
      this.schemaCache.updateSettings(this.settings);
    }
    if (this.lintService) this.lintService = new LintService(this.app, this.settings);
    if (this.schemaService) this.schemaService = new SchemaService(this.app, this.settings, this.schemaCache);
    if (this.ontologyService) this.ontologyService = new OntologyService(this.app, this.settings);
    if (this.shapeLintService) this.shapeLintService = new ShapeLintService(this.app, this.settings);
    if (this.patchHistoryService) this.patchHistoryService = new PatchHistoryService(this.app, this.settings, this.manifest.version);
    if (this.dataviewExpansionService) this.dataviewExpansionService.updateSettings(this.settings);
    if (this.dashboardService) {
      this.dashboardService = new DashboardService(
        this.app,
        this.settings,
        {
          lintService: this.lintService,
          schemaService: this.schemaService,
          ontologyService: this.ontologyService,
          shapeLintService: this.shapeLintService,
          patchHistoryService: this.patchHistoryService,
        },
        this.manifest.version
      );
    }
  }

  private startSettingsSyncWatch(): void {
    const settingsPath = this.getSettingsDataPath();

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file.path === settingsPath) {
          void this.checkForExternalSettingsChange();
        }
      })
    );

    this.registerInterval(window.setInterval(() => {
      void this.checkForExternalSettingsChange();
    }, this.settingsPollIntervalMs));
  }

  private async checkForExternalSettingsChange(): Promise<void> {
    try {
      const stat = await this.app.vault.adapter.stat(this.getSettingsDataPath());
      const mtime = stat?.mtime ?? 0;
      if (mtime === 0 || mtime === this.lastKnownSettingsMtime) return;

      this.lastKnownSettingsMtime = mtime;
      const stored = sanitizeLoadedSettings((await this.loadData()) ?? {});
      const normalizedStored = settingsForPersistence(Object.assign({}, DEFAULT_SETTINGS, stored));
      const normalizedCurrent = settingsForPersistence(this.settings);
      if (JSON.stringify(normalizedStored) === JSON.stringify(normalizedCurrent)) return;

      this.hasPendingExternalSettingsReload = true;
      this.renderSettingsReloadBanner();
    } catch {
      // Ignore transient sync states while the file is being written.
    }
  }

  private renderSettingsReloadBanner(): void {
    const leaves = this.app.workspace.getLeavesOfType(FORGE_HEALTH_DASHBOARD_VIEW);
    for (const leaf of leaves) {
      if (leaf.view instanceof ForgeHealthDashboardView) {
        leaf.view.render();
      }
    }
  }

  private async captureSettingsMtime(): Promise<void> {
    try {
      const stat = await this.app.vault.adapter.stat(this.getSettingsDataPath());
      this.lastKnownSettingsMtime = stat?.mtime ?? 0;
    } catch {
      this.lastKnownSettingsMtime = 0;
    }
  }

  private getSettingsDataPath(): string {
    return `${this.manifest.dir}/data.json`;
  }

  private async refreshDashboardViewsForSettingsChange(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(FORGE_HEALTH_DASHBOARD_VIEW);
    for (const leaf of leaves) {
      if (leaf.view instanceof ForgeHealthDashboardView) {
        leaf.view.render();
        await leaf.view.onSettingsReloaded();
      }
    }
  }
}

function formatCommandName(command: string): string {
  return command
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function sanitizeLoadedSettings(raw: unknown): Partial<ForgeSettings> {
  const loaded = raw && typeof raw === "object"
    ? { ...(raw as Record<string, unknown>) }
    : {};

  delete (loaded as LegacyDashboardRuntimeSettings).dashboardAutoRefreshEnabled;
  delete (loaded as LegacyDashboardRuntimeSettings).dashboardAutoRefreshIntervalMinutes;
  delete (loaded as LegacyDashboardRuntimeSettings).dataviewExpansionAutoUpdateMode;

  return loaded as Partial<ForgeSettings>;
}

function settingsForPersistence(settings: ForgeSettings): Partial<ForgeSettings> {
  const persisted = { ...settings };
  delete (persisted as Partial<ForgeSettings>).dataviewExpansionAutoUpdateMode;
  return persisted;
}
