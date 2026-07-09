import { ItemView, Notice, WorkspaceLeaf, normalizePath } from "obsidian";
import type ForgePlugin from "./main";
import type { DashboardAutoRefreshIntervalMinutes } from "./settings";
import type { DashboardIssue, DashboardSnapshot } from "./dashboard_types";
import { runExportOverview } from "./commands/export-overview";
import { runExportOntology } from "./commands/export-ontology";
import { runVaultMaintenance } from "./commands/maintenance";
import { runNormalizeFrontmatter, runNormalizeTags } from "./commands/normalize";
import { runRefineShapes } from "./commands/refine-shapes";
import { runVaultRepair } from "./commands/repair";
import { runRestorePatch } from "./commands/restore-patch";
import { runVaultLint } from "./commands/run-lint";
import { runShapeLint } from "./commands/run-shape-lint";
import { runValidateSchema } from "./commands/validate-schema";
import { getVaultPaths } from "./vault-paths";

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
  commands?: Record<string, AppCommand>;
};

type AppCommand = {
  id?: string;
  name?: string;
};

type AppPluginManifest = {
  id?: string;
  name?: string;
};

type AppPluginManager = {
  enabledPlugins?: Set<string> | string[];
  manifests?: Record<string, AppPluginManifest>;
  plugins?: Record<string, unknown>;
  getPlugin?: (pluginId: string) => unknown;
};

type LockblockVaultState = "locked" | "unlocked" | "not-setup" | "unknown";

type LockblockPluginLike = {
  getVaultLockState?: () => LockblockVaultState;
  onLockStateChange?: (callback: (state: LockblockVaultState) => void) => () => void;
};

type AppWithCommandRegistry = ItemView["app"] & {
  commands?: AppCommandRegistry;
};

type AppWithPlugins = AppWithCommandRegistry & {
  plugins?: AppPluginManager;
};

interface DashboardActionOptions {
  key: string;
  label: string;
  runningLabel?: string;
  tone?: "primary" | "secondary" | "destructive";
  title?: string;
  disabled?: boolean;
  onClick: () => Promise<unknown>;
}

interface ShapeFileIssueGroup {
  path: string;
  issues: DashboardIssue[];
  maxSeverity: DashboardIssue["severity"];
  issueTypes: string[];
}

export class ForgeHealthDashboardView extends ItemView {
  private plugin: ForgePlugin;
  private snapshot: DashboardSnapshot | null = null;
  private refreshing = false;
  private reloadingSettings = false;
  private autoRefreshEnabled = false;
  private autoRefreshIntervalMinutes: DashboardAutoRefreshIntervalMinutes = 5;
  private expandedIssueGroups = new Set<string>();
  private fullIssueGroups = new Set<string>();
  private collapsedSections = new Set<string>();
  private runningActions = new Set<string>();

  // Live-reload state
  private reloadDebounceTimer: number | null = null;
  private pollInterval: number | null = null;
  private autoRefreshInterval: number | null = null;
  private lastKnownCacheMtime = 0;
  private lastKnownLockblockAvailable: boolean | null = null;
  private lastKnownLockblockState: LockblockVaultState | null = null;
  private lastKnownDataviewAvailable: boolean | null = null;
  private lockblockStateUnsubscribe: (() => void) | null = null;
  private subscribedLockblockPluginId: string | null = null;

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

  async onOpen(): Promise<void> {
    this.snapshot = await this.plugin.dashboardService.loadSnapshot();
    this.lastKnownLockblockAvailable = this.isLockblockAvailable();
    this.lastKnownLockblockState = this.lockblockVaultState();
    this.lastKnownDataviewAvailable = this.isDataviewAvailable();
    this.syncLockblockStateSubscription();
    this.render();
    this.startLiveReload();
    this.updateAutoRefreshTimer();
  }

  onClose(): Promise<void> {
    this.stopLiveReload();
    this.stopAutoRefresh();
    this.clearLockblockStateSubscription();
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
    // the vault event system for remote writes, and keeps optional plugin
    // integrations in sync when another plugin is enabled or disabled.
    this.pollInterval = window.setInterval(() => {
      void (async () => {
        const lockblockAvailable = this.isLockblockAvailable();
        if (lockblockAvailable !== this.lastKnownLockblockAvailable) {
          this.lastKnownLockblockAvailable = lockblockAvailable;
          this.syncLockblockStateSubscription();
          this.render();
        }

        const lockblockState = this.lockblockVaultState();
        if (lockblockState !== this.lastKnownLockblockState) {
          this.lastKnownLockblockState = lockblockState;
          this.render();
        }

        const dataviewAvailable = this.isDataviewAvailable();
        if (dataviewAvailable !== this.lastKnownDataviewAvailable) {
          this.lastKnownDataviewAvailable = dataviewAvailable;
          this.render();
        }

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
    const previousScrollTop = contentEl.scrollTop;
    const shouldRestoreScroll = contentEl.childElementCount > 0;
    const focusedKey = this.focusedElementKey();

    contentEl.empty();
    contentEl.addClass("forge-health-dashboard");

    this.renderAutoRefreshControls(contentEl);

    const header = contentEl.createDiv("forge-health-header");
    if (this.snapshot) {
      header.setAttr("data-status", healthStatus(this.snapshot));
    }
    const titleBlock = header.createDiv();
    titleBlock.createEl("h1", { text: "Vault Health" });

    const actions = header.createDiv("forge-health-actions");
    if (this.snapshot) {
      actions.createDiv({
        text: `${healthPillLabel(this.snapshot)} • ${this.snapshot.duration_ms} ms`,
        cls: "forge-health-pill",
        attr: { "data-status": healthStatus(this.snapshot) },
      });
    }

    const refreshButton = actions.createEl("button", {
      text: this.refreshing ? "Refreshing..." : "Refresh",
      cls: "mod-cta forge-health-header-action forge-health-header-primary",
    });
    refreshButton.setAttr("data-forge-focus-key", "header:refresh");
    refreshButton.disabled = this.refreshing;
    refreshButton.addEventListener("click", () => { void this.refresh(); });

    const settingsButton = actions.createEl("button", {
      text: "Settings",
      cls: "forge-health-header-action forge-health-header-secondary",
    });
    settingsButton.setAttr("data-forge-focus-key", "header:settings");
    settingsButton.addEventListener("click", () => this.plugin.openForgeSettings());

    this.renderVersionBanner(contentEl);
    this.renderSettingsReloadBanner(contentEl);

    if (!this.snapshot) {
      const empty = contentEl.createDiv("forge-health-empty");
      empty.createEl("h2", { text: "No cached health snapshot" });
      empty.createEl("p", { text: "Run a manual refresh to scan the vault and populate this dashboard." });
      this.renderLockblockControls(contentEl);
      this.restoreRenderState(previousScrollTop, shouldRestoreScroll, focusedKey);
      return;
    }
    this.renderSummary(contentEl, this.snapshot);
    this.renderCurrentNote(contentEl, this.snapshot);
    this.renderLockblockControls(contentEl);
    this.renderSchemaHealth(contentEl, this.snapshot);
    this.renderIssues(contentEl, this.lintIssues(this.snapshot));
    this.renderNeedsReview(contentEl, this.snapshot);
    if (this.shouldShowOntologySection()) {
      this.renderOntology(contentEl, this.snapshot);
    }
    if (this.shouldShowShapeSection()) {
      this.renderShapeHealth(contentEl, this.snapshot);
    }
    this.renderHistory(contentEl, this.snapshot);
    this.renderRecommendations(contentEl, this.snapshot);
    this.restoreRenderState(previousScrollTop, shouldRestoreScroll, focusedKey);
  }

  private focusedElementKey(): string | null {
    const activeElement = this.contentEl.ownerDocument.activeElement;
    if (!(activeElement instanceof HTMLElement)) return null;
    if (!this.contentEl.contains(activeElement)) return null;
    return activeElement.dataset.forgeFocusKey ?? null;
  }

  private restoreRenderState(scrollTop: number, shouldRestoreScroll: boolean, focusedKey: string | null): void {
    const restore = () => {
      if (!this.contentEl.isConnected) return;
      if (shouldRestoreScroll) {
        this.contentEl.scrollTop = scrollTop;
      }
      if (focusedKey) {
        this.findFocusableByKey(focusedKey)?.focus();
      }
    };

    restore();
    window.requestAnimationFrame(restore);
  }

  private findFocusableByKey(focusedKey: string): HTMLElement | null {
    const elements = this.contentEl.querySelectorAll<HTMLElement>("[data-forge-focus-key]");
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index];
      if (element.dataset.forgeFocusKey === focusedKey && !element.hasAttribute("disabled")) {
        return element;
      }
    }
    return null;
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
    checkbox.setAttr("data-forge-focus-key", "auto-refresh:enabled");
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
    select.setAttr("data-forge-focus-key", "auto-refresh:interval");

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

  private toggleSection(sectionKey: string): void {
    if (this.collapsedSections.has(sectionKey)) {
      this.collapsedSections.delete(sectionKey);
    } else {
      this.collapsedSections.add(sectionKey);
    }
    this.render();
  }

  private renderSummary(container: HTMLElement, snapshot: DashboardSnapshot): void {
    const summaryStatus: SectionStatus = snapshot.summary.schema_violation_count > 0 || snapshot.summary.invalid_frontmatter_count > 0
      ? { label: "Needs attention", tone: "critical" }
      : snapshot.summary.lint_issue_count > 0 || snapshot.summary.broken_shape_count > 0
        ? { label: "Watch", tone: "warning" }
        : { label: "Healthy", tone: "good" };

    const section = createSection(container, "summary", "Health Summary", summaryStatus, this.collapsedSections.has("summary"), () => {
      this.toggleSection("summary");
    });
    section.createDiv({
      text: `Last scan ${formatRelativeWithExactDate(snapshot.generated_at)}`,
      cls: "forge-health-section-meta",
    });

    const actions = section.createDiv("forge-health-section-actions");
    this.renderActionButton(actions, {
      key: "run-vault-lint",
      label: "Run vault lint",
      runningLabel: "Running lint...",
      tone: "primary",
      onClick: () => runVaultLint(this.plugin),
    });
    this.renderActionButton(actions, {
      key: "vault-maintenance",
      label: "Vault maintenance",
      runningLabel: "Checking...",
      tone: "destructive",
      onClick: () => runVaultMaintenance(this.plugin),
    });
    this.renderActionButton(actions, {
      key: "normalize-frontmatter",
      label: "Normalize frontmatter",
      runningLabel: "Normalizing...",
      tone: "destructive",
      onClick: () => runNormalizeFrontmatter(this.plugin),
    });
    this.renderActionButton(actions, {
      key: "normalize-tags",
      label: "Normalize tags",
      runningLabel: "Normalizing...",
      tone: "destructive",
      onClick: () => runNormalizeTags(this.plugin),
    });

    const grid = section.createDiv("forge-health-metric-grid");
    const metrics = [
      ["Notes scanned", snapshot.summary.notes_scanned],
      ["Lint issues", snapshot.summary.lint_issue_count],
      ["Needs review", snapshot.summary.review_item_count ?? 0],
      ["Schema violations", snapshot.summary.schema_violation_count],
    ];
    if (snapshot.summary.invalid_frontmatter_count > 0) {
      metrics.push(["Invalid frontmatter", snapshot.summary.invalid_frontmatter_count]);
    }
    if (snapshot.summary.normalization_candidates !== null) {
      metrics.push(["Normalization candidates", snapshot.summary.normalization_candidates]);
    }
    if (this.plugin.settings.shapeLintEnabled) {
      metrics.push(["Shape lint issues", snapshot.summary.broken_shape_count]);
    }

    for (const [label, value] of metrics) {
      const item = grid.createDiv("forge-health-metric");
      item.createDiv({ text: String(value), cls: "forge-health-metric-value" });
      item.createDiv({ text: String(label), cls: "forge-health-metric-label" });
    }

    if (snapshot.summary.normalization_candidates !== null) {
      section.createDiv({
        text: "Normalization candidates reflect the latest recorded normalization workflow.",
        cls: "forge-health-section-message",
      });
    }
  }

  private renderCurrentNote(container: HTMLElement, snapshot: DashboardSnapshot): void {
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
                : (current?.reviewItems ?? 0) > 0
                  ? { label: "Needs review", tone: "muted" }
                : (current?.infos ?? 0) > 0
                  ? { label: `${current?.infos} info${current?.infos === 1 ? "" : "s"}`, tone: "muted" }
                  : current?.exempt
                    ? { label: "Exempt", tone: "muted" }
                    : current
                      ? { label: "Clear", tone: "good" }
                      : { label: "Not checked", tone: "muted" };

    const section = createSection(container, "current-note", "Current Note", status, this.collapsedSections.has("current-note"), () => {
      this.toggleSection("current-note");
    });

    if (!filePath) {
      section.createDiv({ text: "Open a markdown note to see its active lint status here.", cls: "forge-health-muted" });
      return;
    }

    section.createDiv({ text: filePath, cls: "forge-health-section-meta" });
    this.renderCurrentNoteShapeStatus(section, snapshot, filePath);

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

    if (current.exempt && current.issues.length === 0) {
      section.createDiv({ text: "This note is exempt from lint checks.", cls: "forge-health-muted" });
      return;
    }

    const summary = section.createDiv("forge-health-inline-summary");
    summary.createSpan({ text: `${current.errors} error${current.errors === 1 ? "" : "s"}` });
    summary.createSpan({ text: " • " });
    summary.createSpan({ text: `${current.warnings} warning${current.warnings === 1 ? "" : "s"}` });
    summary.createSpan({ text: " • " });
    summary.createSpan({ text: `${current.infos} info${current.infos === 1 ? "" : "s"}` });
    summary.createSpan({ text: " • " });
    summary.createSpan({ text: `${current.reviewItems} needs review` });

    if (current.issues.length === 0 && current.reviewIssues.length === 0) {
      section.createDiv({ text: "No active-file lint issues found for the current note.", cls: "forge-health-muted" });
      return;
    }

    if (current.issues.length > 0) {
      this.renderGroupedIssues(section, current.issues, "current-note");
    }

    if (current.reviewIssues.length > 0) {
      section.createEl("h3", { text: "Needs Review" });
      this.renderGroupedIssues(section, current.reviewIssues, "current-note-review");
    }
  }

  private renderCurrentNoteShapeStatus(section: HTMLElement, snapshot: DashboardSnapshot, filePath: string): void {
    if (!this.plugin.settings.shapeLintEnabled && !snapshot.shape_lint) return;

    const summary = section.createDiv("forge-health-inline-summary");
    summary.createSpan({ text: "Shape" });
    summary.createSpan({ text: " • " });

    const shape = snapshot.shape_lint;
    if (!shape) {
      summary.createSpan({ text: "Not scanned in latest dashboard snapshot" });
      return;
    }

    const normalizedFilePath = normalizePath(filePath);
    const issues = shape.issues.filter((issue) => normalizePath(issue.file_path) === normalizedFilePath);
    if (issues.length === 0) {
      summary.createSpan({ text: "No recorded shape issues" });
      return;
    }

    const critical = issues.filter((issue) => issue.severity === "critical").length;
    const warnings = issues.filter((issue) => issue.severity === "warning").length;
    summary.createSpan({
      text: `${issues.length} issue${issues.length === 1 ? "" : "s"}`,
    });
    if (critical > 0 || warnings > 0) {
      summary.createSpan({ text: ` (${critical} critical, ${warnings} warning${warnings === 1 ? "" : "s"})` });
    }
    summary.createSpan({ text: ` • ${topIssueTypes(issues, 2).map(formatIssueType).join(", ")}` });
  }

  private renderSchemaHealth(container: HTMLElement, snapshot: DashboardSnapshot): void {
    const schema = snapshot.schema;
    const currentSchemaPath = getVaultPaths(this.plugin.settings).schemaMd;
    const schemaPathChanged = Boolean(schema?.schema_path && schema.schema_path !== currentSchemaPath);
    const status: SectionStatus = !schema
      ? { label: "Not validated", tone: "muted" }
      : schemaPathChanged
        ? { label: "Needs validation", tone: "warning" }
      : schema.errors > 0
        ? { label: "Invalid", tone: "critical" }
        : schema.warnings > 0
          ? { label: "Warnings", tone: "warning" }
          : { label: "Valid", tone: "good" };

    const section = createSection(container, "schema-health", "Schema Health", status, this.collapsedSections.has("schema-health"), () => {
      this.toggleSection("schema-health");
    });
    if (!schema) {
      section.createDiv({ text: "Schema has not been validated in the latest dashboard cache.", cls: "forge-health-muted" });
      section.createDiv({ text: currentSchemaPath, cls: "forge-health-section-meta" });
    } else {
      section.createDiv({
        text: schemaPathChanged
          ? `Last validated ${formatRelativeWithExactDate(schema.generated_at)} for ${schema.schema_path}`
          : `Last validated ${formatRelativeWithExactDate(schema.generated_at)}`,
        cls: "forge-health-section-meta",
      });

      const summary = section.createDiv("forge-health-inline-summary");
      summary.createSpan({ text: `${schema.errors} error${schema.errors === 1 ? "" : "s"}` });
      summary.createSpan({ text: " • " });
      summary.createSpan({ text: `${schema.warnings} warning${schema.warnings === 1 ? "" : "s"}` });
      summary.createSpan({ text: " • " });
      summary.createSpan({ text: currentSchemaPath });
    }

    const actions = section.createDiv("forge-health-section-actions");
    this.renderActionButton(actions, {
      key: "validate-schema",
      label: "Validate schema",
      runningLabel: "Validating...",
      tone: "primary",
      onClick: () => runValidateSchema(this.plugin),
    });

    if (currentSchemaPath) {
      const openButton = actions.createEl("button", { text: "Open schema.md", cls: "forge-health-action-button forge-health-action-secondary" });
      openButton.setAttr("data-forge-focus-key", "schema:open");
      openButton.addEventListener("click", () => {
        void this.app.workspace.openLinkText(currentSchemaPath, "", false);
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

    const section = createSection(container, "active-issues", "Active Issues", status, this.collapsedSections.has("active-issues"), () => {
      this.toggleSection("active-issues");
    });
    const actions = section.createDiv("forge-health-section-actions");
    this.renderActionButton(actions, {
      key: "vault-repair",
      label: "Vault repair",
      runningLabel: "Opening repair...",
      tone: "destructive",
      onClick: () => runVaultRepair(this.plugin),
    });
    if (issues.length === 0) {
      section.createDiv({ text: "No active lint issues in the latest snapshot.", cls: "forge-health-muted" });
      return;
    }

    this.renderGroupedIssues(section, issues, "active");
  }

  private renderNeedsReview(container: HTMLElement, snapshot: DashboardSnapshot): void {
    const items = snapshot.review_items ?? [];
    const status: SectionStatus = items.length > 0
      ? { label: `${items.length} item${items.length === 1 ? "" : "s"}`, tone: "muted" }
      : { label: "Clear", tone: "good" };

    const section = createSection(container, "needs-review", "Needs Review", status, this.collapsedSections.has("needs-review"), () => {
      this.toggleSection("needs-review");
    });

    if (items.length === 0) {
      section.createDiv({ text: "No items need review.", cls: "forge-health-muted" });
      return;
    }

    this.renderGroupedIssues(section, items, "needs-review");
  }

  private renderOntology(container: HTMLElement, snapshot: DashboardSnapshot): void {
    const ontology = snapshot.ontology;
    const exportEnabled = this.plugin.settings.exportEnabled;
    const dataviewAvailable = this.isDataviewAvailable();
    const section = createSection(
      container,
      "ontology",
      "Ontology",
      ontology
        ? { label: "Indexed", tone: "good" }
        : { label: "No data", tone: "muted" },
      this.collapsedSections.has("ontology"),
      () => {
        this.toggleSection("ontology");
      }
    );
    const actions = section.createDiv("forge-health-section-actions");
    this.renderActionButton(actions, {
      key: "refresh-ontology-metrics",
      label: "Refresh metrics",
      runningLabel: "Refreshing...",
      tone: "primary",
      onClick: () => this.refreshOntologyMetrics(),
    });
    if (exportEnabled) {
      this.renderActionButton(actions, {
        key: "export-vault-overview",
        label: "Export vault overview",
        runningLabel: "Exporting...",
        onClick: () => runExportOverview(this.plugin),
      });
      this.renderActionButton(actions, {
        key: "export-ontology-index",
        label: "Export ontology index",
        runningLabel: "Exporting...",
        onClick: () => runExportOntology(this.plugin),
      });
    }
    if (this.plugin.settings.dataviewExpansionEnabled && dataviewAvailable) {
      const expansionActions = section.createDiv("forge-health-section-actions");
      this.renderActionButton(expansionActions, {
        key: "refresh-note-expansion",
        label: "Refresh note expansion",
        runningLabel: "Refreshing...",
        title: "Refresh dataview expansion for the active note",
        onClick: () => this.plugin.dataviewExpansionService.refreshActiveFile(true),
      });
      this.renderActionButton(expansionActions, {
        key: "refresh-folder-expansion",
        label: "Refresh folder expansion",
        runningLabel: "Refreshing...",
        title: "Refresh dataview expansion in the active note's folder",
        onClick: () => this.plugin.dataviewExpansionService.refreshCurrentFolder(true),
      });
      this.renderActionButton(expansionActions, {
        key: "refresh-vault-expansion",
        label: "Refresh vault expansion",
        runningLabel: "Refreshing...",
        title: "Refresh dataview expansion across the whole vault",
        onClick: () => this.plugin.dataviewExpansionService.refreshWholeVault(true),
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

    const section = createSection(container, "shape-health", "Shape Health", status, this.collapsedSections.has("shape-health"), () => {
      this.toggleSection("shape-health");
    });
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

      this.renderShapeIssuePreview(section, shape.issues);
    }

    const actions = section.createDiv("forge-health-section-actions");
    if (shapeLintEnabled) {
      this.renderActionButton(actions, {
        key: "run-shape-lint",
        label: "Run shape lint",
        runningLabel: "Running shape lint...",
        tone: "primary",
        onClick: () => runShapeLint(this.plugin),
      });
    }
    if (shapeRefinementEnabled) {
      this.renderActionButton(actions, {
        key: "refine-shapes",
        label: "Refine templates",
        runningLabel: "Refining...",
        onClick: () => runRefineShapes(this.plugin),
      });
    }
  }

  private renderShapeIssuePreview(section: HTMLElement, issues: DashboardIssue[]): void {
    if (issues.length === 0) {
      section.createDiv({ text: "No shape issues recorded in the latest shape lint run.", cls: "forge-health-section-message" });
      return;
    }

    const allGroups = groupShapeIssuesByFile(issues);
    const groups = allGroups.slice(0, 5);
    section.createEl("h3", { text: "Top Shape Issues" });
    const list = section.createDiv("forge-health-preview-list");

    for (const group of groups) {
      const row = list.createDiv({
        cls: "forge-health-preview-row",
        attr: { "data-severity": group.maxSeverity },
      });
      const main = row.createDiv("forge-health-preview-main");
      main.createDiv({ text: group.path, cls: "forge-health-preview-title" });
      main.createDiv({
        text: `${group.issues.length} issue${group.issues.length === 1 ? "" : "s"} • ${group.issueTypes.slice(0, 3).map(formatIssueType).join(", ")}`,
        cls: "forge-health-preview-detail",
      });

      const openButton = row.createEl("button", {
        text: "Open",
        cls: "forge-health-action-button forge-health-action-secondary",
      });
      openButton.setAttr("data-forge-focus-key", `shape-preview:${group.path}`);
      openButton.addEventListener("click", () => {
        void this.app.workspace.openLinkText(group.path, "", false);
      });
    }

    const remainingFiles = allGroups.length - groups.length;
    if (remainingFiles > 0) {
      section.createDiv({
        text: `${remainingFiles} more file${remainingFiles === 1 ? "" : "s"} with shape issues.`,
        cls: "forge-health-section-message",
      });
    }
  }

  private shouldShowOntologySection(): boolean {
    return this.plugin.settings.exportEnabled ||
      (this.plugin.settings.dataviewExpansionEnabled && this.isDataviewAvailable());
  }

  private shouldShowShapeSection(): boolean {
    return this.plugin.settings.shapesEnabled;
  }

  private isDataviewAvailable(): boolean {
    return this.plugin.dataviewExpansionService?.isDataviewAvailable?.() ?? false;
  }

  private renderLockblockControls(container: HTMLElement): void {
    const integration = this.lockblockIntegration();
    if (!integration) return;
    const vaultState = lockblockVaultState(integration.plugin);
    const status = vaultState === "unlocked"
      ? { label: "Unlocked", tone: "warning" as const }
      : vaultState === "locked"
        ? { label: "Locked", tone: "good" as const }
        : vaultState === "not-setup"
          ? { label: "Not set up", tone: "muted" as const }
          : { label: "Enabled", tone: "good" as const };

    const section = createSection(
      container,
      "lockblock",
      "Lockblock",
      status,
      this.collapsedSections.has("lockblock"),
      () => {
        this.toggleSection("lockblock");
      }
    );

    const actions = section.createDiv("forge-health-section-actions");
    const setupCommand = findCommandById(integration.commands, integration.pluginId, "setup");
    const unlockCommand = findCommandById(integration.commands, integration.pluginId, "unlock");
    const lockCommand = findCommandById(integration.commands, integration.pluginId, "lock");
    const changePasswordCommand = findCommandById(integration.commands, integration.pluginId, "change-unlock-password");

    if (vaultState === "not-setup") {
      this.renderLockblockCommandButton(actions, "Set up", setupCommand);
    }
    if (vaultState === "locked" || vaultState === "unknown") {
      this.renderLockblockCommandButton(actions, "Unlock vault", unlockCommand);
    }
    if (vaultState === "unlocked" || vaultState === "unknown") {
      this.renderLockblockCommandButton(actions, "Lock vault", lockCommand);
    }
    if (vaultState !== "not-setup") {
      this.renderLockblockCommandButton(actions, "Change password", changePasswordCommand, "secondary");
    }

    if (!setupCommand && !lockCommand && !unlockCommand && !changePasswordCommand) {
      section.createDiv({
        text: "Lockblock is enabled, but Forge could not find basic vault commands exposed by that plugin.",
        cls: "forge-health-muted",
      });
    }
  }

  private renderLockblockCommandButton(
    container: HTMLElement,
    label: string,
    command: AppCommand | null,
    tone: "primary" | "secondary" = "primary"
  ): void {
    const button = container.createEl("button", {
      text: label,
      cls: [
        "forge-health-action-button",
        `forge-health-action-${tone}`,
        tone === "primary" ? "mod-cta" : "",
      ].filter(Boolean).join(" "),
    });
    button.disabled = !command?.id;
    button.setAttr("data-forge-focus-key", `lockblock:${label}`);
    button.title = command?.name ?? "Lockblock command not available";
    button.addEventListener("click", () => {
      if (command?.id) {
        this.executeCommandByFullId(command.id);
        window.setTimeout(() => this.render(), 500);
      }
    });
  }

  private isLockblockAvailable(): boolean {
    return this.lockblockIntegration() !== null;
  }

  private lockblockVaultState(): LockblockVaultState {
    const integration = this.lockblockIntegration();
    return integration ? lockblockVaultState(integration.plugin) : "unknown";
  }

  private syncLockblockStateSubscription(): void {
    const integration = this.lockblockIntegration();
    const plugin = integration?.plugin;
    const api = isLockblockApi(plugin) ? plugin : null;
    if (!integration || !api?.onLockStateChange) {
      this.clearLockblockStateSubscription();
      return;
    }
    if (this.subscribedLockblockPluginId === integration.pluginId) return;

    this.clearLockblockStateSubscription();
    this.subscribedLockblockPluginId = integration.pluginId;
    this.lockblockStateUnsubscribe = api.onLockStateChange((state) => {
      this.lastKnownLockblockState = normalizeLockblockVaultState(state);
      this.render();
    });
  }

  private clearLockblockStateSubscription(): void {
    this.lockblockStateUnsubscribe?.();
    this.lockblockStateUnsubscribe = null;
    this.subscribedLockblockPluginId = null;
  }

  private lockblockIntegration(): { pluginId: string; plugin: unknown; commands: AppCommand[] } | null {
    const app = this.app as AppWithPlugins;
    const plugins = app.plugins;
    if (!plugins) return null;

    const enabledPluginIds = enabledPluginIdList(plugins.enabledPlugins);
    const pluginId = enabledPluginIds.find((id) => isLockblockPlugin(id, plugins.manifests?.[id]));
    if (!pluginId) return null;

    const plugin = plugins.getPlugin?.(pluginId) ?? plugins.plugins?.[pluginId];
    if (!plugin) return null;

    return {
      pluginId,
      plugin,
      commands: this.lockblockCommands(pluginId),
    };
  }

  private lockblockCommands(pluginId: string): AppCommand[] {
    const commandMap = (this.app as AppWithCommandRegistry).commands?.commands ?? {};
    return Object.values(commandMap)
      .filter((command) => command.id?.startsWith(`${pluginId}:`))
      .sort((a, b) => (a.name ?? a.id ?? "").localeCompare(b.name ?? b.id ?? ""));
  }

  private renderHistory(container: HTMLElement, snapshot: DashboardSnapshot): void {
    const history = snapshot.patch_history;
    const section = createSection(
      container,
      "maintenance-history",
      "Maintenance History",
      history?.last_patch_run ? { label: "Tracked", tone: "good" } : { label: "No patch history", tone: "muted" },
      this.collapsedSections.has("maintenance-history"),
      () => {
        this.toggleSection("maintenance-history");
      }
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
    this.renderActionButton(actions, {
      key: "restore-patch-run",
      label: "Restore patch run",
      runningLabel: "Opening restore...",
      tone: "destructive",
      onClick: () => runRestorePatch(this.plugin),
    });
    this.renderActionButton(actions, {
      key: "view-patch-history",
      label: "View patch history",
      runningLabel: "Refreshing...",
      onClick: () => this.viewPatchHistory(),
    });
    this.renderActionButton(actions, {
      key: "view-last-run",
      label: "View last run",
      runningLabel: "Checking...",
      onClick: () => this.viewLastRun(),
    });
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

    const section = createSection(
      container,
      "recommendations",
      "Recommendations",
      { label: `${recommendations.length}`, tone: "warning" },
      this.collapsedSections.has("recommendations"),
      () => {
        this.toggleSection("recommendations");
      }
    );
    const list = section.createEl("ul", { cls: "forge-health-recommendations" });
    for (const recommendation of recommendations) {
      list.createEl("li", { text: recommendation });
    }
  }

  // ── Issue rendering ─────────────────────────────────────────────────────────

  private lintIssues(snapshot: DashboardSnapshot): DashboardIssue[] {
    return snapshot.issues.filter((issue) => !isSchemaIssue(issue) && !isReviewIssue(issue));
  }

  private renderGroupedIssues(
    section: HTMLElement,
    issues: DashboardIssue[],
    scope: string
  ): void {
    const groups = groupIssuesByType(issues);
    const controls = section.createDiv("forge-health-issue-controls");
    const expandAll = controls.createEl("button", { text: "Expand all" });
    expandAll.setAttr("data-forge-focus-key", `issues:${scope}:expand-all`);
    expandAll.addEventListener("click", () => {
      for (const group of groups) this.expandedIssueGroups.add(issueGroupKey(scope, group.issueType));
      this.render();
    });
    const collapseAll = controls.createEl("button", { text: "Collapse all" });
    collapseAll.setAttr("data-forge-focus-key", `issues:${scope}:collapse-all`);
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
      toggleButton.setAttr("data-forge-focus-key", `issues:${key}:toggle`);
      header.createSpan({ text: group.issueType, cls: "forge-health-issue-group-title" });
      header.createSpan({
        text: `${group.issues.length} issue${group.issues.length === 1 ? "" : "s"}`,
        cls: "forge-health-issue-group-count",
        attr: { "data-severity": group.maxSeverity },
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
        toggle.setAttr("data-forge-focus-key", `issues:${key}:show-more`);
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
    const row = container.createDiv({
      cls: "forge-health-issue",
      attr: { "data-severity": issue.severity },
    });
    const main = row.createDiv("forge-health-issue-main");
    main.createDiv({ text: issue.file_path, cls: "forge-health-issue-path" });
    main.createDiv({ text: issue.message, cls: "forge-health-issue-message" });
    if (issue.suggested_action) {
      main.createDiv({ text: issue.suggested_action, cls: "forge-health-issue-action" });
    }

    const openButton = row.createEl("button", {
      text: "Open",
      cls: "forge-health-action-button forge-health-action-secondary",
    });
    openButton.setAttr("data-forge-focus-key", `issue:${issue.file_path}:${issue.issue_type}:open`);
    openButton.addEventListener("click", () => {
      void this.app.workspace.openLinkText(issue.file_path, "", false);
    });
  }

  // ── Utilities ───────────────────────────────────────────────────────────────

  private renderActionButton(container: HTMLElement, options: DashboardActionOptions): HTMLButtonElement {
    const tone = options.tone ?? "secondary";
    const running = this.runningActions.has(options.key);
    const busy = this.runningActions.size > 0;
    const button = container.createEl("button", {
      text: running ? options.runningLabel ?? "Running..." : options.label,
      cls: [
        "forge-health-action-button",
        `forge-health-action-${tone}`,
        tone === "primary" ? "mod-cta" : "",
      ].filter(Boolean).join(" "),
    });

    button.disabled = options.disabled === true || busy;
    button.setAttr("data-forge-focus-key", `action:${options.key}`);
    if (options.title) button.title = options.title;
    if (running) button.setAttr("aria-busy", "true");
    button.addEventListener("click", () => {
      void this.runDashboardAction(options.key, options.onClick);
    });

    return button;
  }

  private async runDashboardAction(key: string, action: () => Promise<unknown>): Promise<void> {
    if (this.runningActions.size > 0) return;

    this.runningActions.add(key);
    this.render();
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      new Notice(`Forge: ${message}`, 6000);
      console.error(`[Forge] dashboard action ${key} error:`, error);
    } finally {
      this.runningActions.delete(key);
      this.render();
    }
  }

  private async refreshOntologyMetrics(): Promise<void> {
    await this.plugin.ontologyService.collectMetrics("refresh-vault-health-dashboard");
    await this.plugin.recomposeHealthDashboard();
    new Notice("Forge: Ontology metrics refreshed.", 4000);
  }

  private async viewPatchHistory(): Promise<void> {
    await this.plugin.patchHistoryService.readHistory("patch-history");
    await this.plugin.recomposeHealthDashboard();
    await this.plugin.openHealthDashboard();
    new Notice("Forge: Patch history refreshed in the dashboard.", 5000);
  }

  private async viewLastRun(): Promise<void> {
    const run = await this.plugin.dashboardService.latestOperationalRun();
    if (!run) {
      new Notice("Forge: No operational runs have been recorded yet.", 5000);
      return;
    }

    new Notice(
      `Forge: Last run was ${formatCommandName(run.command)}. Status: ${run.status}. Applied ${run.applied_items} item(s), with ${run.errors.length} error(s).`,
      7000
    );
  }

  private executeCommandByFullId(fullId: string): void {
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

function isReviewIssue(issue: DashboardIssue): boolean {
  return issue.issue_type === "stale_note" || issue.issue_type === "stale_inbox_note";
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

function groupShapeIssuesByFile(issues: DashboardIssue[]): ShapeFileIssueGroup[] {
  const groups = new Map<string, DashboardIssue[]>();
  for (const issue of issues) {
    const group = groups.get(issue.file_path) ?? [];
    group.push(issue);
    groups.set(issue.file_path, group);
  }

  return [...groups.entries()]
    .map(([path, groupIssues]) => ({
      path,
      issues: groupIssues.sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity)),
      maxSeverity: groupIssues.reduce<DashboardIssue["severity"]>(
        (max, issue) => severityWeight(issue.severity) > severityWeight(max) ? issue.severity : max,
        "info"
      ),
      issueTypes: topIssueTypes(groupIssues, 4),
    }))
    .sort((a, b) => {
      const severityDiff = severityWeight(b.maxSeverity) - severityWeight(a.maxSeverity);
      if (severityDiff !== 0) return severityDiff;
      if (b.issues.length !== a.issues.length) return b.issues.length - a.issues.length;
      return a.path.localeCompare(b.path);
    });
}

function topIssueTypes(issues: DashboardIssue[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    counts.set(issue.issue_type, (counts.get(issue.issue_type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([issueType]) => issueType);
}

function formatIssueType(issueType: string): string {
  return issueType
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
  sectionKey: string,
  title: string,
  status?: SectionStatus,
  collapsed = false,
  onToggle?: () => void
): HTMLElement {
  const attrs: Record<string, string> = { "data-section-key": sectionKey };
  if (status) attrs["data-status"] = status.tone;
  const section = container.createDiv({
    cls: ["forge-health-section", collapsed ? "is-collapsed" : ""],
    attr: attrs,
  });
  const header = section.createDiv({
    cls: "forge-health-section-header",
    attr: status ? { "data-status": status.tone } : undefined,
  });
  const titleWrap = header.createDiv("forge-health-section-title-wrap");
  const toggle = titleWrap.createEl("button", {
    text: collapsed ? "+" : "-",
    cls: "forge-health-section-toggle",
  });
  toggle.setAttr("aria-label", collapsed ? `Expand ${title}` : `Collapse ${title}`);
  toggle.setAttr("data-forge-focus-key", `section:${sectionKey}:toggle`);
  toggle.addEventListener("click", () => onToggle?.());
  titleWrap.createEl("h2", {
    text: title,
    attr: status ? { "data-status": status.tone } : undefined,
  });
  if (status) {
    header.createDiv({
      text: status.label,
      cls: "forge-health-section-status",
      attr: { "data-status": status.tone },
    });
  }
  return section;
}

function healthLabel(snapshot: DashboardSnapshot): string {
  if (snapshot.summary.schema_violation_count > 0 || snapshot.summary.invalid_frontmatter_count > 0) {
    return "Needs attention";
  }
  if (snapshot.summary.lint_issue_count > 0 || snapshot.summary.broken_shape_count > 0) return "Watch";
  return "Healthy";
}

function healthPillLabel(snapshot: DashboardSnapshot): string {
  const reviewItems = snapshot.summary.review_item_count ?? 0;
  const reviewSuffix = reviewItems > 0
    ? ` • ${reviewItems} review`
    : "";
  return `${healthLabel(snapshot)}${reviewSuffix}`;
}

function healthStatus(snapshot: DashboardSnapshot): SectionStatus["tone"] {
  if (snapshot.summary.schema_violation_count > 0 || snapshot.summary.invalid_frontmatter_count > 0) {
    return "critical";
  }
  if (snapshot.summary.lint_issue_count > 0 || snapshot.summary.broken_shape_count > 0) return "warning";
  return "good";
}

function isAutoRefreshInterval(value: number): value is DashboardAutoRefreshIntervalMinutes {
  return AUTO_REFRESH_INTERVALS.includes(value as DashboardAutoRefreshIntervalMinutes);
}

function normalizeAutoRefreshInterval(value: number): DashboardAutoRefreshIntervalMinutes {
  return isAutoRefreshInterval(value) ? value : 5;
}

function formatCommandName(command: string): string {
  return command
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function enabledPluginIdList(enabledPlugins: AppPluginManager["enabledPlugins"]): string[] {
  if (!enabledPlugins) return [];
  return Array.isArray(enabledPlugins) ? enabledPlugins : [...enabledPlugins];
}

function isLockblockPlugin(pluginId: string, manifest?: AppPluginManifest): boolean {
  const id = pluginId.toLowerCase();
  const name = (manifest?.name ?? "").toLowerCase();
  return id === "lockblock" || id.includes("lockblock") || name === "lockblock" || name.includes("lockblock");
}

function lockblockVaultState(plugin: unknown): LockblockVaultState {
  if (!isLockblockApi(plugin) || !plugin.getVaultLockState) return "unknown";
  try {
    return normalizeLockblockVaultState(plugin.getVaultLockState());
  } catch {
    return "unknown";
  }
}

function isLockblockApi(plugin: unknown): plugin is LockblockPluginLike {
  return isRecord(plugin) &&
    (typeof plugin.getVaultLockState === "function" || typeof plugin.onLockStateChange === "function");
}

function normalizeLockblockVaultState(state: unknown): LockblockVaultState {
  return state === "locked" || state === "unlocked" || state === "not-setup" ? state : "unknown";
}

function findCommandById(commands: AppCommand[], pluginId: string, commandId: string): AppCommand | null {
  const fullId = `${pluginId}:${commandId}`;
  return commands.find((command) => command.id === fullId) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
