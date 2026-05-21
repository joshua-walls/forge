// src/commands/run-lint.ts
// Run Vault Lint command.
//
// Flow:
//   1. Load schema — fail fast if schema.md is missing/invalid
//   2. Scan all non-exempt vault files
//   3. Apply all lint rules
//   4. Write lint-report.json, lint run note, append history
//   5. Show results modal — summary with error/warning/info counts
//   6. If errors and settings allow: offer to open Vault Repair (Milestone 7)

import { App, Modal, Notice, normalizePath } from "obsidian";
import type ForgePlugin from "../main";
import { getVaultPaths } from "../vault-paths";
import { runLint, LintRunResult } from "../lint-engine";
import {
  writeLintReportJson,
  appendLintHistory,
  writeLintRunNote,
} from "../lint-writers";
import { runVaultRepair } from "./repair";

// ── Entry point ───────────────────────────────────────────────────────────────

export async function runVaultLint(plugin: ForgePlugin): Promise<LintRunResult | null> {
  const { app, settings } = plugin;

  const noteCount = app.vault.getMarkdownFiles().length;
  const estimatedSeconds = Math.max(3, Math.ceil(noteCount / 200));
  new Notice(
    `Forge: Running lint on ${noteCount} notes… (may take ~${estimatedSeconds}s on large vaults)`,
    estimatedSeconds * 1000
  );

  const result = await runLint(app, settings);

  if (!result) {
    new Notice(
      "Forge: Could not load schema.md — lint aborted. Run Validate Schema to diagnose.",
      6000
    );
    return null;
  }

  // Write outputs
  await writeLintReportJson(app, settings, result);
  await appendLintHistory(app, settings, result);
  const runNotePath = await writeLintRunNote(app, settings, result);

  // Show results modal
  new LintResultsModal(app, plugin, result, runNotePath).open();

  return result;
}

interface GroupedLintReason {
  label: string;
  files: string[];
}

interface GroupedLintItem {
  rule: string;
  summary: string;
  reasons: GroupedLintReason[];
}

function summarizeLintMessage(rule: string, message: string): string {
  if (rule === "inline_undocumented") {
    return "Inline keys are undocumented — consider adding to inline_fields in schema.md";
  }

  if (rule === "tag_namespace") {
    return "Tags are not namespaced. Expected format: namespace/tag";
  }

  return message;
}

function extractLintReason(rule: string, message: string): string {
  if (rule === "inline_undocumented") {
    const match = message.match(/Inline key '([^']+)'/);
    return match ? `'${match[1]}'` : message;
  }

  if (rule === "tag_namespace") {
    const match = message.match(/Tag '([^']+)'/);
    return match ? `'${match[1]}'` : message;
  }

  return message;
}

function groupLintItems(items: Array<{ rule: string; message: string; file: string }>): GroupedLintItem[] {
  const groups = new Map<string, GroupedLintItem>();
  const reasons = new Map<string, GroupedLintReason>();
  const seenReasonFiles = new Set<string>();

  for (const item of items) {
    const summary = summarizeLintMessage(item.rule, item.message);
    const reasonLabel = extractLintReason(item.rule, item.message);

    const groupKey = `${item.rule}::${summary}`;
    const reasonKey = `${groupKey}::${reasonLabel}`;
    const reasonFileKey = `${reasonKey}::${item.file}`;

    let group = groups.get(groupKey);
    if (!group) {
      group = {
        rule: item.rule,
        summary,
        reasons: [],
      };
      groups.set(groupKey, group);
    }

    let reason = reasons.get(reasonKey);
    if (!reason) {
      reason = {
        label: reasonLabel,
        files: [],
      };
      reasons.set(reasonKey, reason);
      group.reasons.push(reason);
    }

    if (!seenReasonFiles.has(reasonFileKey)) {
      seenReasonFiles.add(reasonFileKey);
      reason.files.push(item.file);
    }
  }

  return [...groups.values()];
}

// ── Modal ─────────────────────────────────────────────────────────────────────

class LintResultsModal extends Modal {
  private plugin: ForgePlugin;
  private result: LintRunResult;
  private runNotePath: string;

  constructor(
    app: App,
    plugin: ForgePlugin,
    result: LintRunResult,
    runNotePath: string
  ) {
    super(app);
    this.plugin = plugin;
    this.result = result;
    this.runNotePath = runNotePath;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("forge-modal");

    const r = this.result;
    const failed =
      r.errors.length > 0 ||
      (this.plugin.settings.lintStrictMode && r.warnings.length > 0);

    contentEl.createEl("h2", {
      text: failed
        ? "❌ Vault Lint — Failed"
        : "✅ Vault Lint — Passed",
    });

    const body = contentEl.createDiv("forge-modal-body");

    const summaryEl = body.createDiv("forge-lint-summary");

    summaryEl.createEl("div", {
      text: `${r.errors.length} errors`,
    });

    summaryEl.createEl("div", {
      text: `${r.warnings.length} warnings`,
    });

    summaryEl.createEl("div", {
      text: `${r.infos.length} info`,
    });

    summaryEl.createEl("br");

    summaryEl.createEl("div", {
      text: `${r.envelope.notes_scanned} notes scanned`,
    });

    if (r.errors.length > 0) {
      body.createEl("h3", { text: "Errors" });

      for (const group of groupLintItems(r.errors)) {
        body.createEl("div", {
          text: `[${group.rule}]`,
          cls: "forge-lint-rule",
        });

        body.createEl("div", {
          text: group.summary,
          cls: "forge-lint-message",
        });

        for (const reason of group.reasons) {
          body.createEl("h4", {
            text: reason.label,
            cls: "forge-lint-reason",
          });

          const list = body.createEl("ul", {
            cls: "forge-lint-list",
          });

          for (const file of reason.files) {
            list.createEl("li", {
              text: file,
            });
          }
        }
      }
    }

    if (r.warnings.length > 0) {
      body.createEl("h3", { text: "Warnings" });

      for (const group of groupLintItems(r.warnings)) {
        body.createEl("div", {
          text: `[${group.rule}]`,
          cls: "forge-lint-rule",
        });

        body.createEl("div", {
          text: group.summary,
          cls: "forge-lint-message",
        });

        for (const reason of group.reasons) {
          body.createEl("h4", {
            text: reason.label,
            cls: "forge-lint-reason",
          });

          const list = body.createEl("ul", {
            cls: "forge-lint-list",
          });

          for (const file of reason.files) {
            list.createEl("li", {
              text: file,
            });
          }
        }
      }
    }

    if (r.infos.length > 0) {
      body.createEl("h3", { text: "Info" });

      for (const group of groupLintItems(r.infos)) {
        body.createEl("div", {
          text: `[${group.rule}]`,
          cls: "forge-lint-rule",
        });

        body.createEl("div", {
          text: group.summary,
          cls: "forge-lint-message",
        });

        for (const reason of group.reasons) {
          body.createEl("h4", {
            text: reason.label,
            cls: "forge-lint-reason",
          });

          const list = body.createEl("ul", {
            cls: "forge-lint-list",
          });

          for (const file of reason.files) {
            list.createEl("li", {
              text: file,
            });
          }
        }
      }
    }

    // Pinned footer
    const footer = contentEl.createDiv("forge-modal-footer");
    const buttonRow = footer.createDiv("forge-button-row");

    const viewBtn = buttonRow.createEl("button", {
      text: "View Lint Run Note",
      cls: "mod-cta",
    });
    viewBtn.addEventListener("click", () => {
      this.close();
      this.app.workspace.openLinkText(this.runNotePath, "", false);
    });

    // Repair button — wired in Milestone 7
    if (r.errors.length > 0) {
      const repairBtn = buttonRow.createEl("button", { text: "Open Vault Repair" });
      repairBtn.addEventListener("click", () => {
        this.close();
        runVaultRepair(this.plugin);
      });
    }

    const closeBtn = buttonRow.createEl("button", { text: "Close" });
    closeBtn.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}