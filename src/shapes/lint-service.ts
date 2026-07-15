import { App, TFile } from "obsidian";
import type { ForgeSettings } from "../config/settings";
import type { LintResult } from "../linting/engine";
import { DashboardCache } from "../dashboard/cache";
import {
  buildShapeLintResult,
  type ShapeLintResult,
} from "../dashboard/types";
import { buildShapeLintExemptList } from "../vault/paths";
import { getMarkdownFiles, isExempt, isMarkdownFile, localTimestamp } from "../utils/files";
import { loadSchema } from "../utils/schema";
import {
  buildShapeHeadingCache,
  lintShapeHeadings,
} from "../commands/shape-lint";

export interface ShapeLintRunEnvelope {
  vault_path: string;
  timestamp: string;
  schema_version: string;
  notes_scanned: number;
}

export interface ShapeLintRunResult {
  envelope: ShapeLintRunEnvelope;
  results: LintResult[];
  errors: LintResult[];
  warnings: LintResult[];
  infos: LintResult[];
}

interface VaultAdapterWithBasePath {
  basePath?: string;
}

export class ShapeLintService {
  private cache: DashboardCache;

  constructor(private app: App, private settings: ForgeSettings) {
    this.cache = new DashboardCache(app, settings);
  }

  async runShapeLint(
    sourceCommand: ShapeLintResult["source_command"] = "run-shape-lint"
  ): Promise<ShapeLintRunResult> {
    const started = Date.now();
    const result = await this.scan();

    await this.updateCacheSafely({
      key: "latest_shape_lint_result",
      value: buildShapeLintResult(result, sourceCommand, Date.now() - started),
    });

    return result;
  }

  async runShapeLintForFile(file: TFile): Promise<ShapeLintRunResult> {
    return this.scan([file]);
  }

  async latest(): Promise<ShapeLintResult | null> {
    return (await this.cache.read()).latest_shape_lint_result;
  }

  private async scan(files?: TFile[]): Promise<ShapeLintRunResult> {
    const schema = await loadSchema(this.app, this.settings);
    const exemptPaths = buildShapeLintExemptList(this.settings, schema?.exempt_paths ?? []);
    const candidateFiles = (files ?? getMarkdownFiles(this.app)).filter(
      isMarkdownFile
    ).filter(
      (file) => !isExempt(file.path, exemptPaths)
    );

    const shapeLintActive = this.settings.shapesEnabled && this.settings.shapeLintEnabled;
    const headingCache: Map<string, import("../commands/shape-lint").ParsedHeading[]> = shapeLintActive
      ? await buildShapeHeadingCache(this.app, this.settings)
      : new Map<string, import("../commands/shape-lint").ParsedHeading[]>();

    const results: LintResult[] = [];

    if (shapeLintActive && headingCache.size > 0) {
      for (const file of candidateFiles) {
        const content = await this.app.vault.read(file);
        results.push(...await lintShapeHeadings(
          this.app,
          file,
          content,
          this.settings,
          headingCache
        ));
      }
    }

    return {
      envelope: {
        vault_path: (this.app.vault.adapter as VaultAdapterWithBasePath).basePath ?? "",
        timestamp: localTimestamp(),
        schema_version: schema?.version ?? "",
        notes_scanned: candidateFiles.length,
      },
      results,
      errors: results.filter((r) => r.severity === "error"),
      warnings: results.filter((r) => r.severity === "warning"),
      infos: results.filter((r) => r.severity === "info"),
    };
  }

  private async updateCacheSafely(...args: Parameters<DashboardCache["updateLeaf"]>): Promise<void> {
    try {
      await this.cache.updateLeaf(...args);
    } catch (e) {
      console.warn("[Forge] Could not update dashboard shape lint cache:", e);
    }
  }
}
