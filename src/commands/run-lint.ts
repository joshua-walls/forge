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

import { App, Modal, Notice } from "obsidian";
import type ForgePlugin from "../main";
import { LintRunResult } from "../linting/engine";
import {
  writeLintReportJson,
  appendLintHistory,
  writeLintRunNote,
} from "../linting/writers";
import { runVaultRepair } from "./repair";
import {
  defaultResultFilter,
  firstResultItem,
  renderGroupedResults,
  renderResultSummaryGrid,
  renderSeverityFilters,
  resultItemsForFilter,
  type ResultModalSection,
  type ResultSeverityFilter,
} from "./result-modal";

// ── Entry point ───────────────────────────────────────────────────────────────

export async function runVaultLint(plugin: ForgePlugin): Promise<LintRunResult | null> {
  const { app, settings } = plugin;

  const noteCount = app.vault.getMarkdownFiles().length;
  const estimatedSeconds = Math.max(3, Math.ceil(noteCount / 200));
  new Notice(
    `Forge: Running lint on ${noteCount} notes… (may take ~${estimatedSeconds}s on large vaults)`,
    estimatedSeconds * 1000
  );

  const result = await plugin.lintService.runLint("run-vault-lint");

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
  await plugin.recomposeHealthDashboard();

  // Show results modal
  new LintResultsModal(app, plugin, result, runNotePath).open();

  return result;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

class LintResultsModal extends Modal {
  private plugin: ForgePlugin;
  private result: LintRunResult;
  private runNotePath: string;
  private activeFilter: ResultSeverityFilter = "all";

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
    this.activeFilter = defaultResultFilter(this.sections());
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("forge-modal");
    this.modalEl.addClass("forge-results-modal");

    const r = this.result;
    const failed =
      r.errors.length > 0 ||
      (this.plugin.settings.lintStrictMode && r.warnings.length > 0);

    contentEl.createEl("h2", {
      text: failed
        ? "Vault Lint Failed"
        : "Vault Lint Passed",
    });

    const body = contentEl.createDiv("forge-modal-body");
    const sections = this.sections();
    renderResultSummaryGrid(body, [
      { label: "Errors", value: r.errors.length, tone: r.errors.length > 0 ? "critical" : "muted" },
      { label: "Warnings", value: r.warnings.length, tone: r.warnings.length > 0 ? "warning" : "muted" },
      { label: "Info", value: r.infos.length, tone: r.infos.length > 0 ? "info" : "muted" },
      { label: "Needs review", value: r.reviewItems.length, tone: r.reviewItems.length > 0 ? "review" : "muted" },
      { label: "Notes scanned", value: r.envelope.notes_scanned, tone: "muted" },
    ]);
    renderSeverityFilters(body, sections, this.activeFilter, (filter) => {
      this.activeFilter = filter;
      this.render();
    });
    renderGroupedResults(body, resultItemsForFilter(sections, this.activeFilter), {
      emptyText: failed ? "No results in this view." : "No lint issues found.",
      openFile: (filePath) => this.openFile(filePath),
    });

    // Pinned footer
    const footer = contentEl.createDiv("forge-modal-footer");
    const buttonRow = footer.createDiv("forge-button-row");
    const first = firstResultItem(sections, this.activeFilter);
    if (first) {
      const openFirstBtn = buttonRow.createEl("button", {
        text: "Open first issue",
        cls: "mod-cta",
      });
      openFirstBtn.addEventListener("click", () => this.openFile(first.file));
    }

    const viewBtn = buttonRow.createEl("button", {
      text: "View lint run note",
    });
    viewBtn.addEventListener("click", () => {
      this.close();
      void this.app.workspace.openLinkText(this.runNotePath, "", false);
    });

    // Repair button — shown based on lintRepairThreshold setting
    const threshold = this.plugin.settings.lintRepairThreshold ?? "errors_only";
    const hasRepairable = threshold === "errors_and_warnings"
      ? r.errors.length > 0 || r.warnings.length > 0
      : r.errors.length > 0;

    if (hasRepairable) {
      const repairBtn = buttonRow.createEl("button", { text: "Open vault repair" });
      repairBtn.addEventListener("click", () => {
        this.close();
        void runVaultRepair(this.plugin);
      });
    }

    const closeBtn = buttonRow.createEl("button", { text: "Close" });
    closeBtn.addEventListener("click", () => this.close());
  }

  private sections(): ResultModalSection[] {
    const r = this.result;
    return [
      { severity: "error", label: "Errors", items: r.errors },
      { severity: "warning", label: "Warnings", items: r.warnings },
      { severity: "review", label: "Review", items: r.reviewItems },
      { severity: "info", label: "Info", items: r.infos },
    ];
  }

  private openFile(filePath: string): void {
    this.close();
    void this.app.workspace.openLinkText(filePath, "", false);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
