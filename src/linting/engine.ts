// src/linting/engine.ts
// Obsidian adapter for the Forge lint engine.

import { App, TFile, parseYaml } from "obsidian";
import {
  collectShapeNamesFromDocuments,
} from "../shapes/lint";
import {
  createForgeDocument,
} from "../vault/document";
import {
  runLintForDocuments as runCoreLintForDocuments,
  type ForgeDocument,
  type LintResult,
  type LintRunEnvelope,
  type LintRunResult,
  type LintSeverity,
} from "./model";
import type { ForgeSettings } from "../config/settings";
import { getVaultPaths } from "../vault/paths";
import { loadSchema } from "../utils/schema";
import { getMarkdownFiles, isMarkdownFile } from "../utils/files";

export type {
  LintResult,
  LintRunEnvelope,
  LintRunResult,
  LintSeverity,
};

interface VaultAdapterWithBasePath {
  basePath?: string;
}

export async function runLint(
  app: App,
  settings: ForgeSettings
): Promise<LintRunResult | null> {
  const allFiles = getMarkdownFiles(app);
  return runLintForFiles(app, settings, allFiles);
}

export async function runLintForFile(
  app: App,
  settings: ForgeSettings,
  file: TFile
): Promise<LintRunResult | null> {
  return runLintForFiles(app, settings, [file]);
}

export async function runLintForFiles(
  app: App,
  settings: ForgeSettings,
  files: TFile[]
): Promise<LintRunResult | null> {
  const schema = await loadSchema(app, settings);
  if (!schema) return null;

  const paths = getVaultPaths(settings);
  const documents = await filesToForgeDocuments(app, files.filter(isMarkdownFile));
  const shapeDocuments = filesToForgeDocumentsFromMetadata(getMarkdownFiles(app, paths.shapes));

  return runCoreLintForDocuments({
    documents,
    schema,
    settings,
    validShapes: collectShapeNamesFromDocuments(shapeDocuments, paths.shapes),
    vaultPath: (app.vault.adapter as VaultAdapterWithBasePath).basePath ?? "",
  });
}

async function filesToForgeDocuments(app: App, files: TFile[]): Promise<ForgeDocument[]> {
  const documents: ForgeDocument[] = [];

  for (const file of files) {
    let content = "";
    try {
      content = await app.vault.read(file);
    } catch {
      content = "";
    }

    documents.push(createForgeDocument({
      path: file.path,
      content,
      parseYaml,
      stat: {
        ctime: file.stat.ctime,
        mtime: file.stat.mtime,
      },
    }));
  }

  return documents;
}

function filesToForgeDocumentsFromMetadata(files: TFile[]): ForgeDocument[] {
  return files.map((file) => createForgeDocument({
    path: file.path,
    content: "",
    parseYaml,
    stat: {
      ctime: file.stat.ctime,
      mtime: file.stat.mtime,
    },
  }));
}
