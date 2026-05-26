import { App, TFile, normalizePath } from "obsidian";
import { DashboardCache } from "./dashboard_cache";
import {
  DASHBOARD_CACHE_SCHEMA_VERSION,
  type DashboardIssue,
  type DashboardSnapshot,
  type DashboardSummary,
} from "./dashboard_types";
import type { LintService } from "./lint_service";
import type { OntologyService } from "./ontology_service";
import type { PatchHistoryService } from "./patch_history_service";
import type { SchemaService } from "./schema_service";
import type { ForgeSettings } from "./settings";
import { getVaultPaths } from "./vault-paths";
import { ensureFolder } from "./utils/files";

interface DashboardServices {
  lintService: LintService;
  schemaService: SchemaService;
  ontologyService: OntologyService;
  patchHistoryService: PatchHistoryService;
}

export class DashboardService {
  private cache: DashboardCache;

  constructor(
    private app: App,
    private settings: ForgeSettings,
    private services: DashboardServices
  ) {
    this.cache = new DashboardCache(app, settings);
  }

  async loadSnapshot(): Promise<DashboardSnapshot | null> {
    return (await this.cache.read()).dashboard_snapshot;
  }

  async refreshSnapshot(): Promise<DashboardSnapshot> {
    const started = Date.now();

    await this.services.lintService.runLint("refresh-vault-health-dashboard");
    await this.services.schemaService.validate("refresh-vault-health-dashboard");
    await this.services.ontologyService.collectMetrics("refresh-vault-health-dashboard");
    await this.services.patchHistoryService.readHistory("refresh-vault-health-dashboard");

    return this.composeSnapshotFromLatest(Date.now() - started);
  }

  async composeSnapshotFromLatest(durationMs = 0): Promise<DashboardSnapshot> {
    const cache = await this.cache.read();
    const latestLint = cache.latest_lint_result;
    const latestSchema = cache.latest_schema_result;
    const latestOntology = cache.latest_ontology_result;
    const latestPatchHistory = cache.latest_patch_history_result;

    const issues: DashboardIssue[] = [
      ...(latestLint?.issues ?? []),
      ...(latestSchema?.violations ?? []),
    ].sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity));

    const summary: DashboardSummary = {
      notes_scanned: latestLint?.files_scanned ?? 0,
      lint_issue_count: latestLint?.issues.length ?? 0,
      schema_violation_count: latestSchema?.violations.length ?? 0,
      broken_shape_count: latestLint?.issues.filter((issue) => issue.issue_type.startsWith("shape_")).length ?? 0,
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
