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
import type VaultForgePlugin from "../main";
import { getVaultPaths } from "../vault-paths";
import { runLint, LintRunResult } from "../lint-engine";
import {
  writeLintReportJson,
  appendLintHistory,
  writeLintRunNote,
} from "../lint-writers";
import { runVaultRepair } from "./repair";

// ── Entry point ───────────────────────────────────────────────────────────────

export async function runVaultLint(plugin: VaultForgePlugin): Promise<LintRunResult | null> {
  const { app, settings } = plugin;

  new Notice("Vault Forge: Running lint…", 2000);

  const result = await runLint(app, settings);

  if (!result) {
    new Notice(
      "Vault Forge: Could not load schema.md — lint aborted. Run Validate Schema to diagnose.",
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

// ── Modal ─────────────────────────────────────────────────────────────────────

class LintResultsModal extends Modal {
  private plugin: VaultForgePlugin;
  private result: LintRunResult;
  private runNotePath: string;

  constructor(
    app: App,
    plugin: VaultForgePlugin,
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

    const r = this.result;
    const passed = r.errors.length === 0;

    contentEl.createEl("h2", {
      text: passed ? "✅ Vault Lint — Passed" : "🔴 Vault Lint — Errors Found",
    });

    // Stats
    const statsEl = contentEl.createDiv("vault-forge-lint-stats");

    const statItem = (label: string, count: number, cls: string) => {
      const el = statsEl.createDiv(`vault-forge-stat ${cls}`);
      el.createSpan({ text: String(count), cls: "vault-forge-stat-count" });
      el.createSpan({ text: ` ${label}`, cls: "vault-forge-stat-label" });
    };

    statItem("errors",   r.errors.length,   r.errors.length   > 0 ? "vault-forge-stat-error"   : "vault-forge-stat-ok");
    statItem("warnings", r.warnings.length, r.warnings.length > 0 ? "vault-forge-stat-warning" : "vault-forge-stat-ok");
    statItem("info",     r.infos.length,    "vault-forge-stat-info");

    contentEl.createEl("p", {
      text: `${r.envelope.notes_scanned} notes scanned`,
      cls: "vault-forge-scan-count",
    });

    // Error preview — show first 10
    if (r.errors.length > 0) {
      contentEl.createEl("h3", { text: "Errors" });
      const list = contentEl.createEl("ul", { cls: "vault-forge-lint-list" });
      for (const e of r.errors.slice(0, 10)) {
        const li = list.createEl("li");
        li.createEl("code", { text: e.file });
        li.createSpan({ text: ` [${e.rule}] ${e.message}` });
      }
      if (r.errors.length > 10) {
        list.createEl("li", {
          text: `…and ${r.errors.length - 10} more errors. See the lint run note for full details.`,
          cls: "vault-forge-more",
        });
      }
    }

    // Warning preview — show first 5
    if (r.warnings.length > 0 && r.errors.length === 0) {
      contentEl.createEl("h3", { text: "Warnings" });
      const list = contentEl.createEl("ul", { cls: "vault-forge-lint-list" });
      for (const w of r.warnings.slice(0, 5)) {
        const li = list.createEl("li");
        li.createEl("code", { text: w.file });
        li.createSpan({ text: ` [${w.rule}] ${w.message}` });
      }
      if (r.warnings.length > 5) {
        list.createEl("li", {
          text: `…and ${r.warnings.length - 5} more warnings.`,
          cls: "vault-forge-more",
        });
      }
    }

    // Buttons
    const buttonRow = contentEl.createDiv("vault-forge-button-row");

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
