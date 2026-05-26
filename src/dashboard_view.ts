import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type ForgePlugin from "./main";
import type { DashboardIssue, DashboardSnapshot } from "./dashboard_types";

export const FORGE_HEALTH_DASHBOARD_VIEW = "forge-health-dashboard";

export class ForgeHealthDashboardView extends ItemView {
  private plugin: ForgePlugin;
  private snapshot: DashboardSnapshot | null = null;
  private refreshing = false;
  private expandedIssueGroups = new Set<string>();
  private fullIssueGroups = new Set<string>();

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
    this.renderShapeHealth(contentEl, this.snapshot);
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

    this.renderGroupedIssues(section, issues, "active");
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

  private renderShapeHealth(container: HTMLElement, snapshot: DashboardSnapshot): void {
    const shape = snapshot.shape_lint;
    const critical = shape?.errors ?? 0;
    const warnings = shape?.warnings ?? 0;
    const issueCount = shape?.summary.issue_count ?? 0;
    const status: SectionStatus = !shape
      ? { label: "Not scanned", tone: "muted" }
      : critical > 0
        ? { label: `${critical} critical`, tone: "critical" }
        : issueCount > 0
          ? { label: `${issueCount} issue${issueCount === 1 ? "" : "s"}`, tone: warnings > 0 ? "warning" : "muted" }
          : { label: "Clear", tone: "good" };

    const section = createSection(container, "Shape Health", status);
    if (!shape) {
      section.createDiv({ text: "Shape lint has not been run yet.", cls: "forge-health-muted" });
    } else {
      section.createDiv({
        text: `Last shape lint ${formatRelativeWithExactDate(shape.generated_at)} • ${shape.summary.files_scanned} files scanned`,
        cls: "forge-health-section-meta",
      });

      const grid = section.createDiv("forge-health-metric-grid");
      for (const [label, value] of [
        ["Shape issues", shape.summary.issue_count],
        ["Missing headings", shape.summary.missing_heading_count],
        ["Order issues", shape.summary.heading_order_issue_count],
        ["Extra headings", shape.summary.extra_heading_count],
        ["Empty sections", shape.summary.empty_section_count],
      ]) {
        const item = grid.createDiv("forge-health-metric");
        item.createDiv({ text: String(value), cls: "forge-health-metric-value" });
        item.createDiv({ text: String(label), cls: "forge-health-metric-label" });
      }

      if (shape.issues.length > 0) {
        this.renderGroupedIssues(section, shape.issues, "shape");
      } else {
        section.createDiv({ text: "No Shape lint issues found.", cls: "forge-health-muted" });
      }
    }

    const actions = section.createDiv("forge-health-section-actions");
    const shapeLintButton = actions.createEl("button", { text: "Run Shape Lint" });
    shapeLintButton.addEventListener("click", () => this.executeCommand("run-shape-lint"));
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

  private renderGroupedIssues(
    section: HTMLElement,
    issues: DashboardIssue[],
    scope: string
  ): void {
    const groups = groupIssuesByType(issues);
    const controls = section.createDiv("forge-health-issue-controls");
    const expandAll = controls.createEl("button", { text: "Expand all" });
    expandAll.addEventListener("click", () => {
      for (const group of groups) this.expandedIssueGroups.add(issueGroupKey(scope, group.issueType));
      this.render();
    });
    const collapseAll = controls.createEl("button", { text: "Collapse all" });
    collapseAll.addEventListener("click", () => {
      for (const group of groups) {
        const key = issueGroupKey(scope, group.issueType);
        this.expandedIssueGroups.delete(key);
        this.fullIssueGroups.delete(key);
      }
      this.render();
    });

    const list = section.createDiv("forge-health-issue-group-list");
    for (const group of groups) {
      const key = issueGroupKey(scope, group.issueType);
      const expanded = this.expandedIssueGroups.has(key);
      const showAll = this.fullIssueGroups.has(key);
      const visibleIssues = !expanded
        ? []
        : showAll
          ? group.issues
          : group.issues.slice(0, 5);
      const wrapper = list.createDiv("forge-health-issue-group");

      const header = wrapper.createDiv("forge-health-issue-group-header");
      const toggleButton = header.createEl("button", {
        text: expanded ? "-" : "+",
        cls: "forge-health-issue-group-toggle",
      });
      header.createSpan({ text: group.issueType, cls: "forge-health-issue-group-title" });
      header.createSpan({
        text: `${group.issues.length} issue${group.issues.length === 1 ? "" : "s"}`,
        cls: `forge-health-issue-group-count is-${group.maxSeverity}`,
      });
      toggleButton.addEventListener("click", () => {
        if (expanded) {
          this.expandedIssueGroups.delete(key);
          this.fullIssueGroups.delete(key);
        } else {
          this.expandedIssueGroups.add(key);
        }
        this.render();
      });

      const rows = wrapper.createDiv("forge-health-issue-list");
      for (const issue of visibleIssues) {
        this.renderIssueRow(rows, issue);
      }

      if (expanded && group.issues.length > 5) {
        const toggle = wrapper.createEl("button", {
          text: showAll ? "Show first 5" : `Show all ${group.issues.length}`,
          cls: "forge-health-show-more",
        });
        toggle.addEventListener("click", () => {
          if (showAll) {
            this.fullIssueGroups.delete(key);
          } else {
            this.expandedIssueGroups.add(key);
            this.fullIssueGroups.add(key);
          }
          this.render();
        });
      }
    }
  }

  private renderIssueRow(container: HTMLElement, issue: DashboardIssue): void {
    const row = container.createDiv(`forge-health-issue forge-health-issue-${issue.severity}`);
    const main = row.createDiv("forge-health-issue-main");
    main.createDiv({ text: issue.file_path, cls: "forge-health-issue-path" });
    main.createDiv({ text: issue.message, cls: "forge-health-issue-message" });
    if (issue.suggested_action) {
      main.createDiv({ text: issue.suggested_action, cls: "forge-health-issue-action" });
    }

    const openButton = row.createEl("button", { text: "Open" });
    openButton.addEventListener("click", () => {
      this.app.workspace.openLinkText(issue.file_path, "", false);
    });
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

interface IssueGroup {
  issueType: string;
  issues: DashboardIssue[];
  maxSeverity: DashboardIssue["severity"];
}

function groupIssuesByType(issues: DashboardIssue[]): IssueGroup[] {
  const groups = new Map<string, DashboardIssue[]>();

  for (const issue of issues) {
    const group = groups.get(issue.issue_type) ?? [];
    group.push(issue);
    groups.set(issue.issue_type, group);
  }

  return [...groups.entries()]
    .map(([issueType, groupIssues]) => ({
      issueType,
      issues: groupIssues.sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity)),
      maxSeverity: groupIssues.reduce<DashboardIssue["severity"]>(
        (max, issue) => severityWeight(issue.severity) > severityWeight(max) ? issue.severity : max,
        "info"
      ),
    }))
    .sort((a, b) => {
      const severityDiff = severityWeight(b.maxSeverity) - severityWeight(a.maxSeverity);
      if (severityDiff !== 0) return severityDiff;
      if (b.issues.length !== a.issues.length) return b.issues.length - a.issues.length;
      return a.issueType.localeCompare(b.issueType);
    });
}

function issueGroupKey(scope: string, issueType: string): string {
  return `${scope}:${issueType}`;
}

function severityWeight(severity: DashboardIssue["severity"]): number {
  switch (severity) {
    case "critical":
      return 3;
    case "warning":
      return 2;
    default:
      return 1;
  }
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
