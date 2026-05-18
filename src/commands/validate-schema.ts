// src/commands/validate-schema.ts
// Validate Schema command.
//
// Reads schema.md, runs structural validation, shows results in a modal.
// Does not modify any files — read-only.
//
// Replaces Generate-Schema.ps1's validation job (Job 2 only).
// The compilation job (Job 1 — schema.md → schema.yaml/json) is eliminated
// since the plugin reads schema.md directly.

import { App, Modal, Notice, TFile } from "obsidian";
import type VaultForgePlugin from "../main";
import { getVaultPaths } from "../vault-paths";
import { validateSchemaNote, SchemaValidationIssue } from "../utils/schema";

// ── Entry point ───────────────────────────────────────────────────────────────

export async function runValidateSchema(plugin: VaultForgePlugin): Promise<void> {
  const { app, settings } = plugin;
  const paths = getVaultPaths(settings);

  const file = app.vault.getAbstractFileByPath(paths.schemaMd);

  if (!(file instanceof TFile)) {
    new Notice(
      `Vault Forge: schema.md not found at ${paths.schemaMd}`,
      6000
    );
    return;
  }

  let raw: string;
  try {
    raw = await app.vault.read(file);
  } catch (e) {
    new Notice("Vault Forge: Could not read schema.md.", 5000);
    return;
  }

  const issues = validateSchemaNote(raw);

  // Refresh cache on successful validation so all commands get updated field list
  if (!issues.some((i) => i.severity === "error")) {
    await plugin.schemaCache.refresh();
  }

  new ValidateSchemaModal(app, plugin, issues, paths.schemaMd).open();
}

// ── Modal ─────────────────────────────────────────────────────────────────────

class ValidateSchemaModal extends Modal {
  private plugin: VaultForgePlugin;
  private issues: SchemaValidationIssue[];
  private schemaPath: string;

  constructor(
    app: App,
    plugin: VaultForgePlugin,
    issues: SchemaValidationIssue[],
    schemaPath: string
  ) {
    super(app);
    this.plugin = plugin;
    this.issues = issues;
    this.schemaPath = schemaPath;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    const errors   = this.issues.filter((i) => i.severity === "error");
    const warnings = this.issues.filter((i) => i.severity === "warning");
    const passed   = errors.length === 0;

    contentEl.createEl("h2", {
      text: passed ? "✅ Schema Valid" : "🔴 Schema Errors Found",
    });

    contentEl.createEl("p", {
      text: `Schema: ${this.schemaPath}`,
      cls: "vault-forge-schema-path",
    });

    if (passed && warnings.length === 0) {
      contentEl.createEl("p", {
        text: "schema.md is well-formed. All required sections are present and parseable.",
        cls: "vault-forge-success-msg",
      });
    }

    if (errors.length > 0) {
      contentEl.createEl("h3", { text: "Errors" });
      const list = contentEl.createEl("ul", { cls: "vault-forge-lint-list" });
      for (const issue of errors) {
        list.createEl("li", { text: issue.message });
      }
    }

    if (warnings.length > 0) {
      contentEl.createEl("h3", { text: "Warnings" });
      const list = contentEl.createEl("ul", { cls: "vault-forge-lint-list" });
      for (const issue of warnings) {
        list.createEl("li", { text: issue.message });
      }
    }

    // Buttons
    const buttonRow = contentEl.createDiv("vault-forge-button-row");

    const openBtn = buttonRow.createEl("button", {
      text: "Open schema.md",
      cls: passed ? "mod-cta" : "",
    });
    openBtn.addEventListener("click", () => {
      this.close();
      this.app.workspace.openLinkText(this.schemaPath, "", false);
    });

    const closeBtn = buttonRow.createEl("button", { text: "Close" });
    closeBtn.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
