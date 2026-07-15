import { App } from "obsidian";
import type { ForgeSettings } from "../config/settings";
import { getVaultPaths } from "../vault/paths";
import { readNote } from "../utils/frontmatter";
import { loadSchema } from "../utils/schema";
import { DashboardCache } from "../dashboard/cache";
import {
  buildOntologyMetricsResult,
  type OntologyMetricsDocument,
  type OntologyMetricsResult,
} from "../dashboard/types";

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

    const documents: OntologyMetricsDocument[] = [];

    for (const file of markdownFiles) {
      if (file.path.split("/").some((segment) => segment.startsWith("."))) continue;
      const note = await readNote(this.app, file);
      documents.push({
        path: file.path,
        frontmatter: note?.frontmatter ?? {},
      });
    }

    const result = buildOntologyMetricsResult({
      sourceCommand,
      durationMs: Date.now() - started,
      documents,
      shapesPath: paths.shapes,
      templatesPath: paths.templates,
      relationshipTypeCount: Object.keys(schema?.ontology?.relationships ?? {}).length,
    });

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
