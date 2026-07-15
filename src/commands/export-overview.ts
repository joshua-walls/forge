// src/commands/export-overview.ts
// Export Vault Overview - host adapter around @forge/core export builders.

import { App, Notice, TFile, normalizePath, parseYaml } from "obsidian";
import {
  buildVaultOverviewArtifacts,
  createForgeDocument,
  type ForgeDocument,
  type InventoryExport,
} from "@forge/core";
import type ForgePlugin from "../main";
import { ensureFolder } from "../utils/files";
import { loadSchema } from "../utils/schema";

interface ExportOverviewOptions {
  silent?: boolean;
}

export async function runExportOverview(
  plugin: ForgePlugin,
  options: ExportOverviewOptions = {}
): Promise<void> {
  const { app, settings } = plugin;
  const { silent = false } = options;

  if (!settings.exportEnabled) {
    if (!silent) new Notice("Forge: Export is not enabled — enable it in settings → export.", 5000);
    return;
  }

  if (!silent) new Notice("Forge: Building vault overview…", 3000);
  await ensureFolder(app, settings.exportsFolder);

  const [schema, documents] = await Promise.all([
    loadSchema(app, settings),
    loadExportDocuments(app),
  ]);
  const artifacts = buildVaultOverviewArtifacts({
    documents,
    settings,
    schema,
  });

  await writeFile(app, artifacts.inventoryPath, artifacts.inventoryJson);
  await writeFile(app, artifacts.metaPath, artifacts.metaJson);
  await writeFile(app, artifacts.exportNotePath, artifacts.exportNote);

  const dashboardExists = app.vault.getAbstractFileByPath(artifacts.dashboardPath) instanceof TFile;
  if (!dashboardExists) {
    await app.vault.create(artifacts.dashboardPath, artifacts.dashboardNote);
  }

  if (!silent) new Notice(`Forge: Overview complete — ${artifacts.inventory.count} notes indexed.`, 5000);
}

export async function loadExportDocuments(app: App): Promise<ForgeDocument[]> {
  const files = app.vault.getMarkdownFiles();
  const documents: ForgeDocument[] = [];

  for (const file of files) {
    try {
      const content = await app.vault.read(file);
      documents.push(createForgeDocument({
        path: file.path,
        content,
        parseYaml,
        stat: {
          ctime: file.stat.ctime,
          mtime: file.stat.mtime,
        },
      }));
    } catch (error) {
      console.warn(`[Forge] Could not read export document ${file.path}:`, error);
    }
  }

  return documents;
}

export async function loadInventory(
  app: App,
  exportsFolder: string
): Promise<InventoryExport | null> {
  const path = normalizePath(`${exportsFolder}/vault-inventory.json`);
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;

  try {
    return JSON.parse(await app.vault.read(file)) as InventoryExport;
  } catch (error) {
    console.warn("[Forge] Could not load inventory:", error);
    return null;
  }
}

async function writeFile(app: App, path: string, content: string): Promise<void> {
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
  } else {
    await app.vault.create(path, content);
  }
}
