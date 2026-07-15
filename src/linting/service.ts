import { App } from "obsidian";
import type { ForgeSettings } from "../config/settings";
import { runLint, runLintForFile, type LintRunResult } from "./engine";
import { DashboardCache } from "../dashboard/cache";
import {
  buildLintScanResult,
  type LintScanResult,
} from "../dashboard/types";

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
      value: buildLintScanResult(result, sourceCommand, Date.now() - started),
    });

    return result;
  }

  async runLintForFile(
    file: Parameters<typeof runLintForFile>[2],
    options: { sourceCommand?: string; updateDashboardCache?: boolean } = {}
  ): Promise<LintRunResult | null> {
    const started = Date.now();
    const result = await runLintForFile(this.app, this.settings, file);
    if (!result) return null;

    if (options.updateDashboardCache) {
      await this.updateCacheSafely({
        key: "latest_lint_result",
        value: buildLintScanResult(
          result,
          (options.sourceCommand as LintScanResult["source_command"]) ?? "run-vault-lint",
          Date.now() - started
        ),
      });
    }

    return result;
  }

  async latest(): Promise<LintScanResult | null> {
    return (await this.cache.read()).latest_lint_result;
  }

  private async updateCacheSafely(...args: Parameters<DashboardCache["updateLeaf"]>): Promise<void> {
    try {
      await this.cache.updateLeaf(...args);
    } catch (e) {
      console.warn("[Forge] Could not update dashboard lint cache:", e);
    }
  }
}
