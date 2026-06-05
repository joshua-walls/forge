import { App, TFile, normalizePath } from "obsidian";
import type { ForgeSettings } from "./settings";
import { getVaultPaths } from "./vault-paths";
import { DashboardCache } from "./dashboard_cache";
import {
  DASHBOARD_CACHE_SCHEMA_VERSION,
  type OperationalRunSummary,
  type PatchHistoryResult,
  type PatchRunSummary,
} from "./dashboard_types";

interface PatchManifest {
  manifest_version?: number;
  run_id?: string;
  patch_file?: string;
  description?: string;
  applied_at?: string;
  schema_version?: string;
  changes?: unknown[];
  operations?: unknown[];
}

interface RepairHistoryEntry {
  ranAt?: string;
  repaired?: number;
}

function isRepairHistoryEntry(value: unknown): value is RepairHistoryEntry {
  return typeof value === "object" && value !== null;
}

export class PatchHistoryService {
  private cache: DashboardCache;

  constructor(private app: App, private settings: ForgeSettings, forgeVersion = "unknown") {
    this.cache = new DashboardCache(app, settings, forgeVersion);
  }

  async readHistory(
    sourceCommand: PatchHistoryResult["source_command"] = "patch-history"
  ): Promise<PatchHistoryResult> {
    const started = Date.now();
    const paths = getVaultPaths(this.settings);
    const manifests = await this.readPatchManifests(paths.patchReports);
    const lintScans = await this.countLintScans(paths.lintHistoryJson);
    const operationalHistory = await this.readOperationalHistory();
    const repairRuns = await this.readRepairRuns(paths.shapeRepairHistory);

    const result: PatchHistoryResult = {
      schema_version: DASHBOARD_CACHE_SCHEMA_VERSION,
      source_command: sourceCommand,
      generated_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      last_patch_run: manifests[0] ?? null,
      last_repair_run: repairRuns[0] ?? operationalRunToPatchSummary(operationalHistory, "repair"),
      restored_runs_available: manifests.length,
      last_normalization_run: operationalRunToPatchSummary(operationalHistory, "normalization"),
      lint_scans: lintScans,
    };

    try {
      await this.cache.updateLeaf({ key: "latest_patch_history_result", value: result });
    } catch (e) {
      console.warn("[Forge] Could not update dashboard patch history cache:", e);
    }
    return result;
  }

  async latest(): Promise<PatchHistoryResult | null> {
    return (await this.cache.read()).latest_patch_history_result;
  }

  private async readPatchManifests(folder: string): Promise<PatchRunSummary[]> {
    const prefix = normalizePath(folder).replace(/\/$/, "");
    const manifestFiles = this.app.vault.getFiles()
      .filter((file) => file.path.startsWith(prefix + "/") && file.name.endsWith("-patch-manifest.json"))
      .sort((a, b) => b.name.localeCompare(a.name));

    const manifests: PatchRunSummary[] = [];

    for (const file of manifestFiles) {
      try {
        const parsed = JSON.parse(await this.app.vault.read(file)) as PatchManifest;
        manifests.push({
          run_id: parsed.run_id ?? file.basename,
          description: parsed.description ?? "",
          applied_at: parsed.applied_at ?? "",
          changed_files: Array.isArray(parsed.changes) ? parsed.changes.length : 0,
          changed_operations: Array.isArray(parsed.operations) ? parsed.operations.length : undefined,
          patch_file: parsed.patch_file,
          schema_version: parsed.schema_version,
        });
      } catch {
        // Ignore unreadable history artifacts.
      }
    }

    return manifests.sort((a, b) => (b.applied_at || b.run_id).localeCompare(a.applied_at || a.run_id));
  }

  private async countLintScans(path: string): Promise<number> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) return 0;

    try {
      const parsed: unknown = JSON.parse(await this.app.vault.read(file));
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }

  private async readOperationalHistory(): Promise<OperationalRunSummary[]> {
    try {
      const history = (await this.cache.read()).operational_history;
      return Array.isArray(history) ? history : [];
    } catch {
      return [];
    }
  }

  private async readRepairRuns(path: string): Promise<PatchRunSummary[]> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) return [];

    try {
      const parsed: unknown = JSON.parse(await this.app.vault.read(file));
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter(isRepairHistoryEntry)
        .map((entry): PatchRunSummary | null => {
          const ranAt = typeof entry.ranAt === "string" ? entry.ranAt : "";
          if (!ranAt) return null;
          return {
            run_id: ranAt,
            description: "Shape repair",
            applied_at: ranAt,
            changed_files: Number(entry.repaired ?? 0),
            changed_operations: Number(entry.repaired ?? 0),
          };
        })
        .filter((entry): entry is PatchRunSummary => entry !== null)
        .sort((a, b) => b.applied_at.localeCompare(a.applied_at));
    } catch {
      return [];
    }
  }
}

function operationalRunToPatchSummary(
  history: OperationalRunSummary[],
  command: OperationalRunSummary["command"]
): PatchRunSummary | null {
  const run = history.find((entry) => entry.command === command);
  if (!run) return null;

  return {
    run_id: `${run.command}-${run.started_at}`,
    description: run.command.replace(/_/g, " "),
    applied_at: run.started_at,
    changed_files: run.affected_files,
    changed_operations: run.applied_items,
  };
}
