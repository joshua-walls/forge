import { App, TFile, normalizePath } from "obsidian";
import { DashboardCache } from "./dashboard_cache";
import {
  DASHBOARD_CACHE_SCHEMA_VERSION,
  type DashboardIssue,
  type DashboardSnapshot,
  type DashboardSummary,
  type OperationalRunSummary,
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
    const refreshContext = {
      app: this.app,
      settings: this.settings,
      ontologyService: this.services.ontologyService,
      recomposeHealthDashboard: async () => {},
    } as ForgePlugin;

    const lintResult = await this.services.lintService.runLint("refresh-vault-health-dashboard");
    if (lintResult) {
      await writeLintReportJson(this.app, this.settings, lintResult);
      await appendLintHistory(this.app, this.settings, lintResult);
      await writeLintRunNote(this.app, this.settings, lintResult);
    }

    await this.services.schemaService.validate("refresh-vault-health-dashboard");

    if (this.settings.shapeLintEnabled) {
      const shapeLintResult = await this.services.shapeLintService.runShapeLint("refresh-vault-health-dashboard");
      await writeShapeLintReportJson(this.app, this.settings, shapeLintResult);
      await writeShapeLintRunNote(this.app, this.settings, shapeLintResult);
    }

    if (this.settings.exportEnabled) {
      await runExportOverview(refreshContext, { silent: true });
      await runExportOntology(refreshContext, {
        silent: true,
        refreshMetrics: false,
        refreshDashboard: false,
      });
    }

    await this.services.ontologyService.collectMetrics("refresh-vault-health-dashboard");

    await this.services.patchHistoryService.readHistory("refresh-vault-health-dashboard");

    if (this.settings.maintenanceAutoRunOnDashboardRefresh) {
      const maintenanceStarted = Date.now();
      const maintenanceResults = await runVaultMaintenanceSilently(this.app, this.settings);
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

    return this.composeSnapshotFromLatest(Date.now() - started);
  }

  async composeSnapshotFromLatest(durationMs = 0): Promise<DashboardSnapshot> {
    const cache = await this.cache.read();
    const latestLint = cache.latest_lint_result;
    const latestSchema = cache.latest_schema_result;
    const latestOntology = cache.latest_ontology_result;
    const latestShapeLint = cache.latest_shape_lint_result;
    const latestPatchHistory = cache.latest_patch_history_result;

    const issues: DashboardIssue[] = [
      ...(latestLint?.issues ?? []),
      ...(latestSchema?.violations ?? []),
    ].sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity));

    const summary: DashboardSummary = {
      notes_scanned: latestLint?.files_scanned ?? 0,
      lint_issue_count: latestLint?.issues.length ?? 0,
      schema_violation_count: latestSchema?.violations.length ?? 0,
      broken_shape_count: latestShapeLint?.issues.length ?? 0,
      invalid_frontmatter_count: latestLint?.issues.filter((issue) =>
        ["no_frontmatter", "required_field", "type_mismatch", "enum_value", "date_format"].includes(issue.issue_type)
      ).length ?? 0,
      normalization_candidates: null,
      unresolved_links: null,
    };

    const snapshot: DashboardSnapshot = {
      schema_version: DASHBOARD_CACHE_SCHEMA_VERSION,
      source_command: "refresh-vault-health-dashboard",
      generated_at: new Date().toISOString(),
      duration_ms: durationMs,
      vault_name: this.app.vault.getName(),
      summary,
      issues,
      lint: latestLint,
      schema: latestSchema,
      ontology: latestOntology,
      shape_lint: latestShapeLint,
      patch_history: latestPatchHistory,
    };

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

function severityWeight(severity: DashboardIssue["severity"]): number {
  switch (severity) {
    case "critical":
      return 3;
    case "warning":
      return 2;
    default:
      return 1;
  }
}
