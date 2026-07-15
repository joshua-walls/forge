import { Menu, Notice, Platform, setIcon } from "obsidian";
import type ForgePlugin from "../main";
import type { DashboardSnapshot } from "../dashboard/types";
import { runVaultLint } from "../commands/run-lint";
import { runValidateSchema } from "../commands/validate-schema";
import { runShapeLint } from "../commands/run-shape-lint";
import { runNormalizeFrontmatter, runNormalizeTags } from "../commands/normalize";
import { runVaultMaintenance } from "../commands/maintenance";

type ForgeStatusTone = "muted" | "good" | "warning" | "critical" | "review";

interface ForgeStatusState {
  label: string;
  icon: string;
  tone: ForgeStatusTone;
  title: string;
}

const CACHE_RELOAD_DEBOUNCE_MS = 400;

export class ForgeStatusBar {
  private rootEl: HTMLElement | null = null;
  private iconEl: HTMLElement | null = null;
  private labelEl: HTMLElement | null = null;
  private menuButtonEl: HTMLButtonElement | null = null;
  private snapshot: DashboardSnapshot | null = null;
  private refreshing = false;
  private reloadTimer: number | null = null;

  constructor(private plugin: ForgePlugin) {}

  load(): void {
    if (!Platform.isDesktop || Platform.isMobile) return;

    this.rootEl = this.plugin.addStatusBarItem();
    this.rootEl.addClass("forge-statusbar");
    this.rootEl.setAttr("role", "button");
    this.rootEl.setAttr("tabindex", "0");

    this.iconEl = this.rootEl.createSpan("forge-statusbar-icon");
    this.labelEl = this.rootEl.createSpan("forge-statusbar-label");
    this.menuButtonEl = this.rootEl.createEl("button", {
      cls: "forge-statusbar-menu-button",
      attr: {
        type: "button",
        "aria-label": "Forge quick actions",
        title: "Forge quick actions",
      },
    });
    setIcon(this.menuButtonEl, "more-horizontal");

    this.plugin.registerDomEvent(this.rootEl, "click", (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(".forge-statusbar-menu-button")) return;
      void this.plugin.openHealthDashboard();
    });

    this.plugin.registerDomEvent(this.rootEl, "keydown", (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest(".forge-statusbar-menu-button")) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      void this.plugin.openHealthDashboard();
    });

    this.plugin.registerDomEvent(this.rootEl, "contextmenu", (event: MouseEvent) => {
      event.preventDefault();
      this.showQuickActions(event);
    });

    this.plugin.registerDomEvent(this.menuButtonEl, "click", (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this.showQuickActions(event);
    });

    this.plugin.registerEvent(
      this.plugin.app.vault.on("modify", (file) => {
        if (file.path === this.plugin.dashboardService.cachePath) {
          this.scheduleSnapshotReload();
        }
      })
    );

    this.render();
    void this.reloadFromCache();
  }

  unload(): void {
    if (this.reloadTimer !== null) {
      window.clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
    this.rootEl?.remove();
    this.rootEl = null;
    this.iconEl = null;
    this.labelEl = null;
    this.menuButtonEl = null;
  }

  async reloadFromCache(): Promise<void> {
    if (!this.rootEl) return;
    try {
      this.snapshot = await this.plugin.dashboardService.loadSnapshot();
    } catch (error) {
      console.warn("[Forge] Could not load status bar snapshot:", error);
      this.snapshot = null;
    }
    this.render();
  }

  setSnapshot(snapshot: DashboardSnapshot | null): void {
    this.snapshot = snapshot;
    this.render();
  }

  setRefreshing(refreshing: boolean): void {
    this.refreshing = refreshing;
    this.render();
  }

  render(): void {
    if (!this.rootEl || !this.iconEl || !this.labelEl) return;

    const state = this.currentState();
    this.rootEl.setAttr("data-status", state.tone);
    this.rootEl.toggleClass("is-refreshing", this.refreshing);
    this.rootEl.setAttr(
      "aria-label",
      `${state.title} Click to open Forge health dashboard. Right-click for quick actions.`
    );
    this.rootEl.setAttr("title", `${state.title}\nClick to open dashboard. Right-click for quick actions.`);

    this.iconEl.empty();
    setIcon(this.iconEl, state.icon);
    this.labelEl.setText(state.label);
  }

  private scheduleSnapshotReload(): void {
    if (this.reloadTimer !== null) {
      window.clearTimeout(this.reloadTimer);
    }

    this.reloadTimer = window.setTimeout(() => {
      this.reloadTimer = null;
      void this.reloadFromCache();
    }, CACHE_RELOAD_DEBOUNCE_MS);
  }

  private currentState(): ForgeStatusState {
    if (this.refreshing) {
      return {
        label: "Forge: Refreshing",
        icon: "refresh-cw",
        tone: "muted",
        title: "Forge is refreshing vault health.",
      };
    }

    const snapshot = this.snapshot;
    if (!snapshot) {
      return {
        label: "Forge",
        icon: "activity",
        tone: "muted",
        title: "Forge has no cached dashboard snapshot yet.",
      };
    }

    const summary = snapshot.summary;
    const issueCount = Math.max(
      summary.lint_issue_count + summary.schema_violation_count + summary.broken_shape_count,
      summary.invalid_frontmatter_count
    );
    const hasCritical = summary.schema_violation_count > 0 || summary.invalid_frontmatter_count > 0;
    const hasWarning = summary.lint_issue_count > 0 || summary.broken_shape_count > 0;
    const reviewCount = summary.review_item_count ?? 0;

    if (hasCritical) {
      return {
        label: `Forge: ${pluralize(issueCount, "issue")}`,
        icon: "alert-circle",
        tone: "critical",
        title: this.snapshotTitle(snapshot, "Forge needs attention."),
      };
    }

    if (hasWarning) {
      return {
        label: `Forge: ${pluralize(issueCount, "issue")}`,
        icon: "alert-triangle",
        tone: "warning",
        title: this.snapshotTitle(snapshot, "Forge has lint or shape issues."),
      };
    }

    if (reviewCount > 0) {
      return {
        label: `Forge: ${pluralize(reviewCount, "review")}`,
        icon: "eye",
        tone: "review",
        title: this.snapshotTitle(snapshot, "Forge has notes needing review."),
      };
    }

    return {
      label: "Forge: Healthy",
      icon: "check-circle",
      tone: "good",
      title: this.snapshotTitle(snapshot, "Forge health is clear."),
    };
  }

  private snapshotTitle(snapshot: DashboardSnapshot, prefix: string): string {
    const summary = snapshot.summary;
    const parts = [
      `${summary.notes_scanned} notes scanned`,
      `${summary.lint_issue_count} lint`,
      `${summary.schema_violation_count} schema`,
      `${summary.broken_shape_count} shape`,
      `${summary.review_item_count ?? 0} review`,
    ];
    if (summary.invalid_frontmatter_count > 0) {
      parts.push(`${summary.invalid_frontmatter_count} invalid frontmatter`);
    }
    return `${prefix} ${parts.join(", ")}.`;
  }

  private showQuickActions(event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item
        .setTitle(this.refreshing ? "Refreshing dashboard..." : "Refresh dashboard")
        .setIcon("refresh-cw")
        .setDisabled(this.refreshing)
        .onClick(() => {
          this.runQuickAction("refresh-vault-health-dashboard", () => this.plugin.refreshHealthDashboard());
        });
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle("Run vault lint")
        .setIcon("list-checks")
        .onClick(() => {
          this.runQuickAction("run-vault-lint", () => runVaultLint(this.plugin));
        });
    });
    if (this.plugin.settings.shapesEnabled && this.plugin.settings.shapeLintEnabled) {
      menu.addItem((item) => {
        item
          .setTitle("Run shape lint")
          .setIcon("scan-line")
          .onClick(() => {
            this.runQuickAction("run-shape-lint", () => runShapeLint(this.plugin));
          });
      });
    }
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle("Normalize frontmatter")
        .setIcon("rows-3")
        .onClick(() => {
          this.runQuickAction("normalize-frontmatter", () => runNormalizeFrontmatter(this.plugin));
        });
    });
    menu.addItem((item) => {
      item
        .setTitle("Normalize tags")
        .setIcon("tags")
        .onClick(() => {
          this.runQuickAction("normalize-tags", () => runNormalizeTags(this.plugin));
        });
    });
    menu.addItem((item) => {
      item
        .setTitle("Vault maintenance")
        .setIcon("wrench")
        .onClick(() => {
          this.runQuickAction("vault-maintenance", () => runVaultMaintenance(this.plugin));
        });
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle("Validate schema")
        .setIcon("file-check")
        .onClick(() => {
          this.runQuickAction("validate-schema", () => runValidateSchema(this.plugin));
        });
    });
    menu.addItem((item) => {
      item
        .setTitle("Open dashboard")
        .setIcon("activity")
        .onClick(() => {
          void this.plugin.openHealthDashboard();
        });
    });
    menu.addItem((item) => {
      item
        .setTitle("Open settings")
        .setIcon("settings")
        .onClick(() => {
          this.plugin.openForgeSettings();
        });
    });
    menu.showAtMouseEvent(event);
  }

  private runQuickAction(commandId: string, action: () => Promise<unknown>): void {
    void action().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unexpected error";
      new Notice(`Forge: ${message}`, 6000);
      console.error(`[Forge] ${commandId} error:`, error);
    });
  }
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
