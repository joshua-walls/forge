import { App, Modal, Notice } from "obsidian";
import type ForgePlugin from "../main";
import type { ShapeLintRunResult } from "../shape_lint_service";
import {
  writeShapeLintReportJson,
  writeShapeLintRunNote,
} from "../shape_lint_writers";

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
  constructor(
    app: App,
    private result: ShapeLintRunResult,
    private runNotePath: string
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("forge-modal");

    const r = this.result;
    const failed = r.errors.length > 0 || r.warnings.length > 0;

    contentEl.createEl("h2", {
      text: failed ? "Shape Lint - Issues Found" : "Shape Lint - Passed",
    });

    const body = contentEl.createDiv("forge-modal-body");
    const summary = body.createDiv("forge-lint-summary");
    summary.createEl("div", { text: `${r.errors.length} errors` });
    summary.createEl("div", { text: `${r.warnings.length} warnings` });
    summary.createEl("div", { text: `${r.infos.length} info` });
    summary.createEl("br");
    summary.createEl("div", { text: `${r.envelope.notes_scanned} notes scanned` });

    for (const { label, items } of [
      { label: "Errors", items: r.errors },
      { label: "Warnings", items: r.warnings },
      { label: "Info", items: r.infos },
    ]) {
      if (items.length === 0) continue;
      body.createEl("h3", { text: label });
      const list = body.createEl("ul", { cls: "forge-lint-list" });
      for (const item of items.slice(0, 120)) {
        list.createEl("li", { text: `[${item.rule}] ${item.file} - ${item.message}` });
      }
      if (items.length > 120) {
        list.createEl("li", { text: `...and ${items.length - 120} more` });
      }
    }

    const footer = contentEl.createDiv("forge-modal-footer");
    const buttonRow = footer.createDiv("forge-button-row");

    const viewBtn = buttonRow.createEl("button", {
      text: "View shape lint run note",
      cls: "mod-cta",
    });
    viewBtn.addEventListener("click", () => {
      this.close();
      void this.app.workspace.openLinkText(this.runNotePath, "", false);
    });

    const closeBtn = buttonRow.createEl("button", { text: "Close" });
    closeBtn.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
