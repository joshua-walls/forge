// src/commands/maintenance.ts
// Vault Maintenance command.
//
// Port of Invoke-VaultMaintenance.ps1.
// Cleans up vault artifacts that accumulate over time:
//   - Lint history trimming (by age and entry count)
//   - Patch backup files older than retention threshold
//   - Lint run notes over retention count
//   - Shape lint run notes over retention count
//   - Patch report notes over retention count
//   - Shape repair history and run notes over retention count
//   - Stale inbox files older than retention threshold
//
// Never modifies vault notes — only deletes system artifacts.
// Runs a dry pass first, shows confirm modal, then applies.

import { App, Modal, Notice, TFile, TFolder } from "obsidian";
import type ForgePlugin from "../main";
import { isInboxRetentionReviewAction } from "../settings";
import { getVaultPaths } from "../vault-paths";
import { getMarkdownFiles } from "../utils/files";

// ── Types ─────────────────────────────────────────────────────────────────────

type MaintenanceStatus = "removed" | "trimmed" | "skipped" | "error";

interface MaintenanceResult {
  task: string;
  target: string;
  status: MaintenanceStatus;
  detail: string;
}

interface TimestampedEntry {
  timestamp?: string;
}

interface ShapeRepairHistoryEntry {
  ranAt?: string;
  repaired?: number;
}

async function trashFile(app: App, file: TFile): Promise<void> {
  await app.fileManager.trashFile(file);
}

function parseArray<T>(raw: string, isItem: (value: unknown) => value is T): T[] {
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed.filter(isItem) : [];
}

function hasTimestamp(value: unknown): value is TimestampedEntry {
  return typeof value === "object" && value !== null;
}

function isShapeRepairHistoryEntry(value: unknown): value is ShapeRepairHistoryEntry {
  return typeof value === "object" && value !== null;
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function runVaultMaintenance(plugin: ForgePlugin): Promise<void> {
  const { app, settings } = plugin;

  new Notice("Forge: Running maintenance dry pass…", 2000);

  const dryResults = await runAllTasks(app, settings, true);
  const actions = dryResults.filter((r) => r.status === "removed" || r.status === "trimmed");

  if (actions.length === 0) {
    new Notice("Forge: Nothing to clean up — vault is within retention policy.", 5000);
    return;
  }

  new MaintenanceConfirmModal(app, plugin, dryResults, async () => {
    const started = Date.now();
    const applyResults = await runAllTasks(app, settings, false);
    const applied = applyResults.filter((r) => r.status === "removed" || r.status === "trimmed").length;
    const errors  = applyResults.filter((r) => r.status === "error").length;
    await plugin.dashboardService.recordOperationalRun({
      command: "maintenance",
      status: errors > 0 ? "partial" : "success",
      started_at: new Date(started).toISOString(),
      duration_ms: Date.now() - started,
      affected_files: applied,
      applied_items: applied,
      warnings: [],
      errors: applyResults.filter((r) => r.status === "error").map((r) => `${r.target}: ${r.detail}`),
    });

    if (errors > 0) {
      new Notice(`Forge: Maintenance complete. ${applied} action(s), ${errors} error(s).`, 6000);
    } else {
      new Notice(`Forge: Maintenance complete. ${applied} item(s) cleaned up.`, 5000);
    }
  }).open();
}

export async function runVaultMaintenanceSilently(
  app: App,
  settings: ForgePlugin["settings"]
): Promise<MaintenanceResult[]> {
  return runAllTasks(app, settings, false);
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

async function runAllTasks(
  app: App,
  settings: ForgePlugin["settings"],
  dryRun: boolean
): Promise<MaintenanceResult[]> {
  const results: MaintenanceResult[] = [];
  results.push(...await trimLintHistory(app, settings, dryRun));
  results.push(...await trimLintRunNotes(app, settings, dryRun));
  results.push(...await trimShapeLintRunNotes(app, settings, dryRun));
  results.push(...await trimPatchReportNotes(app, settings, dryRun));
  results.push(...await trimShapeRepairHistory(app, settings, dryRun));
  results.push(...await trimShapeRepairRunNotes(app, settings, dryRun));
  results.push(...await cleanPatchBackups(app, settings, dryRun));
  results.push(...await cleanInbox(app, settings, dryRun));
  return results;
}

async function trimLintHistory(
  app: App,
  settings: ForgePlugin["settings"],
  dryRun: boolean
): Promise<MaintenanceResult[]> {
  const paths = getVaultPaths(settings);
  const histFile = app.vault.getAbstractFileByPath(paths.lintHistoryJson);

  if (!(histFile instanceof TFile)) {
    return [{ task: "lint_history", target: paths.lintHistoryJson, status: "skipped", detail: "lint-history.json does not exist yet" }];
  }

  let history: TimestampedEntry[] = [];
  try {
    const raw = await app.vault.read(histFile);
    history = parseArray(raw, hasTimestamp);
  } catch {
    return [{ task: "lint_history", target: paths.lintHistoryJson, status: "error", detail: "Could not parse lint-history.json" }];
  }

  const before = history.length;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - settings.lintHistoryRetentionDays);

  history = history.filter((e) => {
    if (!e.timestamp) return false;
    return !Number.isNaN(new Date(e.timestamp).valueOf()) && new Date(e.timestamp) >= cutoff;
  });

  if (history.length > settings.lintHistoryMaxEntries) {
    history = history.slice(history.length - settings.lintHistoryMaxEntries);
  }

  const removed = before - history.length;
  if (removed === 0) {
    return [{ task: "lint_history", target: paths.lintHistoryJson, status: "skipped",
      detail: `${before} entries, none exceed retention (${settings.lintHistoryRetentionDays} days / ${settings.lintHistoryMaxEntries} max)` }];
  }

  if (!dryRun) {
    await app.vault.modify(histFile, JSON.stringify(history, null, 2));
  }

  return [{ task: "lint_history", target: paths.lintHistoryJson, status: "trimmed",
    detail: `Removed ${removed} entries (${before} → ${history.length}). Policy: ${settings.lintHistoryRetentionDays} days / ${settings.lintHistoryMaxEntries} max` }];
}

async function trimLintRunNotes(
  app: App,
  settings: ForgePlugin["settings"],
  dryRun: boolean
): Promise<MaintenanceResult[]> {
  const paths = getVaultPaths(settings);
  const files = getMarkdownFiles(app, paths.lintRuns)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (files.length <= settings.lintRunRetentionCount) {
    return [{ task: "lint_runs", target: paths.lintRuns, status: "skipped",
      detail: `${files.length} lint report notes, within retention limit of ${settings.lintRunRetentionCount}` }];
  }

  const toRemove = files.slice(0, files.length - settings.lintRunRetentionCount);
  const results: MaintenanceResult[] = [];

  for (const file of toRemove) {
    if (!dryRun) {
      await trashFile(app, file);
    }
    results.push({ task: "lint_runs", target: file.path, status: "removed",
      detail: `Lint report note over retention limit of ${settings.lintRunRetentionCount}` });
  }

  return results;
}

async function trimPatchReportNotes(
  app: App,
  settings: ForgePlugin["settings"],
  dryRun: boolean
): Promise<MaintenanceResult[]> {
  const paths = getVaultPaths(settings);
  const files = getMarkdownFiles(app, paths.patchReports)
    .filter((f) => f.name.includes("-patch-report-"))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (files.length <= settings.patchReportRetentionCount) {
    return [{ task: "patch_reports", target: paths.patchReports, status: "skipped",
      detail: `${files.length} patch report notes, within retention limit of ${settings.patchReportRetentionCount}` }];
  }

  const toRemove = files.slice(0, files.length - settings.patchReportRetentionCount);
  const results: MaintenanceResult[] = [];

  for (const file of toRemove) {
    if (!dryRun) {
      await trashFile(app, file);
    }
    results.push({ task: "patch_reports", target: file.path, status: "removed",
      detail: `Patch report over retention limit of ${settings.patchReportRetentionCount}` });
  }

  return results;
}

async function trimShapeLintRunNotes(
  app: App,
  settings: ForgePlugin["settings"],
  dryRun: boolean
): Promise<MaintenanceResult[]> {
  const paths = getVaultPaths(settings);
  const folder = `${paths.exports}/ShapeLintReports`;
  const files = getMarkdownFiles(app, folder)
    .filter((f) => f.name.startsWith("shape-lint-run-"))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (files.length <= settings.shapeLintRunRetentionCount) {
    return [{ task: "shape_lint_runs", target: folder, status: "skipped",
      detail: `${files.length} shape lint run notes, within retention limit of ${settings.shapeLintRunRetentionCount}` }];
  }

  const toRemove = files.slice(0, files.length - settings.shapeLintRunRetentionCount);
  const results: MaintenanceResult[] = [];

  for (const file of toRemove) {
    if (!dryRun) {
      await trashFile(app, file);
    }
    results.push({ task: "shape_lint_runs", target: file.path, status: "removed",
      detail: `Shape lint run note over retention limit of ${settings.shapeLintRunRetentionCount}` });
  }

  return results;
}

async function trimShapeRepairHistory(
  app: App,
  settings: ForgePlugin["settings"],
  dryRun: boolean
): Promise<MaintenanceResult[]> {
  const paths = getVaultPaths(settings);
  const histFile = app.vault.getAbstractFileByPath(paths.shapeRepairHistory);

  if (!(histFile instanceof TFile)) {
    return [{ task: "shape_repair_history", target: paths.shapeRepairHistory, status: "skipped",
      detail: "shape-repair-history.json does not exist yet" }];
  }

  let history: ShapeRepairHistoryEntry[] = [];
  try {
    const raw = await app.vault.read(histFile);
    history = parseArray(raw, isShapeRepairHistoryEntry);
  } catch {
    return [{ task: "shape_repair_history", target: paths.shapeRepairHistory, status: "error",
      detail: "Could not parse shape-repair-history.json" }];
  }

  const before = history.length;
  const max = settings.shapeRepairHistoryRetentionCount ?? 20;
  if (history.length > max) {
    history = history.slice(history.length - max);
  }

  const removed = before - history.length;
  if (removed === 0) {
    return [{ task: "shape_repair_history", target: paths.shapeRepairHistory, status: "skipped",
      detail: `${before} entries, within retention limit of ${max}` }];
  }

  if (!dryRun) {
    await app.vault.modify(histFile, JSON.stringify(history, null, 2));
  }

  return [{ task: "shape_repair_history", target: paths.shapeRepairHistory, status: "trimmed",
    detail: `Removed ${removed} entries (${before} → ${history.length}). Policy: ${max} max` }];
}

async function trimShapeRepairRunNotes(
  app: App,
  settings: ForgePlugin["settings"],
  dryRun: boolean
): Promise<MaintenanceResult[]> {
  const folder = settings.shapeRepairRunsFolder;
  const max = settings.shapeRepairHistoryRetentionCount ?? 20;
  const files = getMarkdownFiles(app, folder)
    .filter((f) => f.name.startsWith("shape-repair-"))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (files.length <= max) {
    return [{ task: "shape_repair_runs", target: folder, status: "skipped",
      detail: `${files.length} shape repair run notes, within retention limit of ${max}` }];
  }

  const toRemove = files.slice(0, files.length - max);
  const results: MaintenanceResult[] = [];

  for (const file of toRemove) {
    if (!dryRun) {
      await trashFile(app, file);
    }
    results.push({ task: "shape_repair_runs", target: file.path, status: "removed",
      detail: `Shape repair run note over retention limit of ${max}` });
  }

  return results;
}

async function cleanPatchBackups(
  app: App,
  settings: ForgePlugin["settings"],
  dryRun: boolean
): Promise<MaintenanceResult[]> {
  const paths = getVaultPaths(settings);
  const cutoff = Date.now() - settings.backupRetentionDays * 24 * 60 * 60 * 1000;
  const results: MaintenanceResult[] = [];

  // Find all .bak files in the patches backups folder
  const backupFolder = app.vault.getAbstractFileByPath(paths.patchBackups);
  if (!(backupFolder instanceof TFolder)) {
    return [{ task: "patch_backups", target: paths.patchBackups, status: "skipped", detail: "Backup folder does not exist yet" }];
  }

  const allFiles = app.vault.getFiles().filter(
    (f) => f.path.startsWith(paths.patchBackups) && f.name.endsWith(".bak")
  );

  const stale = allFiles.filter((f) => f.stat.mtime < cutoff);

  if (stale.length === 0) {
    return [{ task: "patch_backups", target: paths.patchBackups, status: "skipped",
      detail: `No backup files older than ${settings.backupRetentionDays} days` }];
  }

  for (const file of stale) {
    if (!dryRun) {
      await trashFile(app, file);
    }
    const age = Math.floor((Date.now() - file.stat.mtime) / (1000 * 60 * 60 * 24));
    results.push({ task: "patch_backups", target: file.path, status: "removed",
      detail: `Backup ${age} days old (threshold: ${settings.backupRetentionDays} days)` });
  }

  return results;
}

async function cleanInbox(
  app: App,
  settings: ForgePlugin["settings"],
  dryRun: boolean
): Promise<MaintenanceResult[]> {
  const paths = getVaultPaths(settings);
  if (isInboxRetentionReviewAction(settings.inboxRetentionAction)) {
    return [{
      task: "inbox",
      target: paths.inbox,
      status: "skipped",
      detail: "Inbox retention is configured to list stale notes under Needs Review"
    }];
  }

  const cutoff = Date.now() - settings.inboxRetentionDays * 24 * 60 * 60 * 1000;
  const results: MaintenanceResult[] = [];

  const inboxFolder = app.vault.getAbstractFileByPath(paths.inbox);
  if (!(inboxFolder instanceof TFolder)) {
    return [{ task: "inbox", target: paths.inbox, status: "skipped", detail: "Inbox folder does not exist" }];
  }

  const staleFiles = app.vault.getFiles().filter(
    (f) => f.path.startsWith(paths.inbox + "/") && f.stat.mtime < cutoff
  );

  if (staleFiles.length === 0) {
    return [{ task: "inbox", target: paths.inbox, status: "skipped",
      detail: `No inbox files older than ${settings.inboxRetentionDays} days` }];
  }

  for (const file of staleFiles) {
    if (!dryRun) {
      await trashFile(app, file);
    }
    const age = Math.floor((Date.now() - file.stat.mtime) / (1000 * 60 * 60 * 24));
    results.push({ task: "inbox", target: file.path, status: "removed",
      detail: `Inbox file ${age} days old (threshold: ${settings.inboxRetentionDays} days)` });
  }

  return results;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

class MaintenanceConfirmModal extends Modal {
  private plugin: ForgePlugin;
  private results: MaintenanceResult[];
  private onConfirm: () => Promise<void>;

  constructor(
    app: App,
    plugin: ForgePlugin,
    results: MaintenanceResult[],
    onConfirm: () => Promise<void>
  ) {
    super(app);
    this.plugin = plugin;
    this.results = results;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    const actions = this.results.filter((r) => r.status === "removed" || r.status === "trimmed");
    const errors  = this.results.filter((r) => r.status === "error");
    const { settings } = this.plugin;

    contentEl.createEl("h2", { text: "Vault maintenance" });

    // Policy summary
    const policy = contentEl.createDiv("forge-maintenance-policy");
    policy.createEl("p", { text: `Retention policy:`, cls: "forge-policy-label" });
    const policyList = policy.createEl("ul");
    policyList.createEl("li", { text: `Lint history: ${settings.lintHistoryRetentionDays} days / ${settings.lintHistoryMaxEntries} entries max` });
    policyList.createEl("li", { text: `Lint run notes: ${settings.lintRunRetentionCount} notes max` });
    policyList.createEl("li", { text: `Shape lint run notes: ${settings.shapeLintRunRetentionCount} notes max` });
    policyList.createEl("li", { text: `Shape repair history: ${settings.shapeRepairHistoryRetentionCount} entries max` });
    policyList.createEl("li", { text: `Shape repair run notes: ${settings.shapeRepairHistoryRetentionCount} notes max` });
    policyList.createEl("li", { text: `Patch reports: ${settings.patchReportRetentionCount} notes max` });
    policyList.createEl("li", { text: `Patch backups: ${settings.backupRetentionDays} days` });
    policyList.createEl("li", {
      text: settings.inboxRetentionAction === "delete"
        ? `Inbox files: delete after ${settings.inboxRetentionDays} days`
        : `Inbox files: list under Needs Review after ${settings.inboxRetentionDays} days`
    });

    if (errors.length > 0) {
      contentEl.createEl("h3", { text: "Errors" });
      const list = contentEl.createEl("ul", { cls: "forge-error-list" });
      for (const r of errors) {
        list.createEl("li", { text: `[${r.task}] ${r.target} — ${r.detail}` });
      }
    }

    contentEl.createEl("h3", { text: `${actions.length} item(s) to clean up` });
    const list = contentEl.createEl("ul", { cls: "forge-change-list" });
    for (const r of actions.slice(0, 20)) {
      list.createEl("li", { text: `[${r.task}] ${r.target} — ${r.detail}` });
    }
    if (actions.length > 20) {
      list.createEl("li", { text: `…and ${actions.length - 20} more`, cls: "forge-more" });
    }

    const buttonRow = contentEl.createDiv("forge-button-row");

    const applyBtn = buttonRow.createEl("button", { text: "Apply", cls: "mod-cta" });
    applyBtn.addEventListener("click", () => {
      void (async () => {
        this.close();
        await this.onConfirm();
      })();
    });

    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
