import { App, Modal, Notice } from "obsidian";
import type ForgePlugin from "../main";
import type { ShapeLintRunResult } from "../shape_lint_service";
import {
  writeShapeLintReportJson,
  writeShapeLintRunNote,
} from "../shape_lint_writers";
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

export async function runShapeLint(plugin: ForgePlugin): Promise<ShapeLintRunResult | null> {
  const { app, settings } = plugin;

  if (!settings.shapeLintEnabled) {
    new Notice("Forge: Shape lint is disabled in settings.", 5000);
    return null;
  }

  const noteCount = app.vault.getMarkdownFiles().length;
  new Notice(`Forge: Running Shape Lint on ${noteCount} notes...`, 3000);

  const result = await plugin.shapeLintService.runShapeLint("run-shape-lint");
  await writeShapeLintReportJson(app, settings, result);
  const runNotePath = await writeShapeLintRunNote(app, settings, result);
  await plugin.recomposeHealthDashboard();

  new ShapeLintResultsModal(app, result, runNotePath).open();
  return result;
}

class ShapeLintResultsModal extends Modal {
  private activeFilter: ResultSeverityFilter = "all";

  constructor(
    app: App,
    private result: ShapeLintRunResult,
    private runNotePath: string
  ) {
    super(app);
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
    const failed = r.errors.length > 0 || r.warnings.length > 0;

    contentEl.createEl("h2", {
      text: failed ? "Shape Lint Issues Found" : "Shape Lint Passed",
    });

    const body = contentEl.createDiv("forge-modal-body");
    const sections = this.sections();
    renderResultSummaryGrid(body, [
      { label: "Errors", value: r.errors.length, tone: r.errors.length > 0 ? "critical" : "muted" },
      { label: "Warnings", value: r.warnings.length, tone: r.warnings.length > 0 ? "warning" : "muted" },
      { label: "Info", value: r.infos.length, tone: r.infos.length > 0 ? "info" : "muted" },
      { label: "Notes scanned", value: r.envelope.notes_scanned, tone: "muted" },
    ]);
    renderSeverityFilters(body, sections, this.activeFilter, (filter) => {
      this.activeFilter = filter;
      this.render();
    });
    renderGroupedResults(body, resultItemsForFilter(sections, this.activeFilter), {
      emptyText: failed ? "No results in this view." : "No shape lint issues found.",
      openFile: (filePath) => this.openFile(filePath),
    });

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
      text: "View shape lint run note",
    });
    viewBtn.addEventListener("click", () => {
      this.close();
      void this.app.workspace.openLinkText(this.runNotePath, "", false);
    });

    const closeBtn = buttonRow.createEl("button", { text: "Close" });
    closeBtn.addEventListener("click", () => this.close());
  }

  private sections(): ResultModalSection[] {
    const r = this.result;
    return [
      { severity: "error", label: "Errors", items: r.errors },
      { severity: "warning", label: "Warnings", items: r.warnings },
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
