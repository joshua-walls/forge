import { App, TFile, normalizePath } from "obsidian";
import { DashboardCache } from "./dashboard_cache";
import {
  buildDashboardSnapshot,
  buildVaultFileInventory,
  type DashboardSnapshot,
  type OperationalRunSummary,
  type VaultFileRecord,
} from "./dashboard_types";
import type { LintService } from "./lint_service";
import type { OntologyService } from "./ontology_service";
import type { PatchHistoryService } from "./patch_history_service";
import type { SchemaService } from "./schema_service";
import type { ShapeLintService } from "./shape_lint_service";
import type { ForgeSettings } from "./settings";
import { getVaultPaths } from "./vault-paths";
import { ensureFolder } from "./utils/files";
import {
  appendLintHistory,
  writeLintReportJson,
  writeLintRunNote,
} from "./lint-writers";
import {
  writeShapeLintReportJson,
  writeShapeLintRunNote,
} from "./shape_lint_writers";
import { runExportOverview } from "./commands/export-overview";
import { runExportOntology } from "./commands/export-ontology";
import { runVaultMaintenanceSilently } from "./commands/maintenance";
import type ForgePlugin from "./main";

interface DashboardServices {
  lintService: LintService;
  schemaService: SchemaService;
  ontologyService: OntologyService;
  shapeLintService: ShapeLintService;
  patchHistoryService: PatchHistoryService;
}

export class DashboardService {
  private cache: DashboardCache;

  constructor(
    private app: App,
    private settings: ForgeSettings,
    private services: DashboardServices,
    forgeVersion = "unknown"
  ) {
    this.cache = new DashboardCache(app, settings, forgeVersion);
  }

  // Exposed so ForgeHealthDashboardView can register the file watcher
  // without importing vault-paths directly.
  get cachePath(): string {
    return this.cache.path;
  }

  async loadSnapshot(): Promise<DashboardSnapshot | null> {
    return (await this.cache.read()).dashboard_snapshot;
  }

  async recordOperationalRun(run: OperationalRunSummary): Promise<void> {
    try {
      await this.cache.appendOperationalRun(run);
    } catch (e) {
      console.warn("[Forge] Could not update dashboard operational history:", e);
    }
  }

  async latestOperationalRun(): Promise<OperationalRunSummary | null> {
    const history = (await this.cache.read()).operational_history;
    return Array.isArray(history) ? history[0] ?? null : null;
  }

  async refreshSnapshot(): Promise<DashboardSnapshot> {
    const started = Date.now();
    const maintenanceStarted = this.settings.maintenanceAutoRunOnDashboardRefresh ? Date.now() : 0;
    const maintenanceResults: Awaited<ReturnType<typeof runVaultMaintenanceSilently>> = [];
    const refreshContext = {
      app: this.app,
      settings: this.settings,
      ontologyService: this.services.ontologyService,
      recomposeHealthDashboard: async () => {},
    } as ForgePlugin;

    await this.services.schemaService.validate("refresh-vault-health-dashboard");

    if (this.settings.maintenanceAutoRunOnDashboardRefresh) {
      maintenanceResults.push(...await runVaultMaintenanceSilently(this.app, this.settings, "pre_scan"));
    }

    const lintResult = await this.services.lintService.runLint("refresh-vault-health-dashboard");
    if (lintResult) {
      await writeLintReportJson(this.app, this.settings, lintResult);
      await appendLintHistory(this.app, this.settings, lintResult);
      await writeLintRunNote(this.app, this.settings, lintResult);
    }

    if (this.settings.shapesEnabled && this.settings.shapeLintEnabled) {
      const shapeLintResult = await this.services.shapeLintService.runShapeLint("refresh-vault-health-dashboard");
      await writeShapeLintReportJson(this.app, this.settings, shapeLintResult);
      await writeShapeLintRunNote(this.app, this.settings, shapeLintResult);
    }

    if (this.settings.exportEnabled && this.settings.dashboardRefreshExportsEnabled) {
      await runExportOverview(refreshContext, { silent: true });
      await runExportOntology(refreshContext, {
        silent: true,
        refreshMetrics: false,
        refreshDashboard: false,
      });
    }

    await this.services.ontologyService.collectMetrics("refresh-vault-health-dashboard");

    if (this.settings.maintenanceAutoRunOnDashboardRefresh) {
      maintenanceResults.push(...await runVaultMaintenanceSilently(this.app, this.settings, "post_output"));
      const applied = maintenanceResults.filter((r) => r.status === "removed" || r.status === "trimmed").length;
      const errors = maintenanceResults.filter((r) => r.status === "error");
      await this.recordOperationalRun({
        command: "maintenance",
        status: errors.length > 0 ? "partial" : "success",
        started_at: new Date(maintenanceStarted).toISOString(),
        duration_ms: Date.now() - maintenanceStarted,
        affected_files: applied,
        applied_items: applied,
        warnings: [],
        errors: errors.map((r) => `${r.target}: ${r.detail}`),
      });
    }

    await this.services.patchHistoryService.readHistory("refresh-vault-health-dashboard");

    return this.composeSnapshotFromLatest(Date.now() - started);
  }

  async composeSnapshotFromLatest(durationMs = 0): Promise<DashboardSnapshot> {
    const cache = await this.cache.read();
    const latestLint = cache.latest_lint_result;
    const latestSchema = cache.latest_schema_result;
    const latestOntology = cache.latest_ontology_result;
    const latestFileInventory = this.settings.dashboardFileInventoryEnabled
      ? buildVaultFileInventory({
        files: this.app.vault.getFiles().map(toVaultFileRecord),
      })
      : null;
    const latestShapeLint = this.settings.shapesEnabled && this.settings.shapeLintEnabled
      ? cache.latest_shape_lint_result
      : null;
    const latestPatchHistory = cache.latest_patch_history_result;

    const snapshot = buildDashboardSnapshot({
      vaultName: this.app.vault.getName(),
      durationMs,
      lint: latestLint,
      schema: latestSchema,
      ontology: latestOntology,
      fileInventory: latestFileInventory,
      shapeLint: latestShapeLint,
      patchHistory: latestPatchHistory,
    });

    await this.cache.updateLeaf({ key: "latest_file_inventory_result", value: latestFileInventory });
    await this.cache.updateLeaf({ key: "dashboard_snapshot", value: snapshot });
    return snapshot;
  }

  async exportSnapshot(): Promise<string> {
    const snapshot = await this.loadSnapshot() ?? await this.refreshSnapshot();
    const paths = getVaultPaths(this.settings);
    await ensureFolder(this.app, paths.exports);

    const exportPath = normalizePath(`${paths.exports}/vault-health-dashboard-snapshot.json`);
    const content = JSON.stringify(snapshot, null, 2);
    const existing = this.app.vault.getAbstractFileByPath(exportPath);

    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(exportPath, content);
    }

    return exportPath;
  }
}

function toVaultFileRecord(file: TFile): VaultFileRecord {
  return {
    path: file.path,
    extension: file.extension,
    size_bytes: file.stat.size,
  };
}
