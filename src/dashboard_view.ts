import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type ForgePlugin from "./main";
import type { DashboardIssue, DashboardSnapshot } from "./dashboard_types";

export const FORGE_HEALTH_DASHBOARD_VIEW = "forge-health-dashboard";

export class ForgeHealthDashboardView extends ItemView {
  private plugin: ForgePlugin;
  private snapshot: DashboardSnapshot | null = null;
  private refreshing = false;

  constructor(leaf: WorkspaceLeaf, plugin: ForgePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return FORGE_HEALTH_DASHBOARD_VIEW;
  }

  getDisplayText(): string {
    return "Forge Health";
  }

  getIcon(): string {
    return "activity";
  }

  async onOpen(): Promise<void> {
    this.snapshot = await this.plugin.dashboardService.loadSnapshot();
    this.render();
  }

  async reloadFromCache(): Promise<void> {
    this.snapshot = await this.plugin.dashboardService.loadSnapshot();
    this.render();
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    this.render();

    try {
      this.snapshot = await this.plugin.dashboardService.refreshSnapshot();
    } catch (e) {
      new Notice(`Forge: ${e instanceof Error ? e.message : "Could not refresh dashboard"}`, 6000);
      console.error("[Forge] refresh-vault-health-dashboard error:", e);
    } finally {
      this.refreshing = false;
      this.render();
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("forge-health-dashboard");

    const header = contentEl.createDiv("forge-health-header");
    const titleBlock = header.createDiv();
    titleBlock.createEl("h2", { text: "Vault Health" });

    const actions = header.createDiv("forge-health-actions");
    if (this.snapshot) {
      actions.createDiv({
        text: `${healthLabel(this.snapshot)} • ${this.snapshot.duration_ms} ms`,
        cls: `forge-health-pill ${healthClass(this.snapshot)}`,
      });
    }

    const refreshButton = actions.createEl("button", {
      text: this.refreshing ? "Refreshing..." : "Refresh",
      cls: "mod-cta",
    });
    refreshButton.disabled = this.refreshing;
    refreshButton.addEventListener("click", () => this.refresh());

    if (!this.snapshot) {
      const empty = contentEl.createDiv("forge-health-empty");
      empty.createEl("h2", { text: "No cached health snapshot" });
      empty.createEl("p", { text: "Run a manual refresh to scan the vault and populate this dashboard." });
      return;
    }

    this.renderSummary(contentEl, this.snapshot);
    this.renderSchemaHealth(contentEl, this.snapshot);
    this.renderIssues(contentEl, this.lintIssues(this.snapshot));
    this.renderOntology(contentEl, this.snapshot);
    this.renderHistory(contentEl, this.snapshot);
    this.renderRecommendations(contentEl, this.snapshot);
  }

  private renderSummary(container: HTMLElement, snapshot: DashboardSnapshot): void {
    const summaryStatus: SectionStatus = snapshot.summary.schema_violation_count > 0 || snapshot.summary.invalid_frontmatter_count > 0
      ? { label: "Needs attention", tone: "critical" }
      : snapshot.summary.lint_issue_count > 0
        ? { label: "Watch", tone: "warning" }
        : { label: "Healthy", tone: "good" };

    const section = createSection(container, "Health Summary", summaryStatus);
    section.createDiv({
      text: `Last scan ${formatRelativeWithExactDate(snapshot.generated_at)}`,
      cls: "forge-health-section-meta",
    });

    const actions = section.createDiv("forge-health-section-actions");
    const lintButton = actions.createEl("button", { text: "Run Vault Lint" });
    lintButton.addEventListener("click", () => this.executeCommand("run-vault-lint"));

    const grid = section.createDiv("forge-health-metric-grid");
    const metrics = [
      ["Notes scanned", snapshot.summary.notes_scanned],
      ["Lint issues", snapshot.summary.lint_issue_count],
      ["Schema violations", snapshot.summary.schema_violation_count],
      ["Broken shapes", snapshot.summary.broken_shape_count],
      ["Invalid frontmatter", snapshot.summary.invalid_frontmatter_count],
      ["Normalization candidates", snapshot.summary.normalization_candidates ?? "—"],
    ];

    for (const [label, value] of metrics) {
      const item = grid.createDiv("forge-health-metric");
      item.createDiv({ text: String(value), cls: "forge-health-metric-value" });
      item.createDiv({ text: String(label), cls: "forge-health-metric-label" });
    }
  }

  private renderSchemaHealth(container: HTMLElement, snapshot: DashboardSnapshot): void {
    const schema = snapshot.schema;
    const status: SectionStatus = !schema
      ? { label: "Not validated", tone: "muted" }
      : schema.errors > 0
        ? { label: "Invalid", tone: "critical" }
        : schema.warnings > 0
          ? { label: "Warnings", tone: "warning" }
          : { label: "Valid", tone: "good" };

    const section = createSection(container, "Schema Health", status);
    if (!schema) {
      section.createDiv({ text: "Schema has not been validated in the latest dashboard cache.", cls: "forge-health-muted" });
    } else {
      section.createDiv({
        text: `Last validated ${formatRelativeWithExactDate(schema.generated_at)}`,
        cls: "forge-health-section-meta",
      });

      const summary = section.createDiv("forge-health-inline-summary");
      summary.createSpan({ text: `${schema.errors} error${schema.errors === 1 ? "" : "s"}` });
      summary.createSpan({ text: " • " });
      summary.createSpan({ text: `${schema.warnings} warning${schema.warnings === 1 ? "" : "s"}` });
      summary.createSpan({ text: " • " });
      summary.createSpan({ text: schema.schema_path });
    }

    const actions = section.createDiv("forge-health-section-actions");
    const validateButton = actions.createEl("button", { text: "Validate Schema" });
    validateButton.addEventListener("click", () => this.executeCommand("validate-schema"));

    if (schema?.schema_path) {
      const openButton = actions.createEl("button", { text: "Open schema.md" });
      openButton.addEventListener("click", () => {
        this.app.workspace.openLinkText(schema.schema_path, "", false);
      });
    }
  }

  private renderIssues(container: HTMLElement, issues: DashboardIssue[]): void {
    const critical = issues.filter((issue) => issue.severity === "critical").length;
    const warnings = issues.filter((issue) => issue.severity === "warning").length;
    const status: SectionStatus = critical > 0
      ? { label: `${critical} critical`, tone: "critical" }
      : warnings > 0
        ? { label: `${warnings} warning${warnings === 1 ? "" : "s"}`, tone: "warning" }
        : { label: "Clear", tone: "good" };

    const section = createSection(container, "Active Issues", status);
    if (issues.length === 0) {
      section.createDiv({ text: "No active lint issues in the latest snapshot.", cls: "forge-health-muted" });
      return;
    }

    const list = section.createDiv("forge-health-issue-list");
    for (const issue of issues.slice(0, 80)) {
      const row = list.createDiv(`forge-health-issue forge-health-issue-${issue.severity}`);
      const main = row.createDiv("forge-health-issue-main");
      main.createDiv({ text: issue.file_path, cls: "forge-health-issue-path" });
      main.createDiv({ text: `[${issue.issue_type}] ${issue.message}`, cls: "forge-health-issue-message" });
      if (issue.suggested_action) {
        main.createDiv({ text: issue.suggested_action, cls: "forge-health-issue-action" });
      }

      const openButton = row.createEl("button", { text: "Open" });
      openButton.addEventListener("click", () => {
        this.app.workspace.openLinkText(issue.file_path, "", false);
      });
    }
  }

  private renderOntology(container: HTMLElement, snapshot: DashboardSnapshot): void {
    const ontology = snapshot.ontology;
    const section = createSection(
      container,
      "Ontology Metrics",
      ontology
        ? { label: "Indexed", tone: "good" }
        : { label: "No data", tone: "muted" }
    );
    if (!ontology) {
      section.createDiv({ text: "Ontology metrics have not been collected yet.", cls: "forge-health-muted" });
      return;
    }

    section.createDiv({
      text: `Last export ${formatRelativeWithExactDate(ontology.generated_at)}`,
      cls: "forge-health-section-meta",
    });

    const grid = section.createDiv("forge-health-metric-grid");
    for (const [label, value] of [
      ["Total shapes", ontology.shape_count],
      ["Total templates", ontology.template_count],
      ["Relationship types", ontology.relationship_type_count],
      ["Tracked tags", Object.keys(ontology.tag_distribution).length],
    ]) {
      const item = grid.createDiv("forge-health-metric");
      item.createDiv({ text: String(value), cls: "forge-health-metric-value" });
      item.createDiv({ text: String(label), cls: "forge-health-metric-label" });
    }

    const folders = Object.entries(ontology.folder_coverage).slice(0, 8);
    if (folders.length > 0) {
      const folderList = section.createDiv("forge-health-chip-list");
      for (const [folder, count] of folders) {
        folderList.createDiv({ text: `${folder}: ${count}`, cls: "forge-health-chip" });
      }
    }
  }

  private renderHistory(container: HTMLElement, snapshot: DashboardSnapshot): void {
    const history = snapshot.patch_history;
    const section = createSection(
      container,
      "Maintenance History",
      history?.last_patch_run ? { label: "Tracked", tone: "good" } : { label: "No patch history", tone: "muted" }
    );
    if (!history) {
      section.createDiv({ text: "No maintenance history has been read yet.", cls: "forge-health-muted" });
      return;
    }

    const rows = [
      ["Last patch run", history.last_patch_run?.applied_at ? formatRelativeWithExactDate(history.last_patch_run.applied_at) : "—"],
      ["Patch restore points", history.restored_runs_available],
      ["Lint scans in history", history.lint_scans],
      ["Last repair run", history.last_repair_run?.applied_at ? formatRelativeWithExactDate(history.last_repair_run.applied_at) : "—"],
      ["Last normalization run", history.last_normalization_run?.applied_at ? formatRelativeWithExactDate(history.last_normalization_run.applied_at) : "—"],
    ];

    const table = section.createEl("table", { cls: "forge-health-table" });
    const body = table.createEl("tbody");
    for (const [label, value] of rows) {
      const row = body.createEl("tr");
      row.createEl("td", { text: String(label) });
      row.createEl("td", { text: String(value) });
    }
  }

  private renderRecommendations(container: HTMLElement, snapshot: DashboardSnapshot): void {
    const recommendations: string[] = [];

    if (snapshot.summary.schema_violation_count > 0) {
      recommendations.push("Fix schema.md first so downstream lint and ontology checks use a stable contract.");
    }
    if (snapshot.summary.lint_issue_count > 0) {
      recommendations.push("Review critical lint issues before running repair or normalization workflows.");
    }
    if (!snapshot.patch_history?.last_patch_run) {
      recommendations.push("No patch history is available yet; restore visibility will appear after patch manifests exist.");
    }
    if (recommendations.length === 0) {
      return;
    }

    const section = createSection(container, "Recommendations", { label: `${recommendations.length}`, tone: "warning" });
    const list = section.createEl("ul", { cls: "forge-health-recommendations" });
    for (const recommendation of recommendations) {
      list.createEl("li", { text: recommendation });
    }
  }

  private lintIssues(snapshot: DashboardSnapshot): DashboardIssue[] {
    return snapshot.issues.filter((issue) => !isSchemaIssue(issue));
  }

  private executeCommand(commandId: string): void {
    const fullId = `forge:${commandId}`;
    const commands = (this.app as any).commands;
    if (commands?.executeCommandById) {
      commands.executeCommandById(fullId);
    } else {
      new Notice(`Forge: Could not run command ${fullId}`, 5000);
    }
  }
}

function isSchemaIssue(issue: DashboardIssue): boolean {
  return issue.source_command === "validate-schema" ||
    issue.issue_type.startsWith("schema_") ||
    issue.issue_type === "schema_validation";
}

type SectionStatus = { label: string; tone: "good" | "warning" | "critical" | "muted" };

function createSection(
  container: HTMLElement,
  title: string,
  status?: SectionStatus
): HTMLElement {
  const section = container.createDiv("forge-health-section");
  const header = section.createDiv("forge-health-section-header");
  header.createEl("h3", { text: title });
  if (status) {
    header.createDiv({
      text: status.label,
      cls: `forge-health-section-status is-${status.tone}`,
    });
  }
  return section;
}

function healthLabel(snapshot: DashboardSnapshot): string {
  if (snapshot.summary.schema_violation_count > 0 || snapshot.summary.invalid_frontmatter_count > 0) {
    return "Needs attention";
  }
  if (snapshot.summary.lint_issue_count > 0) return "Watch";
  return "Healthy";
}

function healthClass(snapshot: DashboardSnapshot): string {
  if (snapshot.summary.schema_violation_count > 0 || snapshot.summary.invalid_frontmatter_count > 0) {
    return "is-critical";
  }
  if (snapshot.summary.lint_issue_count > 0) return "is-warning";
  return "is-good";
}

function formatDate(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatRelativeWithExactDate(value: string): string {
  const exact = formatDate(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return exact;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86400000);

  let relative: string;
  if (dayDiff === 0) {
    relative = "Today";
  } else if (dayDiff === 1) {
    relative = "Yesterday";
  } else if (dayDiff > 1 && dayDiff < 7) {
    relative = `${dayDiff} days ago`;
  } else {
    relative = date.toLocaleDateString();
  }

  return `${relative} • ${exact}`;
}
