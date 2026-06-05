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
import { ActiveFileLintService } from "./active_file_lint_service";

type LegacyDashboardRuntimeSettings = {
  dashboardAutoRefreshEnabled?: boolean;
  dashboardAutoRefreshIntervalMinutes?: DashboardAutoRefreshIntervalMinutes;
  dataviewExpansionAutoUpdateOnSave?: boolean;
  dataviewExpansionAutoUpdateMode?: ForgeSettings["dataviewExpansionAutoUpdateMode"];
};

type AppSettingsManager = {
  open: () => void;
  openTabById?: (id: string) => void;
};

type AppWithSettingsManager = Plugin["app"] & {
  setting?: AppSettingsManager;
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
  activeFileLintService: ActiveFileLintService;
  hasPendingExternalSettingsReload = false;
  private lastKnownSettingsMtime = 0;
  private readonly settingsPollIntervalMs = 5_000;

  private handleCommandError(commandId: string, error: unknown): void {
    const message = error instanceof Error ? error.message : "Unexpected error";
    new Notice(`Forge: ${message}`, 6000);
    console.error(`[Forge] ${commandId} error:`, error);
  }

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
      new MigrationNoticeModal(this.app, this.settings, () => {
        void (async () => {
          this.settings.lastInstalledVersion = currentVersion;
          await this.saveSettings();
        })();
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
    this.activeFileLintService = new ActiveFileLintService(this.app, this, this.settings);

    this.registerView(
      FORGE_HEALTH_DASHBOARD_VIEW,
      (leaf: WorkspaceLeaf) => new ForgeHealthDashboardView(leaf, this)
    );

    this.startSettingsSyncWatch();

    // Register commands and settings tab immediately — these don't need vault access
    this.addCommand({
      id: "apply-vault-patch",
      name: "Apply vault patch",
      callback: () => {
        void runApplyPatch(this).catch((error: unknown) => {
          this.handleCommandError("apply-vault-patch", error);
        });
      },
    });

    this.addCommand({
      id: "run-vault-lint",
      name: "Run vault lint",
      callback: () => {
        void runVaultLint(this).catch((error: unknown) => {
          this.handleCommandError("run-vault-lint", error);
        });
      },
    });

    this.addCommand({
      id: "validate-schema",
      name: "Validate schema",
      callback: () => {
        void runValidateSchema(this).catch((error: unknown) => {
          this.handleCommandError("validate-schema", error);
        });
      },
    });

    this.addCommand({
      id: "open-schema-md",
      name: "Open schema.md",
      callback: () => {
        const paths = getVaultPaths(this.settings);
        void this.app.workspace.openLinkText(paths.schemaMd, "", false);
      },
    });

    this.addCommand({
      id: "normalize-tags",
      name: "Normalize tags",
      callback: () => {
        void runNormalizeTags(this).catch((error: unknown) => {
          this.handleCommandError("normalize-tags", error);
        });
      },
    });

    this.addCommand({
      id: "normalize-frontmatter",
      name: "Normalize frontmatter",
      callback: () => {
        void runNormalizeFrontmatter(this).catch((error: unknown) => {
          this.handleCommandError("normalize-frontmatter", error);
        });
      },
    });

    this.addCommand({
      id: "vault-maintenance",
      name: "Vault maintenance",
      callback: () => {
        void runVaultMaintenance(this).catch((error: unknown) => {
          this.handleCommandError("vault-maintenance", error);
        });
      },
    });

    this.addCommand({
      id: "vault-repair",
      name: "Vault repair",
      callback: () => {
        void runVaultRepair(this).catch((error: unknown) => {
          this.handleCommandError("vault-repair", error);
        });
      },
    });

    this.addCommand({
      id: "restore-patch-run",
      name: "Restore patch run",
      callback: () => {
        void runRestorePatch(this).catch((error: unknown) => {
          this.handleCommandError("restore-patch-run", error);
        });
      },
    });

    this.addCommand({
      id: "rename-dataview-folder",
      name: "Rename dataview folder",
      callback: () => {
        void runRenameDataviewFolder(this).catch((error: unknown) => {
          this.handleCommandError("rename-dataview-folder", error);
        });
      },
    });

    this.addCommand({
      id: "refresh-dataview-expansion",
      name: "Refresh dataview expansion",
      callback: () => {
        void this.dataviewExpansionService.refreshActiveFile(true).catch((error: unknown) => {
          this.handleCommandError("refresh-dataview-expansion", error);
        });
      },
    });

    this.addCommand({
      id: "refresh-dataview-expansion-current-folder",
      name: "Refresh dataview expansion in current folder",
      callback: () => {
        void this.dataviewExpansionService.refreshCurrentFolder(true).catch((error: unknown) => {
          this.handleCommandError("refresh-dataview-expansion-current-folder", error);
        });
      },
    });

    this.addCommand({
      id: "refresh-dataview-expansion-whole-vault",
      name: "Refresh dataview expansion in whole vault",
      callback: () => {
        void this.dataviewExpansionService.refreshWholeVault(true).catch((error: unknown) => {
          this.handleCommandError("refresh-dataview-expansion-whole-vault", error);
        });
      },
    });

    this.addCommand({
      id: "install-documentation",
      name: "Install documentation",
      callback: () => {
        void installVaultForgeDocumentation(this.app, this.settings).catch((error: unknown) => {
          this.handleCommandError("install-documentation", error);
        });
      },
    });

    this.addCommand({
      id: "export-vault-overview",
      name: "Export vault overview",
      callback: () => {
        void runExportOverview(this).catch((error: unknown) => {
          this.handleCommandError("export-vault-overview", error);
        });
      },
    });

    this.addCommand({
      id: "export-vault-snapshot",
      name: "Export vault snapshot",
      callback: () => {
        void runExportOverview(this).catch((error: unknown) => {
          this.handleCommandError("export-vault-snapshot", error);
        });
      },
    });

    this.addCommand({
      id: "export-ontology-index",
      name: "Export ontology index",
      callback: () => {
        void runExportOntology(this).catch((error: unknown) => {
          this.handleCommandError("export-ontology-index", error);
        });
      },
    });

    this.addCommand({
      id: "refresh-ontology-metrics",
      name: "Refresh ontology metrics",
      callback: () => {
        void (async () => {
          try {
            await this.ontologyService.collectMetrics("refresh-vault-health-dashboard");
            await this.recomposeHealthDashboard();
            new Notice("Forge: Ontology metrics refreshed.", 4000);
          } catch (error) {
            this.handleCommandError("refresh-ontology-metrics", error);
          }
        })();
      },
    });

    this.addCommand({
      id: "refine-shapes",
      name: "Refine shape templates",
      callback: () => {
        void runRefineShapes(this).catch((error: unknown) => {
          this.handleCommandError("refine-shapes", error);
        });
      },
    });

    this.addCommand({
      id: "run-shape-lint",
      name: "Run shape lint",
      callback: () => {
        void runShapeLint(this).catch((error: unknown) => {
          this.handleCommandError("run-shape-lint", error);
        });
      },
    });

    this.addCommand({
      id: "shape-repair",
      name: "Run shape repair",
      callback: () => {
        void runShapeRepair(this).catch((error: unknown) => {
          this.handleCommandError("shape-repair", error);
        });
      },
    });

    this.addCommand({
      id: "shape-repair-dry-run",
      name: "Run shape repair (dry run)",
      callback: () => {
        void runShapeRepair(this, true).catch((error: unknown) => {
          this.handleCommandError("shape-repair-dry-run", error);
        });
      },
    });

    this.addCommand({
      id: "open-vault-health-dashboard",
      name: "Open vault health dashboard",
      callback: () => {
        void this.openHealthDashboard().catch((error: unknown) => {
          this.handleCommandError("open-vault-health-dashboard", error);
        });
      },
    });

    this.addCommand({
      id: "refresh-vault-health-dashboard",
      name: "Refresh vault health dashboard",
      callback: () => {
        void (async () => {
          try {
            await this.dashboardService.refreshSnapshot();
            new Notice("Forge: Vault health dashboard refreshed.", 4000);
          } catch (error) {
            this.handleCommandError("refresh-vault-health-dashboard", error);
          }
        })();
      },
    });

    this.addCommand({
      id: "export-dashboard-snapshot",
      name: "Export dashboard snapshot",
      callback: () => {
        void (async () => {
          try {
            const path = await this.dashboardService.exportSnapshot();
            new Notice(`Forge: Dashboard snapshot exported to ${path}`, 6000);
          } catch (error) {
            this.handleCommandError("export-dashboard-snapshot", error);
          }
        })();
      },
    });

    this.addCommand({
      id: "view-patch-history",
      name: "View patch history",
      callback: () => {
        void (async () => {
          try {
            await this.patchHistoryService.readHistory("patch-history");
            await this.recomposeHealthDashboard();
            await this.openHealthDashboard();
            new Notice("Forge: Patch history refreshed in the dashboard.", 5000);
          } catch (error) {
            this.handleCommandError("view-patch-history", error);
          }
        })();
      },
    });

    this.addCommand({
      id: "view-last-run",
      name: "View last run",
      callback: () => {
        void (async () => {
          try {
            const run = await this.dashboardService.latestOperationalRun();
            if (!run) {
              new Notice("Forge: No operational runs have been recorded yet.", 5000);
              return;
            }
            new Notice(
              `Forge: Last run was ${formatCommandName(run.command)}. Status: ${run.status}. Applied ${run.applied_items} item(s), with ${run.errors.length} error(s).`,
              7000
            );
          } catch (error) {
            this.handleCommandError("view-last-run", error);
          }
        })();
      },
    });

    this.addSettingTab(new ForgeSettingsTab(this.app, this));

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        this.dataviewExpansionService.onFileModified(file);
        this.activeFileLintService.onFileModified(file);
      })
    );

    this.registerEvent(
      this.app.workspace.on("editor-change", (_editor, info) => {
        this.activeFileLintService.onEditorChanged(info.file);
      })
    );

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.dataviewExpansionService.onFileOpened(file);
        this.activeFileLintService.onFileOpened(file);
      })
    );

    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.activeFileLintService.onLayoutChanged();
      })
    );

    // Defer all vault file access until the workspace layout is ready.
    // On iOS, the vault adapter is not fully mounted when onload() fires
    // on a cold start — accessing files here causes the plugin to fail.
    // onLayoutReady() is a no-op if layout is already ready (e.g. on re-enable).
    this.app.workspace.onLayoutReady(() => {
      // Warm schema cache — retry once after 3s if vault not ready yet (iOS sync delay)
      void this.schemaCache.refresh().catch(() => {
        window.setTimeout(() => {
          void this.schemaCache.refresh().catch((error: unknown) => {
            console.warn("[Forge] Schema cache retry failed:", error);
          });
        }, 3000);
      });
      void this.ensureHealthDashboardPanel().catch((error: unknown) => {
        console.warn("[Forge] Could not preload health dashboard panel:", error);
      });
    });

  }

  onunload(): void {
  }

  async openHealthDashboard(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(FORGE_HEALTH_DASHBOARD_VIEW);
    if (leaves.length > 0) {
      void this.app.workspace.revealLeaf(leaves[0]);
      return;
    }

    const leaf = await this.app.workspace.ensureSideLeaf(FORGE_HEALTH_DASHBOARD_VIEW, "right", {
      active: true,
      reveal: true,
      split: false,
    });
    void this.app.workspace.revealLeaf(leaf);
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
    const setting = (this.app as AppWithSettingsManager).setting;
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
      await this.reloadHealthDashboardViewsFromCache();
    } catch (e) {
      console.warn("[Forge] Could not recompose health dashboard:", e);
    }
  }

  renderHealthDashboardViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(FORGE_HEALTH_DASHBOARD_VIEW);
    for (const leaf of leaves) {
      if (leaf.view instanceof ForgeHealthDashboardView) {
        leaf.view.render();
      }
    }
  }

  async reloadHealthDashboardViewsFromCache(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(FORGE_HEALTH_DASHBOARD_VIEW);
    for (const leaf of leaves) {
      if (leaf.view instanceof ForgeHealthDashboardView) {
        await leaf.view.reloadFromCache();
      }
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
    if (this.activeFileLintService) this.activeFileLintService.updateSettings(this.settings);
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

  return loaded;
}

function settingsForPersistence(settings: ForgeSettings): Partial<ForgeSettings> {
  const persisted = { ...settings };
  delete (persisted as Partial<ForgeSettings>).dataviewExpansionAutoUpdateMode;
  return persisted;
}
