// src/utils/schema.ts
// Obsidian adapter for Forge schema loading.

import { App, TFile, parseYaml } from "obsidian";
import type { ForgeSettings } from "../settings";
import { getVaultPaths } from "../vault-paths";
import {
  allFrontmatterFields,
  conditionallyRequiredInlineFields,
  getFrontmatterField,
  inlineFieldNameSet,
  parseSchemaNote as parseCoreSchemaNote,
  reviewCycleDays,
  validateSchemaNote as validateCoreSchemaNote,
} from "@forge/core";

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
} from "@forge/core";

interface ParseSchemaOptions {
  versionLocation?: "frontmatter" | "inline";
  versionField?: string;
}

export async function loadSchema(
  app: App,
  settings: ForgeSettings
): Promise<import("@forge/core").VaultSchema | null> {
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
): import("@forge/core").VaultSchema | null {
  return parseCoreSchemaNote(raw, {
    versionLocation: options?.versionLocation,
    versionField: options?.versionField,
    parseYaml,
  });
}

export function validateSchemaNote(
  raw: string,
  settings?: ForgeSettings
): import("@forge/core").SchemaValidationIssue[] {
  return validateCoreSchemaNote(raw, {
    settings,
    parseYaml,
  });
}
