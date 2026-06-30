import { App, TFile, normalizePath } from "obsidian";
import type { ForgeSettings } from "./settings";
import { getVaultPaths } from "./vault-paths";
import { readNote } from "./utils/frontmatter";
import { loadSchema } from "./utils/schema";
import { DashboardCache } from "./dashboard_cache";
import {
  DASHBOARD_CACHE_SCHEMA_VERSION,
  type OntologyMetricsResult,
} from "./dashboard_types";

export class OntologyService {
  private cache: DashboardCache;

  constructor(private app: App, private settings: ForgeSettings) {
    this.cache = new DashboardCache(app, settings);
  }

  async collectMetrics(
    sourceCommand: OntologyMetricsResult["source_command"] = "refresh-vault-health-dashboard"
  ): Promise<OntologyMetricsResult> {
    const started = Date.now();
    const paths = getVaultPaths(this.settings);
    const markdownFiles = this.app.vault.getMarkdownFiles();
    const schema = await loadSchema(this.app, this.settings);

    const folderCoverage: Record<string, number> = {};
    const tagDistribution: Record<string, number> = {};

    for (const file of markdownFiles) {
      if (file.path.split("/").some((segment) => segment.startsWith("."))) continue;
      const topFolder = file.path.includes("/") ? file.path.split("/")[0] : "(root)";
      folderCoverage[topFolder] = (folderCoverage[topFolder] ?? 0) + 1;

      const note = await readNote(this.app, file);
      const tags = note?.frontmatter?.tags;
      const tagList = Array.isArray(tags) ? tags : typeof tags === "string" ? [tags] : [];
      for (const tag of tagList.map((value) => String(value).replace(/^#/, ""))) {
        if (!tag) continue;
        tagDistribution[tag] = (tagDistribution[tag] ?? 0) + 1;
      }
    }

    const result: OntologyMetricsResult = {
      schema_version: DASHBOARD_CACHE_SCHEMA_VERSION,
      source_command: sourceCommand,
      generated_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      shape_count: countMarkdownInFolder(markdownFiles, paths.shapes),
      template_count: countMarkdownInFolder(markdownFiles, paths.templates),
      relationship_type_count: Object.keys(schema?.ontology?.relationships ?? {}).length,
      folder_coverage: sortRecord(folderCoverage),
      tag_distribution: sortRecord(tagDistribution),
      orphaned_entities: null,
    };

    try {
      await this.cache.updateLeaf({ key: "latest_ontology_result", value: result });
    } catch (e) {
      console.warn("[Forge] Could not update dashboard ontology cache:", e);
    }
    return result;
  }

  async latest(): Promise<OntologyMetricsResult | null> {
    return (await this.cache.read()).latest_ontology_result;
  }
}

function countMarkdownInFolder(files: TFile[], folder: string): number {
  const prefix = normalizePath(folder).replace(/\/$/, "");
  return files.filter((file) => file.path === prefix || file.path.startsWith(prefix + "/")).length;
}

function sortRecord(record: Record<string, number>): Record<string, number> {
  const sorted: Record<string, number> = {};
  for (const [key, value] of Object.entries(record).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    sorted[key] = value;
  }
  return sorted;
}
