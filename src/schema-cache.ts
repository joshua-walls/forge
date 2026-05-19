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
import type { VaultForgeSettings } from "./settings";
import { loadSchema, VaultSchema } from "./utils/schema";

export class SchemaCache {
  private cache: VaultSchema | null = null;
  private app: App;
  private settings: VaultForgeSettings;

  constructor(app: App, settings: VaultForgeSettings) {
    this.app = app;
    this.settings = settings;
  }

  /**
   * Returns the cached schema, loading it first if not yet loaded.
   */
  async get(): Promise<VaultSchema | null> {
    if (!this.cache) {
      await this.refresh();
    }
    return this.cache;
  }

  /**
   * Forces a fresh load from schema.md.
   * Called after Validate Schema or settings changes.
   */
  async refresh(): Promise<VaultSchema | null> {
    this.cache = await loadSchema(this.app, this.settings);
    return this.cache;
  }

  /**
   * Returns the cached schema without loading — may be null.
   */
  peek(): VaultSchema | null {
    return this.cache;
  }

  /**
   * Clears the cache — next get() will reload.
   */
  invalidate(): void {
    this.cache = null;
  }

  /**
   * Updates settings reference (called when settings change).
   * Only invalidates the cache if the schema path changed — non-path settings
   * (lint toggles, retention counts, etc.) don't affect the cached schema, so
   * there is no reason to clear a valid cache when they change.
   */
  updateSettings(settings: VaultForgeSettings): void {
    const oldPath = `${this.settings.schemaNoteFolder}/${this.settings.schemaNoteFile}`;
    const newPath = `${settings.schemaNoteFolder}/${settings.schemaNoteFile}`;
    this.settings = settings;
    if (oldPath !== newPath) {
      this.invalidate();
    }
  }

  // ── Schema field helpers ────────────────────────────────────────────────────

  /**
   * Returns all field names from required + optional fields.
   */
  getFieldNames(): string[] {
    if (!this.cache) return [];
    return [
      ...this.cache.required_fields.map((f) => f.name),
      ...this.cache.optional_fields.map((f) => f.name),
    ];
  }

  /**
   * Returns all enum-type field names — these should have lowercased values.
   * Used by Normalize Frontmatter to replace the hardcoded field list.
   */
  getEnumFieldNames(): string[] {
    if (!this.cache) return [];
    return [
      ...this.cache.required_fields.filter((f) => f.type === "enum").map((f) => f.name),
      ...this.cache.optional_fields.filter((f) => f.type === "enum").map((f) => f.name),
    ];
  }

  /**
   * Returns allowed values for a specific field, or null if not an enum.
   */
  getEnumValues(fieldName: string): string[] | null {
    if (!this.cache) return null;
    const all = [...this.cache.required_fields, ...this.cache.optional_fields];
    const field = all.find((f) => f.name === fieldName);
    if (!field || field.type !== "enum" || !field.values) return null;
    return field.values;
  }

  /**
   * Returns the field type for a given field name, or null if not found.
   */
  getFieldType(fieldName: string): string | null {
    if (!this.cache) return null;
    const all = [...this.cache.required_fields, ...this.cache.optional_fields];
    const field = all.find((f) => f.name === fieldName);
    return field?.type ?? null;
  }

  /**
   * Returns a reasonable default value for a field based on its type and name.
   * Used by Vault Repair to pre-populate fields.
   */
  getDefaultValue(fieldName: string): unknown {
    const type = this.getFieldType(fieldName);
    const values = this.getEnumValues(fieldName);

    // Name-based smart defaults
    switch (fieldName) {
      case "created":
      case "updated":
      case "review_by":
        return new Date().toISOString().substring(0, 10);
      case "ai_private":
        return false;
      case "review_cycle":
        return "never";
      case "status":
        return values?.includes("active") ? "active" : values?.[0] ?? "";
    }

    // Type-based fallbacks
    switch (type) {
      case "boolean": return false;
      case "enum":    return values?.[0] ?? "";
      case "date":    return new Date().toISOString().substring(0, 10);
      case "list":    return [];
      default:        return "";
    }
  }

}
