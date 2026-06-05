import { App } from "obsidian";
import type { ForgeSettings } from "./settings";
import type { LintResult } from "./lint-engine";
import { DashboardCache } from "./dashboard_cache";
import {
  DASHBOARD_CACHE_SCHEMA_VERSION,
  lintResultToDashboardIssue,
  type ShapeLintResult,
  type ShapeLintSummary,
} from "./dashboard_types";
import { getVaultPaths } from "./vault-paths";
import { buildExemptList, getMarkdownFiles, isExempt, localTimestamp } from "./utils/files";
import { loadSchema } from "./utils/schema";
import {
  buildShapeHeadingCache,
  lintShapeHeadings,
} from "./commands/shape-lint";

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
      value: this.toDashboardResult(result, sourceCommand, Date.now() - started),
    });

    return result;
  }

  async latest(): Promise<ShapeLintResult | null> {
    return (await this.cache.read()).latest_shape_lint_result;
  }

  private async scan(): Promise<ShapeLintRunResult> {
    const paths = getVaultPaths(this.settings);
    const schema = await loadSchema(this.app, this.settings);
    const exemptPaths = buildExemptList(
      schema?.exempt_paths ?? [],
      paths.forge,
      this.settings.shapeLintExcludeInboxFolder ? [this.settings.inboxFolder] : []
    );
    const files = getMarkdownFiles(this.app).filter(
      (file) => !isExempt(file.path, exemptPaths)
    );

    const headingCache: Map<string, import("./commands/shape-lint").ParsedHeading[]> = this.settings.shapeLintEnabled
      ? await buildShapeHeadingCache(this.app, this.settings)
      : new Map<string, import("./commands/shape-lint").ParsedHeading[]>();

    const results: LintResult[] = [];

    if (this.settings.shapeLintEnabled && headingCache.size > 0) {
      for (const file of files) {
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
        notes_scanned: files.length,
      },
      results,
      errors: results.filter((r) => r.severity === "error"),
      warnings: results.filter((r) => r.severity === "warning"),
      infos: results.filter((r) => r.severity === "info"),
    };
  }

  private toDashboardResult(
    result: ShapeLintRunResult,
    sourceCommand: ShapeLintResult["source_command"],
    durationMs: number
  ): ShapeLintResult {
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
      summary: buildSummary(result.results, result.envelope.notes_scanned),
      errors: result.errors.length,
      warnings: result.warnings.length,
      infos: result.infos.length,
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

function buildSummary(results: LintResult[], filesScanned: number): ShapeLintSummary {
  return {
    files_scanned: filesScanned,
    issue_count: results.length,
    missing_heading_count: countRule(results, "shape_heading_missing"),
    heading_order_issue_count: countRule(results, "shape_heading_order"),
    extra_heading_count: countRule(results, "shape_heading_extra"),
    empty_section_count: countRule(results, "shape_section_empty"),
  };
}

function countRule(results: LintResult[], rule: string): number {
  return results.filter((result) => result.rule === rule).length;
}
