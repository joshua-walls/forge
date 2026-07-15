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
//   6. Write patch to System/Forge/Patches/vault-patch.md
//   7. Offer to apply immediately via Apply Vault Patch

import { App, Modal, Notice, TFile, Setting } from "obsidian";
import {
  buildRepairPatchContent,
  extractRepairTagNamespace,
  filterRepairableLintResults,
  getRepairDefaultValue,
  getRepairFieldsToFix,
  type LintResult,
  type RepairOperation,
} from "@forge/core";
import type ForgePlugin from "../main";
import { getVaultPaths } from "../vault-paths";
import { loadSchema, VaultSchema, allFrontmatterFields } from "../utils/schema";
import { ensureFolder, todayString } from "../utils/files";
import { serializeYaml } from "../utils/yaml";
import { runApplyPatch } from "./apply-patch";

// ── Types ─────────────────────────────────────────────────────────────────────

type LintError = LintResult;

type RepairOp = RepairOperation;

function stringifyRepairValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

function isLintError(value: unknown): value is LintError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.file === "string"
    && isLintSeverity(candidate.severity)
    && typeof candidate.rule === "string"
    && typeof candidate.message === "string";
}

function isLintSeverity(value: unknown): value is LintResult["severity"] {
  return value === "error" || value === "warning" || value === "info" || value === "review";
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function runVaultRepair(plugin: ForgePlugin): Promise<void> {
  const { app, settings } = plugin;
  const paths = getVaultPaths(settings);

  // Load lint report
  const reportFile = app.vault.getAbstractFileByPath(paths.lintReportJson);
  if (!(reportFile instanceof TFile)) {
    new Notice("Forge: No lint report found. Run vault lint first.", 5000);
    return;
  }

  let report: { results?: LintError[] } = {};
  try {
    const raw = await app.vault.read(reportFile);
    const parsed: unknown = JSON.parse(raw);
    report = typeof parsed === "object" && parsed !== null
      ? {
          results: Array.isArray((parsed as { results?: unknown }).results)
            ? (parsed as { results: unknown[] }).results.filter(isLintError)
            : undefined,
        }
      : {};
  } catch {
    new Notice("Forge: Could not parse lint-report.json.", 5000);
    return;
  }

  const repairThreshold = plugin.settings.lintRepairThreshold ?? "errors_only";

  const errors: LintError[] = filterRepairableLintResults(report.results ?? [], repairThreshold);

  if (errors.length === 0) {
    const thresholdLabel = repairThreshold === "errors_and_warnings"
      ? "errors or repairable warnings"
      : "errors";
    new Notice(`Forge: No ${thresholdLabel} in lint report — nothing to repair.`, 4000);
    return;
  }

  // Load schema for field definitions
  const schema = await loadSchema(app, settings);
  if (!schema) {
    new Notice("Forge: Could not load schema.md — repair aborted.", 5000);
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
  private plugin: ForgePlugin;
  private schema: VaultSchema;
  private byFile: Map<string, LintError[]>;
  private fileList: string[];
  private currentIndex: number = 0;
  private ops: RepairOp[] = [];
  private skippedCount: number = 0;

  constructor(
    app: App,
    plugin: ForgePlugin,
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
      cls: "forge-schema-path",
    });

    // Show errors for this file
    contentEl.createEl("h3", { text: "Issues" });
    const errorList = contentEl.createEl("ul", { cls: "forge-error-list" });
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
        const field = allFrontmatterFields(this.schema).find((f) => f.name === fieldName);
        if (!field) continue;

        if (field.type === "enum" && field.values) {
          const suggestion = this.getSuggestion(fieldName, fileErrors);
          const initialVal = stringifyRepairValue(suggestion) || field.values[0];
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
          const initialVal = suggestion !== null ? stringifyRepairValue(suggestion) : "false";
          fieldValues.set(fieldName, initialVal === "true");

          new Setting(contentEl)
            .setName(fieldName)
            .addDropdown((dd) => {
              dd.addOption("false", "False");
              dd.addOption("true", "True");
              dd.setValue(initialVal);
              dd.onChange((val) => fieldValues.set(fieldName, val === "true"));
            });
        } else if (field.type === "date") {
          const suggestion = this.getSuggestion(fieldName, fileErrors);
          const initialVal = stringifyRepairValue(suggestion) || todayString();
          fieldValues.set(fieldName, initialVal);

          new Setting(contentEl)
            .setName(fieldName)
            .setDesc("Format: Yyyy-mm-dd")
            .addText((t) => {
              t.setPlaceholder("Yyyy-mm-dd");
              t.setValue(initialVal);
              t.onChange((val) => fieldValues.set(fieldName, val));
            });
        } else if (field.type === "list" && fieldName === "tags") {
          new Setting(contentEl)
            .setName("Tags")
            .setDesc(`Comma-separated. Namespaces: ${this.schema.tag_rules.allowed_namespaces.join(", ")}`)
            .addText((t) => {
              t.setPlaceholder("Topic/identity, skill/governance");
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
              if (suggestion) t.setValue(stringifyRepairValue(suggestion));
              t.onChange((val) => fieldValues.set(fieldName, val));
            });
        }
      }
    }

    // ── Tag namespace repair ───────────────────────────────────────────────
    // Collect bad tags from unknown_tag_namespace and forbidden_namespace errors.
    // Each offending tag gets its own Skip / Replace / Remove toggle row.
    const badTagErrors = fileErrors.filter(
      (e) => e.rule === "unknown_tag_namespace" || e.rule === "forbidden_namespace" || e.rule === "tag_namespace"
    );

    // Map: full tag string → { action: "skip" | "replace" | "remove", newValue: string }
    type TagAction = { action: "skip" | "replace" | "remove"; newValue: string };
    const tagDecisions = new Map<string, TagAction>();

    if (badTagErrors.length > 0) {
      contentEl.createEl("h3", { text: "Tag namespace issues" });

      // Resolve full tags from metadataCache so we can emit precise patch ops.
      // Lint messages only embed the namespace, not the full tag — look them up here.
      const cachedMeta = this.app.metadataCache.getCache(filePath);
      const allFileTags: string[] = (cachedMeta?.frontmatter?.tags ?? []) as string[];

      for (const err of badTagErrors) {
        const ns = this.extractNamespaceFromError(err);
        if (!ns) continue;

        // Find all full tags in this file that belong to the offending namespace.
        // For tag_namespace (no slash), ns IS the full tag — match exactly.
        // For unknown/forbidden, ns is just the prefix — match all tags with that namespace.
        const matchingTags = allFileTags.filter((t) => {
          const slashIdx = t.indexOf("/");
          if (slashIdx < 0) {
            // Un-namespaced tag — match exact
            return t === ns;
          }
          return t.substring(0, slashIdx) === ns;
        });

        // If metadataCache didn't resolve (e.g. new file), fall back to "ns/*" as display key
        const tagsToShow = matchingTags.length > 0 ? matchingTags : [`${ns}/*`];

        for (const badTag of tagsToShow) {
          if (tagDecisions.has(badTag)) continue;
          tagDecisions.set(badTag, { action: "skip", newValue: "" });

          const row = contentEl.createDiv("forge-tag-repair-row");

          row.createEl("span", {
            text: badTag,
            cls: "forge-tag-repair-label",
          });

          row.createEl("span", {
            text: err.rule === "forbidden_namespace" ? "forbidden" : "unknown",
            cls: `forge-tag-badge forge-tag-badge-${err.rule === "forbidden_namespace" ? "forbidden" : "unknown"}`,
          });

          // Toggle button group: Skip / Replace / Remove
          const toggleGroup = row.createDiv("forge-tag-toggle-group");

          let replaceInputWrapper: HTMLDivElement | null = null;

          const makeToggle = (label: string, value: TagAction["action"]) => {
            const btn = toggleGroup.createEl("button", {
              text: label,
              cls: value === "skip" ? "forge-tag-toggle active" : "forge-tag-toggle",
            });
            btn.addEventListener("click", () => {
              toggleGroup.querySelectorAll(".forge-tag-toggle").forEach((b) =>
                b.removeClass("active")
              );
              btn.addClass("active");

              const decision = tagDecisions.get(badTag)!;
              decision.action = value;

              if (replaceInputWrapper) {
                replaceInputWrapper.toggleClass("is-hidden", value !== "replace");
              }
            });
            return btn;
          };

          makeToggle("Skip", "skip");
          makeToggle("Replace", "replace");
          makeToggle("Remove", "remove");

          // Replace input — hidden until Replace is selected
          replaceInputWrapper = row.createDiv("forge-tag-replace-wrapper");
          replaceInputWrapper.addClass("is-hidden");

          const input = replaceInputWrapper.createEl("input", {
            type: "text",
            placeholder: "replacement/tag",
            cls: "forge-tag-replace-input",
          });

          input.addEventListener("input", () => {
            const decision = tagDecisions.get(badTag)!;
            decision.newValue = input.value.trim();
          });
        }
      }
    }

    // Buttons
    const buttonRow = contentEl.createDiv("forge-button-row");

    const hasAnyFixes = fieldsToFix.length > 0 || badTagErrors.length > 0;

    const fixBtn = buttonRow.createEl("button", {
      text: hasAnyFixes ? "Fix & Continue" : "Skip",
      cls: hasAnyFixes ? "mod-cta" : "",
    });

    fixBtn.addEventListener("click", () => {
      // Collect field ops for this file
      for (const [fieldName, value] of fieldValues) {
        if (fieldName === "tags" && Array.isArray(value)) {
          for (const tag of value.filter((item): item is string => typeof item === "string")) {
            this.ops.push({ op: "add_tag", target: filePath, tag });
          }
        } else if (value !== "" && value !== undefined) {
          this.ops.push({ op: "set_field", target: filePath, field: fieldName, value });
        }
      }

      // Collect tag namespace repair ops
      for (const [badTag, decision] of tagDecisions) {
        if (decision.action === "remove") {
          this.ops.push({ op: "remove_tag", target: filePath, tag: badTag });
        } else if (decision.action === "replace" && decision.newValue) {
          this.ops.push({
            op: "replace_tag",
            target: filePath,
            old_tag: badTag,
            new_tag: decision.newValue,
          });
        }
        // "skip" → no op emitted
      }

      this.currentIndex++;
      this.renderCurrentFile();
    });

    if (hasAnyFixes) {
      const skipBtn = buttonRow.createEl("button", { text: "Skip file" });
      skipBtn.addEventListener("click", () => {
        this.skippedCount++;
        this.currentIndex++;
        this.renderCurrentFile();
      });
    }

    const cancelBtn = buttonRow.createEl("button", { text: "Cancel all" });
    cancelBtn.addEventListener("click", () => this.close());
  }

  private renderFinish(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Repair summary" });

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
      contentEl.createEl("p", { text: `${this.skippedCount} file(s) skipped.`, cls: "forge-error-note" });
    }

    contentEl.createEl("p", {
      text: `The repair patch will be written to ${getVaultPaths(this.plugin.settings).patchFile}.`,
      cls: "forge-backup-notice",
    });

    const buttonRow = contentEl.createDiv("forge-button-row");

    const writeAndApplyBtn = buttonRow.createEl("button", {
      text: "Write patch & apply",
      cls: "mod-cta",
    });
    writeAndApplyBtn.addEventListener("click", () => {
      void (async () => {
        this.close();
        await this.writePatch();
        await runApplyPatch(this.plugin);
      })();
    });

    const writeBtn = buttonRow.createEl("button", { text: "Write patch only" });
    writeBtn.addEventListener("click", () => {
      void (async () => {
        this.close();
        await this.writePatch();
        new Notice("Forge: Repair patch written. Run apply vault patch when ready.", 5000);
      })();
    });

    const openBtn = buttonRow.createEl("button", { text: "Write & open patch" });
    openBtn.addEventListener("click", () => {
      void (async () => {
        this.close();
        await this.writePatch();
        const paths = getVaultPaths(this.plugin.settings);
        void this.app.workspace.openLinkText(paths.patchFile, "", false);
      })();
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
          "Forge: Overwriting existing patch file — previous operations will be replaced.",
          5000
        );
      }
    }

    const content = buildRepairPatchContent({
      operations: this.ops,
      schemaVersion: this.schema.version,
      today,
      stringifyYaml: serializeYaml,
    });

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
    return getRepairFieldsToFix(this.schema, errors);
  }

  private getSuggestion(fieldName: string, errors: LintError[]): unknown {
    void errors;
    return getRepairDefaultValue(this.schema, fieldName);
  }

  /**
   * Extract the offending namespace from a tag-namespace lint error message.
   *
   * Lint engine message formats:
   *   tag_namespace:          "Tag '<TAG>' is not namespaced. Expected format: namespace/tag"
   *   unknown_tag_namespace:  "Tag namespace '<NS>' is not in allowed_namespaces"
   *   forbidden_namespace:    "Tag namespace '<NS>' is reserved and must not be used as a tag namespace"
   *
   * Returns the namespace string, or null if the message doesn't match.
   */
  private extractNamespaceFromError(err: LintError): string | null {
    return extractRepairTagNamespace(err);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
