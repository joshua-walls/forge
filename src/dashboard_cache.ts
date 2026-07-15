import { App, TFile, normalizePath } from "obsidian";
import type { ForgeSettings } from "./settings";
import { getVaultPaths } from "./vault-paths";
import { ensureFolder } from "./utils/files";
import {
  DASHBOARD_CACHE_SCHEMA_VERSION,
  DashboardCacheFile,
  DashboardSnapshot,
  LintScanResult,
  OntologyMetricsResult,
  OperationalRunSummary,
  PatchHistoryResult,
  SchemaValidationResult,
  ShapeLintResult,
  VaultFileInventoryResult,
} from "./dashboard_types";

type CacheLeaf =
  | { key: "latest_lint_result"; value: LintScanResult | null }
  | { key: "latest_schema_result"; value: SchemaValidationResult | null }
  | { key: "latest_ontology_result"; value: OntologyMetricsResult | null }
  | { key: "latest_file_inventory_result"; value: VaultFileInventoryResult | null }
  | { key: "latest_shape_lint_result"; value: ShapeLintResult | null }
  | { key: "latest_patch_history_result"; value: PatchHistoryResult | null }
  | { key: "operational_history"; value: OperationalRunSummary[] | null }
  | { key: "dashboard_snapshot"; value: DashboardSnapshot | null };

export class DashboardCache {
  constructor(
    private app: App,
    private settings: ForgeSettings,
    private forgeVersion: string = "unknown"
  ) {}

  get path(): string {
    const paths = getVaultPaths(this.settings);
    return normalizePath(`${paths.forge}/health-dashboard.json`);
  }

  async read(): Promise<DashboardCacheFile> {
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (!(file instanceof TFile)) return emptyDashboardCache();

    try {
      const raw = await this.app.vault.read(file);
      const parsed: Partial<DashboardCacheFile> = JSON.parse(raw) as Partial<DashboardCacheFile>;
      if (
        "operational_history" in parsed &&
        parsed.operational_history !== null &&
        !Array.isArray(parsed.operational_history)
      ) {
        console.warn("[Forge] Ignoring malformed dashboard operational_history cache leaf.");
        parsed.operational_history = null;
      }
      return {
        ...emptyDashboardCache(),
        ...parsed,
        schema_version: DASHBOARD_CACHE_SCHEMA_VERSION,
      };
    } catch {
      return emptyDashboardCache();
    }
  }

  async write(cache: DashboardCacheFile): Promise<void> {
    const paths = getVaultPaths(this.settings);
    await ensureFolder(this.app, paths.forge);

    const content = JSON.stringify(
      {
        ...cache,
        schema_version: DASHBOARD_CACHE_SCHEMA_VERSION,
        forge_version: this.forgeVersion,
      },
      null,
      2
    );
    const existing = this.app.vault.getAbstractFileByPath(this.path);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(this.path, content);
    }
  }

  async updateLeaf(leaf: CacheLeaf): Promise<DashboardCacheFile> {
    const cache = await this.read();
    const next = { ...cache, [leaf.key]: leaf.value };
    await this.write(next);
    return next;
  }

  async appendOperationalRun(run: OperationalRunSummary, maxEntries = 10): Promise<DashboardCacheFile> {
    const cache = await this.read();
    const history = Array.isArray(cache.operational_history)
      ? cache.operational_history
      : [];
    const nextHistory = [run, ...history].slice(0, maxEntries);
    return this.updateLeaf({ key: "operational_history", value: nextHistory });
  }
}

export function emptyDashboardCache(): DashboardCacheFile {
  return {
    schema_version: DASHBOARD_CACHE_SCHEMA_VERSION,
    forge_version: "unknown",
    latest_lint_result: null,
    latest_schema_result: null,
    latest_ontology_result: null,
    latest_file_inventory_result: null,
    latest_shape_lint_result: null,
    latest_patch_history_result: null,
    operational_history: null,
    dashboard_snapshot: null,
  };
}
