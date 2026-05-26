import { App } from "obsidian";
import type { ForgeSettings } from "./settings";
import { runLint, type LintRunResult } from "./lint-engine";
import { DashboardCache } from "./dashboard_cache";
import {
  DASHBOARD_CACHE_SCHEMA_VERSION,
  lintResultToDashboardIssue,
  type LintScanResult,
} from "./dashboard_types";

export class LintService {
  private cache: DashboardCache;

  constructor(private app: App, private settings: ForgeSettings) {
    this.cache = new DashboardCache(app, settings);
  }

  async runLint(
    sourceCommand: LintScanResult["source_command"] = "run-vault-lint"
  ): Promise<LintRunResult | null> {
    const started = Date.now();
    const result = await runLint(this.app, this.settings);
    if (!result) return null;

    await this.updateCacheSafely({
      key: "latest_lint_result",
      value: this.toDashboardResult(result, sourceCommand, Date.now() - started),
    });

    return result;
  }

  async latest(): Promise<LintScanResult | null> {
    return (await this.cache.read()).latest_lint_result;
  }

  private toDashboardResult(
    result: LintRunResult,
    sourceCommand: LintScanResult["source_command"],
    durationMs: number
  ): LintScanResult {
    return {
      schema_version: DASHBOARD_CACHE_SCHEMA_VERSION,
      source_command: sourceCommand,
      generated_at: result.envelope.timestamp,
      duration_ms: durationMs,
      files_scanned: result.envelope.notes_scanned,
      issues: result.results.map((issue) => ({
        ...lintResultToDashboardIssue(issue),
        source_command: sourceCommand,
      })),
      errors: result.errors.length,
      warnings: result.warnings.length,
      infos: result.infos.length,
    };
  }

  private async updateCacheSafely(...args: Parameters<DashboardCache["updateLeaf"]>): Promise<void> {
    try {
      await this.cache.updateLeaf(...args);
    } catch (e) {
      console.warn("[Forge] Could not update dashboard lint cache:", e);
    }
  }
}
