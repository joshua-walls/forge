import { App, MarkdownView, Notice, TAbstractFile, TFile } from "obsidian";
import type ForgePlugin from "./main";
import type { ForgeSettings } from "./settings";
import type { DashboardIssue } from "./dashboard_types";
import { lintResultToDashboardIssue } from "./dashboard_types";

const DEFAULT_IDLE_DELAY_MS = 10_000;
const LEAVE_NOTE_DELAY_MS = 250;
const OPEN_NOTE_DELAY_MS = 500;
const READ_VIEW_MODIFY_DELAY_MS = 500;

type ViewState = {
  path: string;
  mode: "source" | "preview";
};

export type ActiveFileLintStatus = {
  filePath: string;
  generatedAt: string;
  issues: DashboardIssue[];
  reviewIssues: DashboardIssue[];
  errors: number;
  warnings: number;
  infos: number;
  reviewItems: number;
  exempt: boolean;
};

export class ActiveFileLintService {
  private settings: ForgeSettings;
  private pendingTimers = new Map<string, number>();
  private inFlight = new Set<string>();
  private dirtyFiles = new Set<string>();
  private currentMarkdownFilePath: string | null = null;
  private lastOpenedFilePath: string | null = null;
  private lastViewState: ViewState | null = null;
  private lastNoticeSignatureByFile = new Map<string, string>();
  private lastResultsByFile = new Map<string, ActiveFileLintStatus>();

  constructor(private app: App, private plugin: ForgePlugin, settings: ForgeSettings) {
    this.settings = settings;
  }

  updateSettings(settings: ForgeSettings): void {
    this.settings = settings;
    this.plugin.renderHealthDashboardViews();
  }

  onEditorChanged(file: TFile | null): void {
    if (!this.isEnabled() || !(file instanceof TFile) || file.extension !== "md") return;

    this.currentMarkdownFilePath = file.path;
    const wasDirty = this.dirtyFiles.has(file.path);
    this.dirtyFiles.add(file.path);
    this.scheduleLint(file, this.getIdleDelayMs());
    if (!wasDirty) {
      this.plugin.renderHealthDashboardViews();
    }
  }

  onFileOpened(file: TFile | null): void {
    const previousPath = this.lastOpenedFilePath;
    this.lastOpenedFilePath = file?.path ?? previousPath;

    if (file instanceof TFile && file.extension === "md") {
      this.currentMarkdownFilePath = file.path;
    }

    if (previousPath && previousPath !== this.lastOpenedFilePath) {
      this.scheduleLintIfDirty(previousPath, LEAVE_NOTE_DELAY_MS);
    }

    if (this.isEnabled() && file instanceof TFile && file.extension === "md" && !this.lastResultsByFile.has(file.path)) {
      this.scheduleLint(file, OPEN_NOTE_DELAY_MS);
    }

    this.lastViewState = this.getActiveViewState();
    this.plugin.renderHealthDashboardViews();
  }

  onFileModified(file: TAbstractFile | null): void {
    if (!this.isEnabled() || !(file instanceof TFile) || file.extension !== "md") return;
    if (file.path !== this.currentMarkdownFilePath) return;

    this.scheduleLint(file, READ_VIEW_MODIFY_DELAY_MS);
  }

  onLayoutChanged(): void {
    if (!this.isEnabled()) {
      this.lastViewState = this.getActiveViewState();
      return;
    }

    const previous = this.lastViewState;
    const current = this.getActiveViewState();
    this.lastViewState = current;

    if (!previous || !current) return;
    if (previous.path !== current.path) return;
    if (previous.mode === "source" && current.mode === "preview") {
      const file = this.app.vault.getAbstractFileByPath(current.path);
      if (file instanceof TFile && file.extension === "md") {
        this.scheduleLint(file, 0);
      }
    }
  }

  private isEnabled(): boolean {
    return this.settings.activeFileLintAutoMode === "edit_idle";
  }

  currentFileStatus(): ActiveFileLintStatus | null {
    const path = this.currentFilePath();
    return path ? this.lastResultsByFile.get(path) ?? null : null;
  }

  currentFilePath(): string | null {
    return this.currentMarkdownFilePath;
  }

  isCurrentFileDirty(): boolean {
    const path = this.currentFilePath();
    return path ? this.dirtyFiles.has(path) : false;
  }

  isCurrentFileLintInFlight(): boolean {
    const path = this.currentFilePath();
    return path ? this.inFlight.has(path) : false;
  }

  isEnabledForCurrentSession(): boolean {
    return this.isEnabled();
  }

  private getIdleDelayMs(): number {
    const delay = Math.floor(this.settings.activeFileLintIdleDelayMs);
    return Number.isFinite(delay) && delay >= 0 ? delay : DEFAULT_IDLE_DELAY_MS;
  }

  private scheduleLintIfDirty(path: string, delayMs: number): void {
    if (!this.dirtyFiles.has(path)) return;

    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile && file.extension === "md") {
      this.scheduleLint(file, delayMs);
    }
  }

  private scheduleLint(file: TFile, delayMs: number): void {
    const existing = this.pendingTimers.get(file.path);
    if (existing != null) window.clearTimeout(existing);

    const timer = window.setTimeout(() => {
      this.pendingTimers.delete(file.path);
      void this.lintFile(file).catch((error: unknown) => {
        console.error("[Forge] active file lint error:", error);
      });
    }, delayMs);

    this.pendingTimers.set(file.path, timer);
  }

  private async lintFile(file: TFile): Promise<void> {
    if (this.inFlight.has(file.path)) return;

    this.inFlight.add(file.path);
    try {
      const lintResult = await this.plugin.lintService.runLintForFile(file, {
        sourceCommand: "auto-active-file-lint",
        updateDashboardCache: false,
      });
      if (!lintResult) return;

      const shapeLintResult = this.settings.shapeLintEnabled
        ? await this.plugin.shapeLintService.runShapeLintForFile(file)
        : null;
      const shapeIssues = shapeLintResult?.results.map((issue) => ({
        ...lintResultToDashboardIssue(issue),
        source_command: "auto-active-file-shape-lint",
      })) ?? [];
      const allIssues = [
        ...lintResult.results.map((issue) => ({
          ...lintResultToDashboardIssue(issue),
          source_command: "auto-active-file-lint",
        })).filter((issue) => issue.issue_type !== "stale_note" && issue.issue_type !== "stale_inbox_note"),
        ...shapeIssues,
      ];
      const reviewIssues = lintResult.reviewItems.map((issue) => ({
        ...lintResultToDashboardIssue(issue),
        source_command: "auto-active-file-lint",
      }));
      const lintErrors = lintResult.errors.length;
      const lintWarnings = lintResult.warnings.length;
      const shapeErrors = shapeLintResult?.errors.length ?? 0;
      const shapeWarnings = shapeLintResult?.warnings.length ?? 0;
      const errors = lintErrors + shapeErrors;
      const warnings = lintWarnings + shapeWarnings;
      const infos = lintResult.infos.length + (shapeLintResult?.infos.length ?? 0);
      const reviewItems = lintResult.reviewItems.length;
      const exempt = lintResult.envelope.notes_scanned === 0;

      this.dirtyFiles.delete(file.path);
      this.lastResultsByFile.set(file.path, {
        filePath: file.path,
        generatedAt: new Date().toISOString(),
        issues: allIssues,
        reviewIssues,
        errors,
        warnings,
        infos,
        reviewItems,
        exempt,
      });
      this.maybeShowNotice(file, {
        lintErrors,
        lintWarnings,
        shapeErrors,
        shapeWarnings,
        infos,
      });
      this.plugin.renderHealthDashboardViews();
    } finally {
      this.inFlight.delete(file.path);
      this.plugin.renderHealthDashboardViews();
    }
  }

  private maybeShowNotice(
    file: TFile,
    counts: {
      lintErrors: number;
      lintWarnings: number;
      shapeErrors: number;
      shapeWarnings: number;
      infos: number;
    }
  ): void {
    const lintAttentionCount = counts.lintErrors + counts.lintWarnings;
    const shapeAttentionCount = counts.shapeErrors + counts.shapeWarnings;
    const attentionCount = lintAttentionCount + shapeAttentionCount;
    const signature = `${counts.lintErrors}:${counts.lintWarnings}:${counts.shapeErrors}:${counts.shapeWarnings}:${counts.infos}`;

    if (attentionCount === 0) {
      this.lastNoticeSignatureByFile.delete(file.path);
      return;
    }

    if (this.lastNoticeSignatureByFile.get(file.path) === signature) return;
    this.lastNoticeSignatureByFile.set(file.path, signature);

    const totalErrors = counts.lintErrors + counts.shapeErrors;
    const totalWarnings = counts.lintWarnings + counts.shapeWarnings;
    const parts: string[] = [];
    if (totalErrors > 0) parts.push(`${totalErrors} error${totalErrors === 1 ? "" : "s"}`);
    if (totalWarnings > 0) parts.push(`${totalWarnings} warning${totalWarnings === 1 ? "" : "s"}`);

    const checkLabel = lintAttentionCount > 0 && shapeAttentionCount > 0
      ? "Lint and shape lint failed"
      : shapeAttentionCount > 0
        ? "Shape lint failed"
        : "Lint failed";
    new Notice(`Forge: ${checkLabel} for ${file.basename} (${parts.join(", ")}).`, 5000);
  }

  private getActiveViewState(): ViewState | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return null;

    const file = view.file;
    if (!(file instanceof TFile) || file.extension !== "md") return null;

    return {
      path: file.path,
      mode: view.getMode(),
    };
  }

}
