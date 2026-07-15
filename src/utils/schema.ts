// src/utils/schema.ts
// Obsidian adapter for Forge schema loading.

import { App, TFile, parseYaml } from "obsidian";
import type { ForgeSettings } from "../config/settings";
import { getVaultPaths } from "../vault/paths";
import {
  allFrontmatterFields,
  conditionallyRequiredInlineFields,
  getFrontmatterField,
  inlineFieldNameSet,
  parseSchemaNote as parseCoreSchemaNote,
  reviewCycleDays,
  validateSchemaNote as validateCoreSchemaNote,
} from "../schemas/schema";

export {
  allFrontmatterFields,
  conditionallyRequiredInlineFields,
  getFrontmatterField,
  inlineFieldNameSet,
  reviewCycleDays,
};

export type {
  SchemaField,
  SchemaFrontmatter,
  SchemaInline,
  SchemaInlineField,
  SchemaLintRule,
  SchemaOntology,
  SchemaRelationship,
  SchemaTagRules,
  SchemaValidationIssue,
  VaultSchema,
} from "../schemas/schema";

interface ParseSchemaOptions {
  versionLocation?: "frontmatter" | "inline";
  versionField?: string;
}

export async function loadSchema(
  app: App,
  settings: ForgeSettings
): Promise<import("../schemas/schema").VaultSchema | null> {
  const paths = getVaultPaths(settings);
  const file = app.vault.getAbstractFileByPath(paths.schemaMd);

  if (!(file instanceof TFile)) {
    console.warn(`[Forge] schema.md not found at: ${paths.schemaMd}`);
    return null;
  }

  let raw: string;
  try {
    raw = await app.vault.read(file);
  } catch (error) {
    console.warn("[Forge] Could not read schema.md:", error);
    return null;
  }

  return parseSchemaNote(raw, {
    versionLocation: settings.schemaVersionLocation,
    versionField: settings.schemaVersionField,
  });
}

export function parseSchemaNote(
  raw: string,
  options?: ParseSchemaOptions
): import("../schemas/schema").VaultSchema | null {
  return parseCoreSchemaNote(raw, {
    versionLocation: options?.versionLocation,
    versionField: options?.versionField,
    parseYaml,
  });
}

export function validateSchemaNote(
  raw: string,
  settings?: ForgeSettings
): import("../schemas/schema").SchemaValidationIssue[] {
  return validateCoreSchemaNote(raw, {
    settings,
    parseYaml,
  });
}
