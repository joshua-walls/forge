// src/schema-cache.ts
// Schema cache — loads and caches the vault schema for use across all commands.
//
// Loaded on plugin startup and refreshed whenever:
//   - Validate Schema runs successfully
//   - Settings are saved (schema path may have changed)
//
// Commands read from the cache rather than re-reading schema.md on every run.
// The cache is null until first load — commands must handle this gracefully.

import { App } from "obsidian";
import type { ForgeSettings } from "./settings";
import {
  loadSchema,
  VaultSchema,
  SchemaField,
  SchemaInlineField,
  allFrontmatterFields,
  getFrontmatterField,
  inlineFieldNameSet,
  conditionallyRequiredInlineFields,
  reviewCycleDays,
} from "./utils/schema";
import { todayString } from "./utils/files";

export class SchemaCache {
  private cache: VaultSchema | null = null;
  private app: App;
  private settings: ForgeSettings;

  constructor(app: App, settings: ForgeSettings) {
    this.app = app;
    this.settings = settings;
  }

  /** Returns the cached schema, loading it first if not yet loaded. */
  async get(): Promise<VaultSchema | null> {
    if (!this.cache) await this.refresh();
    return this.cache;
  }

  /** Forces a fresh load from schema.md. */
  async refresh(): Promise<VaultSchema | null> {
    this.cache = await loadSchema(this.app, this.settings);
    return this.cache;
  }

  /** Returns the cached schema without loading — may be null. */
  peek(): VaultSchema | null {
    return this.cache;
  }

  /** Clears the cache — next get() will reload. */
  invalidate(): void {
    this.cache = null;
  }

  /**
   * Updates settings reference. Only invalidates the cache if the schema
   * path changed — non-path settings don't affect the cached schema.
   */
  updateSettings(settings: ForgeSettings): void {
    const oldPath = `${this.settings.schemaNoteFolder}/${this.settings.schemaNoteFile}`;
    const newPath = `${settings.schemaNoteFolder}/${settings.schemaNoteFile}`;
    this.settings = settings;
    if (oldPath !== newPath) this.invalidate();
  }

  // ── Field accessors ───────────────────────────────────────────────────────

  /** All frontmatter fields — required and optional combined. */
  getAllFrontmatterFields(): SchemaField[] {
    if (!this.cache) return [];
    return allFrontmatterFields(this.cache);
  }

  /** All frontmatter field names — for dropdowns and validation. */
  getFrontmatterFieldNames(): string[] {
    return this.getAllFrontmatterFields().map((f) => f.name);
  }

  /** All inline field names — for dropdowns and validation. */
  getInlineFieldNames(): string[] {
    if (!this.cache) return [];
    return this.cache.inline.allowed.map((f) => f.name);
  }

  /**
   * Field names by location — used to populate schema-driven dropdowns
   * in the settings tab based on the user's chosen FieldPointerLocation.
   */
  getFieldNamesByLocation(location: "frontmatter" | "inline"): string[] {
    return location === "frontmatter"
      ? this.getFrontmatterFieldNames()
      : this.getInlineFieldNames();
  }

  /** All enum-type frontmatter field names. */
  getEnumFieldNames(): string[] {
    return this.getAllFrontmatterFields()
      .filter((f) => f.type === "enum")
      .map((f) => f.name);
  }

  /** Allowed values for a specific frontmatter enum field, or null if not an enum. */
  getEnumValues(fieldName: string): string[] | null {
    if (!this.cache) return null;
    const field = getFrontmatterField(this.cache, fieldName);
    if (!field || field.type !== "enum" || !field.values) return null;
    return field.values;
  }

  /** Field type for a given frontmatter field name, or null if not found. */
  getFieldType(fieldName: string): string | null {
    if (!this.cache) return null;
    return getFrontmatterField(this.cache, fieldName)?.type ?? null;
  }

  /** All inline fields with a required_when constraint. */
  getConditionallyRequiredInlineFields(): SchemaInlineField[] {
    if (!this.cache) return [];
    return conditionallyRequiredInlineFields(this.cache);
  }

  /** O(1) inline field name lookup set. */
  getInlineFieldNameSet(): Set<string> {
    if (!this.cache) return new Set();
    return inlineFieldNameSet(this.cache);
  }

  /**
   * Day count for a given review_cycle value.
   * Returns null for "never", undefined if value not found in values_meta.
   */
  getReviewCycleDays(value: string): number | null | undefined {
    if (!this.cache) return undefined;
    return reviewCycleDays(this.cache, value);
  }

  // ── Default value resolution ──────────────────────────────────────────────

  /**
   * Returns a reasonable default value for a frontmatter field.
   * Used by Shape Repair to pre-populate missing fields.
   */
  getDefaultValue(fieldName: string): unknown {
    const type = this.getFieldType(fieldName);
    const values = this.getEnumValues(fieldName);

    switch (fieldName) {
      case "created":
      case "updated":
      case "review_by":
        return todayString();
      case "ai_private":
        return false;
      case "review_cycle":
        return "never";
      case "status":
        return values?.includes("active") ? "active" : values?.[0] ?? "";
    }

    switch (type) {
      case "boolean": return false;
      case "enum":    return values?.[0] ?? "";
      case "date":    return todayString();
      case "list":    return [];
      default:        return "";
    }
  }
}
