import { App, TAbstractFile, TFile, TFolder, parseYaml } from "obsidian";
import {
  buildShapeHeadingCacheFromTemplates,
  collectShapeTemplatesFromDocuments,
  createForgeDocument,
  getVaultPaths,
  lintShapeHeadingsForDocument,
  type ForgeDocument,
  type ParsedHeading,
} from "@forge/core";
import type { ForgeSettings } from "../settings";
import type { LintResult } from "../lint-engine";

export {
  buildTemplateTree,
  extractHeadings,
  flattenTemplateTree,
} from "@forge/core";
export type {
  ParsedHeading,
  TemplateNode,
} from "@forge/core";

export async function buildShapeHeadingCache(
  app: App,
  settings: ForgeSettings
): Promise<Map<string, ParsedHeading[]>> {
  const templatesFolder = getVaultPaths(settings).templates;
  const templateFiles: TFile[] = [];

  const walk = (node: TAbstractFile) => {
    if (node instanceof TFile && node.extension.toLowerCase() === "md") {
      templateFiles.push(node);
    } else if (node instanceof TFolder) {
      node.children.forEach(walk);
    }
  };

  const abstractFolder = app.vault.getAbstractFileByPath(templatesFolder);
  if (!(abstractFolder instanceof TFolder)) return new Map<string, ParsedHeading[]>();
  abstractFolder.children.forEach(walk);

  const templateDocuments: ForgeDocument[] = [];
  for (const file of templateFiles) {
    const content = await app.vault.read(file);
    templateDocuments.push(createForgeDocument({
      path: file.path,
      content,
      parseYaml,
      stat: {
        ctime: file.stat.ctime,
        mtime: file.stat.mtime,
      },
    }));
  }

  return buildShapeHeadingCacheFromTemplates(
    collectShapeTemplatesFromDocuments(templateDocuments, templatesFolder)
  );
}

export async function lintShapeHeadings(
  _app: App,
  file: TFile,
  content: string,
  settings: ForgeSettings,
  headingCache: Map<string, ParsedHeading[]>
): Promise<LintResult[]> {
  const document = createForgeDocument({
    path: file.path,
    content,
    parseYaml,
    stat: {
      ctime: file.stat.ctime,
      mtime: file.stat.mtime,
    },
  });

  return lintShapeHeadingsForDocument(document, settings, headingCache);
}
