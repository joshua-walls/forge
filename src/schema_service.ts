import { App, TFile } from "obsidian";
import type { ForgeSettings } from "./settings";
import type { SchemaCache } from "./schema-cache";
import { getVaultPaths } from "./vault-paths";
import { validateSchemaNote } from "./utils/schema";
import { DashboardCache } from "./dashboard_cache";
import {
  DASHBOARD_CACHE_SCHEMA_VERSION,
  schemaIssueToDashboardIssue,
  type SchemaValidationResult,
} from "./dashboard_types";

export class SchemaService {
  private cache: DashboardCache;

  constructor(
    private app: App,
    private settings: ForgeSettings,
    private schemaCache?: SchemaCache
  ) {
    this.cache = new DashboardCache(app, settings);
  }

  async validate(
    sourceCommand: SchemaValidationResult["source_command"] = "validate-schema"
  ): Promise<SchemaValidationResult> {
    const started = Date.now();
    const paths = getVaultPaths(this.settings);
    const file = this.app.vault.getAbstractFileByPath(paths.schemaMd);

    if (!(file instanceof TFile)) {
      return this.persist({
        schema_version: DASHBOARD_CACHE_SCHEMA_VERSION,
        source_command: sourceCommand,
        generated_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
        files_scanned: 0,
        schema_path: paths.schemaMd,
        violations: [{
          file_path: paths.schemaMd,
          issue_type: "schema_missing",
          severity: "critical",
          message: `schema.md not found at ${paths.schemaMd}`,
          suggested_action: "Create schema.md or update Forge schema settings.",
          source_command: sourceCommand,
        }],
        errors: 1,
        warnings: 0,
      });
    }

    let raw = "";
    try {
      raw = await this.app.vault.read(file);
    } catch {
      return this.persist({
        schema_version: DASHBOARD_CACHE_SCHEMA_VERSION,
        source_command: sourceCommand,
        generated_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
        files_scanned: 1,
        schema_path: paths.schemaMd,
        violations: [{
          file_path: paths.schemaMd,
          issue_type: "schema_read_failed",
          severity: "critical",
          message: "Could not read schema.md.",
          suggested_action: "Check that the schema note is readable.",
          source_command: sourceCommand,
        }],
        errors: 1,
        warnings: 0,
      });
    }

    const issues = validateSchemaNote(raw, this.settings);
    if (!issues.some((issue) => issue.severity === "error")) {
      await this.schemaCache?.refresh();
    }

    const violations = issues.map((issue) => ({
      ...schemaIssueToDashboardIssue(issue, paths.schemaMd),
      source_command: sourceCommand,
    }));

    return this.persist({
      schema_version: DASHBOARD_CACHE_SCHEMA_VERSION,
      source_command: sourceCommand,
      generated_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      files_scanned: 1,
      schema_path: paths.schemaMd,
      violations,
      errors: issues.filter((issue) => issue.severity === "error").length,
      warnings: issues.filter((issue) => issue.severity === "warning").length,
    });
  }

  async latest(): Promise<SchemaValidationResult | null> {
    return (await this.cache.read()).latest_schema_result;
  }

  private async persist(result: SchemaValidationResult): Promise<SchemaValidationResult> {
    try {
      await this.cache.updateLeaf({ key: "latest_schema_result", value: result });
    } catch (e) {
      console.warn("[Forge] Could not update dashboard schema cache:", e);
    }
    return result;
  }
}
