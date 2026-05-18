// src/lint-writers.ts
// Writes lint output files after a lint run.
//
// Port of the output writer functions in Invoke-VaultLint.ps1:
//   Write-LintReportJson  → System/Exports/lint-report.json
//   Write-LintRunMd       → System/Exports/LintRuns/lint-run-{timestamp}.md
//   Append-LintHistory    → System/Exports/lint-history.json
//
// Note: lint-report.md (the human-readable full report) from the PowerShell
// version is not written here — the lint run note serves that purpose and
// is lighter weight. The JSON report is the machine-readable source of truth.

import { App, TFile, normalizePath } from "obsidian";
import type { VaultForgeSettings } from "./settings";
import { getVaultPaths } from "./vault-paths";
import { ensureFolder, todayString } from "./utils/files";
import type { LintRunResult } from "./lint-engine";

// ── JSON report ───────────────────────────────────────────────────────────────

/**
 * Writes System/Exports/lint-report.json.
 * This is the machine-readable report read by AI sessions and Vault Scribe.
 */
export async function writeLintReportJson(
  app: App,
  settings: VaultForgeSettings,
  run: LintRunResult
): Promise<void> {
  const paths = getVaultPaths(settings);
  await ensureFolder(app, paths.exports);

  const report = {
    run: run.envelope,
    summary: {
      errors:        run.errors.length,
      warnings:      run.warnings.length,
      info:          run.infos.length,
      notes_scanned: run.envelope.notes_scanned,
    },
    results: run.results,
  };

  const path = normalizePath(paths.lintReportJson);
  const existing = app.vault.getAbstractFileByPath(path);

  const content = JSON.stringify(report, null, 2);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
  } else {
    await app.vault.create(path, content);
  }
}

// ── History ───────────────────────────────────────────────────────────────────

/**
 * Appends a summary entry to System/Exports/lint-history.json.
 * Trims entries older than settings.lintHistoryRetentionDays
 * and enforces settings.lintHistoryMaxEntries.
 *
 * Port of Append-LintHistory from Invoke-VaultLint.ps1.
 */
export async function appendLintHistory(
  app: App,
  settings: VaultForgeSettings,
  run: LintRunResult
): Promise<void> {
  const paths = getVaultPaths(settings);
  await ensureFolder(app, paths.exports);

  const entry = {
    timestamp:      run.envelope.timestamp,
    schema_version: run.envelope.schema_version,
    notes_scanned:  run.envelope.notes_scanned,
    errors:         run.errors.length,
    warnings:       run.warnings.length,
    info:           run.infos.length,
  };

  // Load existing history
  let history: typeof entry[] = [];
  const histPath = normalizePath(paths.lintHistoryJson);
  const histFile = app.vault.getAbstractFileByPath(histPath);

  if (histFile instanceof TFile) {
    try {
      const raw = await app.vault.read(histFile);
      history = JSON.parse(raw);
      if (!Array.isArray(history)) history = [];
    } catch {
      history = [];
    }
  }

  history.push(entry);

  // Trim by age
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - settings.lintHistoryRetentionDays);
  history = history.filter((e) => new Date(e.timestamp) >= cutoff);

  // Trim by max entries
  if (history.length > settings.lintHistoryMaxEntries) {
    history = history.slice(history.length - settings.lintHistoryMaxEntries);
  }

  const content = JSON.stringify(history, null, 2);
  if (histFile instanceof TFile) {
    await app.vault.modify(histFile, content);
  } else {
    await app.vault.create(histPath, content);
  }
}

// ── Lint run note ─────────────────────────────────────────────────────────────

/**
 * Writes a lint run note to System/Exports/LintRuns/.
 * Each run produces one note. Old notes are cleaned up by Vault Maintenance.
 *
 * Port of Write-LintRunMd from Invoke-VaultLint.ps1.
 */
export async function writeLintRunNote(
  app: App,
  settings: VaultForgeSettings,
  run: LintRunResult
): Promise<string> {
  const paths = getVaultPaths(settings);
  await ensureFolder(app, paths.lintRuns);

  const safeTs = run.envelope.timestamp.replace(/[:.]/g, "-").replace("T", "_");
  const notePath = normalizePath(`${paths.lintRuns}/lint-run-${safeTs}.md`);
  const today = todayString();

  const content = buildLintRunNote(run, today);

  const existing = app.vault.getAbstractFileByPath(notePath);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
  } else {
    await app.vault.create(notePath, content);
  }

  return notePath;
}

function buildLintRunNote(run: LintRunResult, today: string): string {
  const lines: string[] = [
    "---",
    "type: reference",
    "status: complete",
    "tags:",
    "  - meta/vault-lint",
    `created: ${today}`,
    `updated: ${today}`,
    "ai_private: false",
    "review_cycle: never",
    "---",
    "",
    `schema_version:: "${run.envelope.schema_version}"`,
    `runtime:: ${run.envelope.timestamp}`,
    `notes_scanned:: ${run.envelope.notes_scanned}`,
    `errors:: ${run.errors.length}`,
    `warnings:: ${run.warnings.length}`,
    `infos:: ${run.infos.length}`,
    "",
    "# Lint Run",
    "",
    "## Summary",
    "",
    "| Severity | Count |",
    "|----------|-------|",
    `| 🔴 Error   | ${run.errors.length}   |`,
    `| 🟡 Warning | ${run.warnings.length} |`,
    `| 🔵 Info    | ${run.infos.length}    |`,
    "",
  ];

  for (const { label, items } of [
    { label: "🔴 Errors",   items: run.errors   },
    { label: "🟡 Warnings", items: run.warnings },
    { label: "🔵 Info",     items: run.infos    },
  ]) {
    if (items.length === 0) continue;
    lines.push(`## ${label}`, "");
    for (const r of items) {
      lines.push(`- **[${r.rule}]** \`${r.file}\``);
      lines.push(`  ${r.message}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
