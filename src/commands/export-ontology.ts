// src/commands/export-ontology.ts
// Export Ontology Index - host adapter around @forge/core export builders.

import { Notice, TFile } from "obsidian";
import {
  buildOntologyIndexArtifacts,
  type OntologyIndex,
} from "@forge/core";
import type ForgePlugin from "../main";
import { ensureFolder } from "../utils/files";
import { loadSchema } from "../utils/schema";
import { runExportOverview, loadInventory, loadExportDocuments } from "./export-overview";

interface ExportOntologyOptions {
  silent?: boolean;
  refreshMetrics?: boolean;
  refreshDashboard?: boolean;
}

export async function runExportOntology(
  plugin: ForgePlugin,
  options: ExportOntologyOptions = {}
): Promise<OntologyIndex[] | null> {
  const { app, settings } = plugin;
  const {
    silent = false,
    refreshMetrics = true,
    refreshDashboard = true,
  } = options;

  if (!settings.exportEnabled) {
    if (!silent) new Notice("Forge: Export is not enabled — enable it in settings → export.", 5000);
    return null;
  }

  if (!settings.exportFilterField || settings.exportFilterValues.length === 0) {
    if (!silent) new Notice("Forge: No filter configured — set a field and values in settings → export.", 7000);
    return null;
  }

  const schema = await loadSchema(app, settings);
  const schemaVersion = schema?.version ?? "unknown";

  let inventory = await loadInventory(app, settings.exportsFolder);
  if (!inventory) {
    if (!silent) new Notice("Forge: No inventory found — running export inventory first…", 4000);
    await runExportOverview(plugin, { silent });
    inventory = await loadInventory(app, settings.exportsFolder);
    if (!inventory) {
      if (!silent) new Notice("Forge: Inventory export failed — ontology export aborted.", 6000);
      return null;
    }
  }

  const documents = await loadExportDocuments(app);
  const artifacts = buildOntologyIndexArtifacts({
    documents,
    inventory,
    settings,
    schemaVersion,
  });

  if (artifacts.length === 0) {
    if (!silent) {
      new Notice(
        `Forge: No notes matched '${settings.exportFilterField}' in [${settings.exportFilterValues.join(", ")}].`,
        7000
      );
    }
    return null;
  }

  if (!silent) new Notice(`Forge: Building ontology indexes for ${artifacts.length} type(s)…`, 4000);
  await ensureFolder(app, settings.exportsFolder);

  for (const artifact of artifacts) {
    await writeFile(plugin, artifact.jsonPath, artifact.json);
    await writeFile(plugin, artifact.markdownPath, artifact.markdown);
  }

  const total = artifacts.reduce((sum, artifact) => sum + artifact.index.total_notes, 0);
  if (refreshMetrics) {
    await plugin.ontologyService.collectMetrics("export-ontology-index");
  }
  if (refreshDashboard) {
    await plugin.recomposeHealthDashboard();
  }
  if (!silent) {
    new Notice(
      `Forge: Ontology export complete — ${total} notes across [${artifacts.map((artifact) => artifact.filterValue).join(", ")}].`,
      6000
    );
  }

  return artifacts.map((artifact) => artifact.index);
}

async function writeFile(plugin: ForgePlugin, path: string, content: string): Promise<void> {
  const existing = plugin.app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await plugin.app.vault.modify(existing, content);
  } else {
    await plugin.app.vault.create(path, content);
  }
}
