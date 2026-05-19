// src/commands/repair.ts
// Vault Repair command.
//
// Port of Invoke-VaultRepair.ps1 — adapted for a modal UI.
//
// Flow:
//   1. Load lint-report.json — fail if missing (run lint first)
//   2. Filter to error-severity results only
//   3. Group errors by file
//   4. Show repair modal — one file at a time with field prompts
//   5. Collect values, build a vault-patch.md
//   6. Write patch to System/VaultForge/Patches/vault-patch.md
//   7. Offer to apply immediately via Apply Vault Patch

import { App, Modal, Notice, TFile, Setting } from "obsidian";
import type VaultForgePlugin from "../main";
import { getVaultPaths } from "../vault-paths";
import { loadSchema, VaultSchema } from "../utils/schema";
import { readNote } from "../utils/frontmatter";
import { ensureFolder, todayString } from "../utils/files";
import { runApplyPatch } from "./apply-patch";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LintError {
  file: string;
  severity: string;
  rule: string;
  message: string;
}

interface RepairOp {
  op: string;
  target: string;
  field?: string;
  value?: unknown;
  tag?: string;
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function runVaultRepair(plugin: VaultForgePlugin): Promise<void> {
  const { app, settings } = plugin;
  const paths = getVaultPaths(settings);

  // Load lint report
  const reportFile = app.vault.getAbstractFileByPath(paths.lintReportJson);
  if (!(reportFile instanceof TFile)) {
    new Notice("Vault Forge: No lint report found. Run Vault Lint first.", 5000);
    return;
  }

  let report: any;
  try {
    const raw = await app.vault.read(reportFile);
    report = JSON.parse(raw);
  } catch {
    new Notice("Vault Forge: Could not parse lint-report.json.", 5000);
    return;
  }

  const errors: LintError[] = (report.results ?? []).filter(
    (r: LintError) =>
      r.severity === "error" ||
      (r.severity === "warning" && (
        r.rule === "required_field" ||
        r.rule === "type_mismatch" ||
        r.rule === "enum_value"
      ))
  );

  if (errors.length === 0) {
    new Notice("Vault Forge: No errors in lint report — nothing to repair.", 4000);
    return;
  }

  // Load schema for field definitions
  const schema = await loadSchema(app, settings);
  if (!schema) {
    new Notice("Vault Forge: Could not load schema.md — repair aborted.", 5000);
    return;
  }

  // Group errors by file
  const byFile = new Map<string, LintError[]>();
  for (const error of errors) {
    if (!byFile.has(error.file)) byFile.set(error.file, []);
    byFile.get(error.file)!.push(error);
  }

  new VaultRepairModal(app, plugin, schema, byFile).open();
}

// ── Modal ─────────────────────────────────────────────────────────────────────

class VaultRepairModal extends Modal {
  private plugin: VaultForgePlugin;
  private schema: VaultSchema;
  private byFile: Map<string, LintError[]>;
  private fileList: string[];
  private currentIndex: number = 0;
  private ops: RepairOp[] = [];
  private skippedCount: number = 0;

  constructor(
    app: App,
    plugin: VaultForgePlugin,
    schema: VaultSchema,
    byFile: Map<string, LintError[]>
  ) {
    super(app);
    this.plugin = plugin;
    this.schema = schema;
    this.byFile = byFile;
    this.fileList = [...byFile.keys()];
  }

  onOpen(): void {
    this.renderCurrentFile();
  }

  private renderCurrentFile(): void {
    const { contentEl } = this;
    contentEl.empty();

    if (this.currentIndex >= this.fileList.length) {
      this.renderFinish();
      return;
    }

    const filePath = this.fileList[this.currentIndex];
    const fileErrors = this.byFile.get(filePath) ?? [];
    const total = this.fileList.length;
    const current = this.currentIndex + 1;

    contentEl.createEl("h2", { text: `Vault Repair (${current} of ${total})` });
    contentEl.createEl("p", {
      text: filePath,
      cls: "vault-forge-schema-path",
    });

    // Show errors for this file
    contentEl.createEl("h3", { text: "Issues" });
    const errorList = contentEl.createEl("ul", { cls: "vault-forge-error-list" });
    for (const e of fileErrors) {
      const prefix = e.severity === "warning" ? "⚠️" : "🔴";
      errorList.createEl("li", { text: `${prefix} [${e.rule}] ${e.message}` });
    }

    // Build field inputs for fixable errors
    const fieldsToFix = this.getFieldsToFix(fileErrors);
    const fieldValues = new Map<string, unknown>();

    if (fieldsToFix.length > 0) {
      contentEl.createEl("h3", { text: "Fix" });

      for (const fieldName of fieldsToFix) {
        const field = this.schema.required_fields.find((f) => f.name === fieldName)
          ?? this.schema.optional_fields.find((f) => f.name === fieldName);
        if (!field) continue;

        if (field.type === "enum" && field.values) {
          const suggestion = this.getSuggestion(fieldName, fileErrors);
          const initialVal = suggestion ? String(suggestion) : field.values[0];
          fieldValues.set(fieldName, initialVal);

          new Setting(contentEl)
            .setName(fieldName)
            .setDesc(`Valid: ${field.values.join(", ")}`)
            .addDropdown((dd) => {
              for (const v of field.values!) {
                dd.addOption(v, v);
              }
              dd.setValue(initialVal);
              dd.onChange((val) => fieldValues.set(fieldName, val));
            });
        } else if (field.type === "boolean") {
          const suggestion = this.getSuggestion(fieldName, fileErrors);
          const initialVal = suggestion !== null ? String(suggestion) : "false";
          fieldValues.set(fieldName, initialVal === "true");

          new Setting(contentEl)
            .setName(fieldName)
            .addDropdown((dd) => {
              dd.addOption("false", "false");
              dd.addOption("true", "true");
              dd.setValue(initialVal);
              dd.onChange((val) => fieldValues.set(fieldName, val === "true"));
            });
        } else if (field.type === "date") {
          const suggestion = this.getSuggestion(fieldName, fileErrors);
          const initialVal = suggestion ? String(suggestion) : todayString();
          fieldValues.set(fieldName, initialVal);

          new Setting(contentEl)
            .setName(fieldName)
            .setDesc("Format: yyyy-MM-dd")
            .addText((t) => {
              t.setPlaceholder("yyyy-MM-dd");
              t.setValue(initialVal);
              t.onChange((val) => fieldValues.set(fieldName, val));
            });
        } else if (field.type === "list" && fieldName === "tags") {
          new Setting(contentEl)
            .setName("tags")
            .setDesc(`Comma-separated. Namespaces: ${this.schema.tag_rules.allowed_namespaces.join(", ")}`)
            .addText((t) => {
              t.setPlaceholder("topic/identity, skill/governance");
              t.onChange((val) => {
                fieldValues.set("tags", val.split(",").map((s) => s.trim()).filter(Boolean));
              });
            });
        } else {
          const suggestion = this.getSuggestion(fieldName, fileErrors);
          if (suggestion) fieldValues.set(fieldName, suggestion);

          new Setting(contentEl)
            .setName(fieldName)
            .addText((t) => {
              if (suggestion) t.setValue(String(suggestion));
              t.onChange((val) => fieldValues.set(fieldName, val));
            });
        }
      }
    }

    // Buttons
    const buttonRow = contentEl.createDiv("vault-forge-button-row");

    const fixBtn = buttonRow.createEl("button", {
      text: fieldsToFix.length > 0 ? "Fix & Continue" : "Skip",
      cls: fieldsToFix.length > 0 ? "mod-cta" : "",
    });

    fixBtn.addEventListener("click", () => {
      // Collect ops for this file
      for (const [fieldName, value] of fieldValues) {
        if (fieldName === "tags" && Array.isArray(value)) {
          for (const tag of value) {
            this.ops.push({ op: "add_tag", target: filePath, tag });
          }
        } else if (value !== "" && value !== undefined) {
          this.ops.push({ op: "set_field", target: filePath, field: fieldName, value });
        }
      }
      this.currentIndex++;
      this.renderCurrentFile();
    });

    if (fieldsToFix.length > 0) {
      const skipBtn = buttonRow.createEl("button", { text: "Skip File" });
      skipBtn.addEventListener("click", () => {
        this.skippedCount++;
        this.currentIndex++;
        this.renderCurrentFile();
      });
    }

    const cancelBtn = buttonRow.createEl("button", { text: "Cancel All" });
    cancelBtn.addEventListener("click", () => this.close());
  }

  private renderFinish(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Repair Summary" });

    if (this.ops.length === 0) {
      contentEl.createEl("p", { text: "No operations collected — nothing to patch." });
      const closeBtn = contentEl.createEl("button", { text: "Close" });
      closeBtn.addEventListener("click", () => this.close());
      return;
    }

    contentEl.createEl("p", {
      text: `${this.ops.length} operation(s) collected across ${this.fileList.length - this.skippedCount} file(s).`,
    });

    if (this.skippedCount > 0) {
      contentEl.createEl("p", { text: `${this.skippedCount} file(s) skipped.`, cls: "vault-forge-error-note" });
    }

    contentEl.createEl("p", {
      text: `The repair patch will be written to ${getVaultPaths(this.plugin.settings).patchFile}.`,
      cls: "vault-forge-backup-notice",
    });

    const buttonRow = contentEl.createDiv("vault-forge-button-row");

    const writeAndApplyBtn = buttonRow.createEl("button", {
      text: "Write Patch & Apply",
      cls: "mod-cta",
    });
    writeAndApplyBtn.addEventListener("click", async () => {
      this.close();
      await this.writePatch();
      await runApplyPatch(this.plugin);
    });

    const writeBtn = buttonRow.createEl("button", { text: "Write Patch Only" });
    writeBtn.addEventListener("click", async () => {
      this.close();
      await this.writePatch();
      new Notice("Vault Forge: Repair patch written. Run Apply Vault Patch when ready.", 5000);
    });

    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
  }

  private async writePatch(): Promise<void> {
    const paths = getVaultPaths(this.plugin.settings);
    const today = todayString();

    // Warn if patch file already has content — don't silently overwrite
    const existingPatch = this.app.vault.getAbstractFileByPath(paths.patchFile);
    if (existingPatch instanceof TFile) {
      const existing = await this.app.vault.read(existingPatch);
      const hasOps = existing.includes("op:") || existing.includes("operations:");
      if (hasOps) {
        new Notice(
          "Vault Forge: Overwriting existing patch file — previous operations will be replaced.",
          5000
        );
      }
    }

    const patch = {
      meta: {
        generated_at: new Date().toISOString(),
        description: "Repair pass — interactive fix of lint errors",
        schema_version: this.schema.meta.version,
        source: "Vault Forge — Vault Repair",
        contains_schema_changes: false,
      },
      operations: this.ops,
    };

    // Convert to YAML manually — simple enough for this structure
    const lines: string[] = [
      "meta:",
      `  generated_at: ${patch.meta.generated_at}`,
      `  description: "${patch.meta.description}"`,
      `  schema_version: "${patch.meta.schema_version}"`,
      `  source: "${patch.meta.source}"`,
      `  contains_schema_changes: false`,
      "",
      "operations:",
    ];

    for (const op of this.ops) {
      lines.push(`  - op: ${op.op}`);
      lines.push(`    target: "${op.target}"`);
      if (op.field) lines.push(`    field: ${op.field}`);
      if (op.tag) lines.push(`    tag: ${op.tag}`);
      if (op.value !== undefined) {
        if (typeof op.value === "string") {
          lines.push(`    value: "${op.value}"`);
        } else if (typeof op.value === "boolean") {
          lines.push(`    value: ${op.value}`);
        } else {
          lines.push(`    value: ${op.value}`);
        }
      }
    }

    const content = [
      "---",
      "type: procedure",
      "status: draft",
      "tags:",
      "  - tool/vault-forge",
      `created: ${today}`,
      `updated: ${today}`,
      "ai_private: false",
      "review_cycle: never",
      "---",
      "",
      "# Vault Patch",
      "",
      "Patch generated by Vault Forge Repair.",
      "",
      "## Patch",
      "",
      "```yaml",
      ...lines,
      "```",
      "",
    ].join("\n");

    const patchPath = paths.patchFile;
    const patchFolder = patchPath.includes("/")
      ? patchPath.substring(0, patchPath.lastIndexOf("/"))
      : "";
    if (patchFolder) await ensureFolder(this.app, patchFolder);

    const existing = this.app.vault.getAbstractFileByPath(patchPath);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(patchPath, content);
    }
  }

  private getFieldsToFix(errors: LintError[]): string[] {
    const fields = new Set<string>();

    // If no frontmatter at all — prompt for ALL required fields
    const hasNoFrontmatter = errors.some((e) => e.rule === "no_frontmatter");
    if (hasNoFrontmatter) {
      for (const field of this.schema.required_fields) {
        fields.add(field.name);
      }
      return [...fields];
    }

    // Otherwise collect from error AND warning results
    for (const e of errors) {
      if (e.rule === "required_field") {
        const m = e.message.match(/Missing required field: '([\w_]+)'/);
        if (m) fields.add(m[1]);
      } else if (e.rule === "enum_value") {
        const m = e.message.match(/Field '([\w_]+)'/);
        if (m) fields.add(m[1]);
      } else if (e.rule === "required_when") {
        const m = e.message.match(/Field '([\w_]+)'/);
        if (m) fields.add(m[1]);
      }
    }

    return [...fields];
  }

  private getSuggestion(fieldName: string, errors: LintError[]): unknown {
    // Use schema cache for smart defaults where available
    const cacheDefault = this.plugin.schemaCache?.getDefaultValue(fieldName);

    // Override with error-specific suggestions
    if (fieldName === "status") {
      const statusErr = errors.find((e) => e.rule === "enum_value" && e.message.includes("'status'"));
      if (statusErr) {
        // Try to find "active" in allowed values, otherwise use cache default
        const values = this.plugin.schemaCache?.getEnumValues("status");
        return values?.includes("active") ? "active" : values?.[0] ?? cacheDefault;
      }
    }

    return cacheDefault ?? null;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
