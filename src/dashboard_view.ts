import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type ForgePlugin from "./main";
import type { DashboardAutoRefreshIntervalMinutes } from "./settings";
import type { DashboardIssue, DashboardSnapshot } from "./dashboard_types";

export const FORGE_HEALTH_DASHBOARD_VIEW = "forge-health-dashboard";

// How long to wait after a cache file change before reloading.
// Debounces rapid successive writes (sync flush, multi-leaf saves).
const RELOAD_DEBOUNCE_MS = 500;

// Fallback poll interval for sync clients that don't surface vault modify
// events for remote writes (iCloud, some filesystem sync tools).
const DASHBOARD_POLL_INTERVAL_MS = 5_000;
const AUTO_REFRESH_INTERVALS: DashboardAutoRefreshIntervalMinutes[] = [1, 3, 5, 15, 30];

type AppCommandRegistry = {
  executeCommandById?: (commandId: string) => boolean;
};

type AppWithCommandRegistry = ItemView["app"] & {
  commands?: AppCommandRegistry;
};

export class ForgeHealthDashboardView extends ItemView {
  private plugin: ForgePlugin;
  private snapshot: DashboardSnapshot | null = null;
  private refreshing = false;
  private reloadingSettings = false;
  private autoRefreshEnabled = false;
  private autoRefreshIntervalMinutes: DashboardAutoRefreshIntervalMinutes = 5;
  private expandedIssueGroups = new Set<string>();
  private fullIssueGroups = new Set<string>();

  // Live-reload state
  private reloadDebounceTimer: number | null = null;
  private pollInterval: number | null = null;
  private autoRefreshInterval: number | null = null;
  private lastKnownCacheMtime = 0;

  // Set to true by main.ts when the plugin version changed since last load.
  // Triggers the update banner until the user reloads the leaf.
  needsReload = false;

  constructor(leaf: WorkspaceLeaf, plugin: ForgePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return FORGE_HEALTH_DASHBOARD_VIEW;
  }

  getDisplayText(): string {
    return "Forge health";
  }

  getIcon(): string {
    return "activity";
  }

  private currentNoteLintStatus() {
    return this.plugin.activeFileLintService?.currentFileStatus() ?? null;
  }

  private currentNoteFilePath(): string | null {
    return this.plugin.activeFileLintService?.currentFilePath() ?? null;
  }

  private currentNoteStatusLabel(): string {
    const filePath = this.currentNoteFilePath();
    if (!filePath) return "No note";
    if (!this.plugin.activeFileLintService?.isEnabledForCurrentSession()) return "Off";
    if (this.plugin.activeFileLintService.isCurrentFileLintInFlight()) return "Linting";
    if (this.plugin.activeFileLintService.isCurrentFileDirty()) return "Pending";

    const status = this.currentNoteLintStatus();
    if (!status) return "Not checked";
    if (status.errors > 0) return `${status.errors} error${status.errors === 1 ? "" : "s"}`;
    if (status.warnings > 0) return `${status.warnings} warning${status.warnings === 1 ? "" : "s"}`;
    if (status.infos > 0) return `${status.infos} info${status.infos === 1 ? "" : "s"}`;
    return "Clear";
  }

  async onOpen(): Promise<void> {
    this.snapshot = await this.plugin.dashboardService.loadSnapshot();
    this.render();
    this.startLiveReload();
    this.updateAutoRefreshTimer();
  }

  onClose(): Promise<void> {
    this.stopLiveReload();
    this.stopAutoRefresh();
    return Promise.resolve();
  }

  async reloadFromCache(): Promise<void> {
    this.snapshot = await this.plugin.dashboardService.loadSnapshot();
    this.render();
  }

  async onSettingsReloaded(): Promise<void> {
    this.render();
    await this.reloadFromCache();
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

  async refreshSilently(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;

    try {
      this.snapshot = await this.plugin.dashboardService.refreshSnapshot();
    } catch (e) {
      console.warn("[Forge] auto-refresh-vault-health-dashboard error:", e);
    } finally {
      this.refreshing = false;
      this.render();
    }
  }

  private async setAutoRefreshEnabled(enabled: boolean): Promise<void> {
    this.autoRefreshEnabled = enabled;
    this.updateAutoRefreshTimer();
    this.render();
  }

  private async setAutoRefreshInterval(interval: DashboardAutoRefreshIntervalMinutes): Promise<void> {
    this.autoRefreshIntervalMinutes = interval;
    this.updateAutoRefreshTimer();
    this.render();
  }

  // ── Live reload ─────────────────────────────────────────────────────────────

  private startLiveReload(): void {
    const cachePath = this.plugin.dashboardService.cachePath;

    // Fast path: vault modify event covers local writes and Obsidian Sync.
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file.path === cachePath) {
          this.scheduleReload();
        }
      })
    );

    // Fallback poll: catches iCloud and other filesystem syncs that bypass
    // the vault event system for remote writes.
    this.pollInterval = window.setInterval(() => {
      void (async () => {
        try {
          const stat = await this.app.vault.adapter.stat(cachePath);
          const mtime = stat?.mtime ?? 0;
          if (mtime !== 0 && mtime !== this.lastKnownCacheMtime) {
            this.lastKnownCacheMtime = mtime;
            this.scheduleReload();
          }
        } catch {
          // Cache file doesn't exist yet — nothing to do.
        }
      })();
    }, DASHBOARD_POLL_INTERVAL_MS);
  }

  private stopLiveReload(): void {
    if (this.reloadDebounceTimer !== null) {
      window.clearTimeout(this.reloadDebounceTimer);
      this.reloadDebounceTimer = null;
    }
    if (this.pollInterval !== null) {
      window.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private updateAutoRefreshTimer(): void {
    this.stopAutoRefresh();
    if (!this.autoRefreshEnabled) return;

    const interval = normalizeAutoRefreshInterval(this.autoRefreshIntervalMinutes);
    this.autoRefreshInterval = window.setInterval(() => {
      void this.refreshSilently();
    }, interval * 60_000);
  }

  private stopAutoRefresh(): void {
    if (this.autoRefreshInterval !== null) {
      window.clearInterval(this.autoRefreshInterval);
      this.autoRefreshInterval = null;
    }
  }

  private scheduleReload(): void {
    if (this.reloadDebounceTimer !== null) {
      window.clearTimeout(this.reloadDebounceTimer);
    }
    this.reloadDebounceTimer = window.setTimeout(() => {
      void (async () => {
        this.reloadDebounceTimer = null;
        await this.reloadFromCache();
      })();
    }, RELOAD_DEBOUNCE_MS);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("forge-health-dashboard");

    this.renderAutoRefreshControls(contentEl);

    const header = contentEl.createDiv("forge-health-header");
    const titleBlock = header.createDiv();
    titleBlock.createEl("h2", { text: "Vault health" });

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
    refreshButton.addEventListener("click", () => { void this.refresh(); });

    const settingsButton = actions.createEl("button", { text: "Settings" });
    settingsButton.addEventListener("click", () => this.plugin.openForgeSettings());

    this.renderVersionBanner(contentEl);
    this.renderSettingsReloadBanner(contentEl);

    if (!this.snapshot) {
      const empty = contentEl.createDiv("forge-health-empty");
      empty.createEl("h2", { text: "No cached health snapshot" });
      empty.createEl("p", { text: "Run a manual refresh to scan the vault and populate this dashboard." });
      return;
    }
    this.renderSummary(contentEl, this.snapshot);
    this.renderCurrentNote(contentEl);
    this.renderSchemaHealth(contentEl, this.snapshot);
    this.renderIssues(contentEl, this.lintIssues(this.snapshot));
    if (this.shouldShowOntologySection()) {
      this.renderOntology(contentEl, this.snapshot);
    }
    if (this.shouldShowShapeSection()) {
      this.renderShapeHealth(contentEl, this.snapshot);
    }
    this.renderHistory(contentEl, this.snapshot);
    this.renderRecommendations(contentEl, this.snapshot);
  }

  private renderAutoRefreshControls(container: HTMLElement): void {
    const enabled = this.autoRefreshEnabled;
    const selectedInterval = normalizeAutoRefreshInterval(this.autoRefreshIntervalMinutes);
    const bar = container.createDiv("forge-health-auto-refresh");

    const label = bar.createEl("label", {
      cls: enabled ? "forge-health-auto-refresh-toggle is-enabled" : "forge-health-auto-refresh-toggle",
    });
    const checkbox = label.createEl("input", {
      type: "checkbox",
    });
    checkbox.checked = enabled;
    label.createSpan({ text: "Auto-refresh" });
    checkbox.addEventListener("change", () => {
      void this.setAutoRefreshEnabled(!enabled);
    });

    const intervalGroup = bar.createDiv("forge-health-auto-refresh-intervals");
    const select = intervalGroup.createEl("select", {
      cls: "forge-health-auto-refresh-select",
    });
    select.disabled = !enabled;
    select.setAttr("aria-label", "Auto-refresh interval");

    for (const interval of AUTO_REFRESH_INTERVALS) {
      const option = select.createEl("option", {
        text: `${interval} min`,
        value: String(interval),
      });
      option.selected = interval === selectedInterval;
    }

    select.addEventListener("change", () => {
      const interval = Number(select.value);
      if (isAutoRefreshInterval(interval)) {
        void this.setAutoRefreshInterval(interval);
      }
    });
  }

  // ── Version banner ──────────────────────────────────────────────────────────

  private renderVersionBanner(container: HTMLElement): void {
    if (!this.needsReload) return;

    const banner = container.createDiv("forge-update-banner");
    banner.createSpan({
      text: `Forge updated to ${this.plugin.manifest.version}. Reload to apply new layout.`,
      cls: "forge-update-banner-text",
    });

    const reloadBtn = banner.createEl("button", {
      text: "Reload",
      cls: "forge-update-banner-reload",
    });
    reloadBtn.addEventListener("click", () => { void (async () => {
      // Detach the current leaf entirely, then reopen via the plugin command.
      // setViewState on the same leaf won't reinstantiate — we need a fresh leaf.
      const leaf = this.leaf;
      leaf.detach();
      await this.plugin.openHealthDashboard();
    })(); });

    const dismissBtn = banner.createEl("button", {
      text: "Dismiss",
      cls: "forge-update-banner-dismiss",
    });
    dismissBtn.addEventListener("click", () => banner.remove());
  }

  private renderSettingsReloadBanner(container: HTMLElement): void {
    if (!this.plugin.hasPendingExternalSettingsReload) return;

    const banner = container.createDiv("forge-update-banner");
    banner.createSpan({
      text: "Settings changed on another device. Reload to apply the synced changes.",
      cls: "forge-update-banner-text",
    });

    const reloadBtn = banner.createEl("button", {
      text: this.reloadingSettings ? "Reloading..." : "Reload",
      cls: "forge-update-banner-reload",
    });
    reloadBtn.disabled = this.reloadingSettings;
    reloadBtn.addEventListener("click", () => { void (async () => {
      if (this.reloadingSettings) return;
      this.reloadingSettings = true;
      this.render();

      try {
        await this.plugin.reloadSettingsFromDisk();
      } catch (e) {
        new Notice(`Forge: ${e instanceof Error ? e.message : "Could not reload synced settings"}`, 6000);
        console.error("[Forge] reload-synced-settings error:", e);
      } finally {
        this.reloadingSettings = false;
        this.render();
      }
    })(); });

    const dismissBtn = banner.createEl("button", {
      text: "Dismiss",
      cls: "forge-update-banner-dismiss",
    });
    dismissBtn.disabled = this.reloadingSettings;
    dismissBtn.addEventListener("click", () => {
      this.plugin.hasPendingExternalSettingsReload = false;
      this.render();
    });
  }

  // ── Sections ────────────────────────────────────────────────────────────────

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
    const lintButton = actions.createEl("button", { text: "Run vault lint", cls: "forge-health-action-button forge-health-action-primary" });
    lintButton.addEventListener("click", () => this.executeCommand("run-vault-lint"));
    const maintenanceButton = actions.createEl("button", { text: "Vault maintenance", cls: "forge-health-action-button forge-health-action-primary" });
    maintenanceButton.addEventListener("click", () => this.executeCommand("vault-maintenance"));
    const frontmatterButton = actions.createEl("button", { text: "Normalize frontmatter", cls: "forge-health-action-button forge-health-action-secondary" });
    frontmatterButton.addEventListener("click", () => this.executeCommand("normalize-frontmatter"));
    const tagsButton = actions.createEl("button", { text: "Normalize tags", cls: "forge-health-action-button forge-health-action-secondary" });
    tagsButton.addEventListener("click", () => this.executeCommand("normalize-tags"));

    const grid = section.createDiv("forge-health-metric-grid");
    const metrics = [
      ["Notes scanned", snapshot.summary.notes_scanned],
      ["Lint issues", snapshot.summary.lint_issue_count],
      ["Current note", this.currentNoteStatusLabel()],
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

  private renderCurrentNote(container: HTMLElement): void {
    const filePath = this.currentNoteFilePath();
    const current = this.currentNoteLintStatus();
    const enabled = this.plugin.activeFileLintService?.isEnabledForCurrentSession() ?? false;
    const dirty = this.plugin.activeFileLintService?.isCurrentFileDirty() ?? false;
    const inFlight = this.plugin.activeFileLintService?.isCurrentFileLintInFlight() ?? false;

    const status: SectionStatus = !filePath
      ? { label: "No note", tone: "muted" }
      : !enabled
        ? { label: "Off", tone: "muted" }
        : inFlight
          ? { label: "Linting", tone: "warning" }
          : dirty
            ? { label: "Pending", tone: "warning" }
            : current?.errors
              ? { label: `${current.errors} error${current.errors === 1 ? "" : "s"}`, tone: "critical" }
              : (current?.warnings ?? 0) > 0
                ? { label: `${current?.warnings} warning${current?.warnings === 1 ? "" : "s"}`, tone: "warning" }
                : (current?.infos ?? 0) > 0
                  ? { label: `${current?.infos} info${current?.infos === 1 ? "" : "s"}`, tone: "muted" }
                : current
                  ? { label: "Clear", tone: "good" }
                  : { label: "Not checked", tone: "muted" };

    const section = createSection(container, "Current Note", status);

    if (!filePath) {
      section.createDiv({ text: "Open a markdown note to see its active lint status here.", cls: "forge-health-muted" });
      return;
    }

    section.createDiv({ text: filePath, cls: "forge-health-section-meta" });

    if (!enabled) {
      section.createDiv({ text: "Active-file auto-lint is turned off in settings.", cls: "forge-health-muted" });
      return;
    }

    if (inFlight) {
      section.createDiv({ text: "Linting the current note now.", cls: "forge-health-muted" });
      return;
    }

    if (dirty) {
      section.createDiv({ text: "Current note has changes waiting for the next auto-lint run.", cls: "forge-health-muted" });
      return;
    }

    if (!current) {
      section.createDiv({ text: "Current note has not been linted yet in this session.", cls: "forge-health-muted" });
      return;
    }

    section.createDiv({
      text: `Last checked ${formatRelativeWithExactDate(current.generatedAt)}`,
      cls: "forge-health-section-meta",
    });

    const summary = section.createDiv("forge-health-inline-summary");
    summary.createSpan({ text: `${current.errors} error${current.errors === 1 ? "" : "s"}` });
    summary.createSpan({ text: " • " });
    summary.createSpan({ text: `${current.warnings} warning${current.warnings === 1 ? "" : "s"}` });
    summary.createSpan({ text: " • " });
    summary.createSpan({ text: `${current.infos} info${current.infos === 1 ? "" : "s"}` });

    if (current.issues.length === 0) {
      section.createDiv({ text: "No issues found for the current note.", cls: "forge-health-muted" });
      return;
    }

    this.renderGroupedIssues(section, current.issues, "current-note");
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
    const validateButton = actions.createEl("button", { text: "Validate schema", cls: "forge-health-action-button forge-health-action-primary" });
    validateButton.addEventListener("click", () => this.executeCommand("validate-schema"));

    if (schema?.schema_path) {
      const openButton = actions.createEl("button", { text: "Open schema.md", cls: "forge-health-action-button forge-health-action-secondary" });
      openButton.addEventListener("click", () => {
        void this.app.workspace.openLinkText(schema.schema_path, "", false);
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
    const actions = section.createDiv("forge-health-section-actions");
    const repairButton = actions.createEl("button", { text: "Vault repair", cls: "forge-health-action-button forge-health-action-primary" });
    repairButton.addEventListener("click", () => this.executeCommand("vault-repair"));
    if (issues.length === 0) {
      section.createDiv({ text: "No active lint issues in the latest snapshot.", cls: "forge-health-muted" });
      return;
    }

    this.renderGroupedIssues(section, issues, "active");
  }

  private renderOntology(container: HTMLElement, snapshot: DashboardSnapshot): void {
    const ontology = snapshot.ontology;
    const exportEnabled = this.plugin.settings.exportEnabled;
    const section = createSection(
      container,
      "Ontology",
      ontology
        ? { label: "Indexed", tone: "good" }
        : { label: "No data", tone: "muted" }
    );
    const actions = section.createDiv("forge-health-section-actions");
    const refreshButton = actions.createEl("button", { text: "Refresh metrics", cls: "forge-health-action-button forge-health-action-primary" });
    refreshButton.addEventListener("click", () => this.executeCommand("refresh-ontology-metrics"));
    if (exportEnabled) {
      const exportButton = actions.createEl("button", { text: "Export vault overview", cls: "forge-health-action-button forge-health-action-secondary" });
      exportButton.addEventListener("click", () => this.executeCommand("export-vault-snapshot"));
      const ontologyExportButton = actions.createEl("button", { text: "Export ontology index", cls: "forge-health-action-button forge-health-action-secondary" });
      ontologyExportButton.addEventListener("click", () => this.executeCommand("export-ontology-index"));
    }
    if (this.plugin.settings.dataviewExpansionEnabled) {
      const expansionActions = section.createDiv("forge-health-section-actions");
      const dataviewAvailable = this.plugin.dataviewExpansionService?.isDataviewAvailable?.() ?? false;
      const refreshNoteButton = expansionActions.createEl("button", {
        text: "Refresh note expansion",
        cls: "forge-health-action-button forge-health-action-secondary",
      });
      refreshNoteButton.disabled = !dataviewAvailable;
      refreshNoteButton.title = dataviewAvailable
        ? "Refresh Dataview Expansion for the active note"
        : "Dataview must be installed and enabled";
      refreshNoteButton.addEventListener("click", () => {
        void this.plugin.dataviewExpansionService.refreshActiveFile(true);
      });

      const refreshFolderButton = expansionActions.createEl("button", {
        text: "Refresh folder expansion",
        cls: "forge-health-action-button forge-health-action-secondary",
      });
      refreshFolderButton.disabled = !dataviewAvailable;
      refreshFolderButton.title = dataviewAvailable
        ? "Refresh Dataview Expansion in the active note's folder"
        : "Dataview must be installed and enabled";
      refreshFolderButton.addEventListener("click", () => {
        void this.plugin.dataviewExpansionService.refreshCurrentFolder(true);
      });

      const refreshVaultButton = expansionActions.createEl("button", {
        text: "Refresh vault expansion",
        cls: "forge-health-action-button forge-health-action-secondary",
      });
      refreshVaultButton.disabled = !dataviewAvailable;
      refreshVaultButton.title = dataviewAvailable
        ? "Refresh Dataview Expansion across the whole vault"
        : "Dataview must be installed and enabled";
      refreshVaultButton.addEventListener("click", () => {
        void this.plugin.dataviewExpansionService.refreshWholeVault(true);
      });
    }
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
    const shapeLintEnabled = this.plugin.settings.shapeLintEnabled;
    const shapeRefinementEnabled = this.plugin.settings.shapeRefinementEnabled;
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
    if (shapeLintEnabled) {
      const shapeLintButton = actions.createEl("button", { text: "Run shape lint", cls: "forge-health-action-button forge-health-action-primary" });
      shapeLintButton.addEventListener("click", () => this.executeCommand("run-shape-lint"));
    }
    if (shapeRefinementEnabled) {
      const refineButton = actions.createEl("button", { text: "Refine templates", cls: "forge-health-action-button forge-health-action-secondary" });
      refineButton.addEventListener("click", () => this.executeCommand("refine-shapes"));
    }
  }

  private shouldShowOntologySection(): boolean {
    return this.plugin.settings.exportEnabled || this.plugin.settings.dataviewExpansionEnabled;
  }

  private shouldShowShapeSection(): boolean {
    return this.plugin.settings.shapesEnabled;
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

    const actions = section.createDiv("forge-health-section-actions");
    const restoreButton = actions.createEl("button", { text: "Restore patch run", cls: "forge-health-action-button forge-health-action-primary" });
    restoreButton.addEventListener("click", () => this.executeCommand("restore-patch-run"));
    const historyButton = actions.createEl("button", { text: "View patch history", cls: "forge-health-action-button forge-health-action-secondary" });
    historyButton.addEventListener("click", () => this.executeCommand("view-patch-history"));
    const lastRunButton = actions.createEl("button", { text: "View last run", cls: "forge-health-action-button forge-health-action-secondary" });
    lastRunButton.addEventListener("click", () => this.executeCommand("view-last-run"));
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

  // ── Issue rendering ─────────────────────────────────────────────────────────

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
      void this.app.workspace.openLinkText(issue.file_path, "", false);
    });
  }

  // ── Utilities ───────────────────────────────────────────────────────────────

  private executeCommand(commandId: string): void {
    const fullId = `forge:${commandId}`;
    const commands = (this.app as AppWithCommandRegistry).commands;
    if (commands?.executeCommandById) {
      commands.executeCommandById(fullId);
    } else {
      new Notice(`Forge: Could not run command ${fullId}`, 5000);
    }
  }
}

// ── Module-level helpers ─────────────────────────────────────────────────────

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

function isAutoRefreshInterval(value: number): value is DashboardAutoRefreshIntervalMinutes {
  return AUTO_REFRESH_INTERVALS.includes(value as DashboardAutoRefreshIntervalMinutes);
}

function normalizeAutoRefreshInterval(value: number): DashboardAutoRefreshIntervalMinutes {
  return isAutoRefreshInterval(value) ? value : 5;
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
