// src/patch-manifest.ts
// Writes the restore manifest JSON, archives the applied patch note,
// and writes the patch report note after a patch run.
//
// Restore manifest:
//   System/VaultForge/Patches/Reports/{runId}-patch-manifest.json
//
// Patch report:
//   System/VaultForge/Patches/Reports/{runId}-patch-report-apply.md
//   System/Exports/{runId}-patch-report-dry-run.md
//
// Archived patch note:
//   System/VaultForge/Patches/Applied/{runId}-vault-patch.md

import { App, TFile, normalizePath } from "obsidian";
import type { VaultForgeSettings } from "./settings";
import { getVaultPaths } from "./vault-paths";
import { ensureFolder, todayString } from "./utils/files";
import type { PatchRunResult } from "./patch-engine";

// ── Manifest ─────────────────────────────────────────────────────────────────

/**
 * Writes the restore manifest JSON file.
 * Only written when backups are enabled and patchGenerateManifest is true.
 */
export async function writeRestoreManifest(
  app: App,
  settings: VaultForgeSettings,
  result: PatchRunResult
): Promise<void> {
  if (!settings.patchBackupEnabled || !settings.patchGenerateManifest) return;
  if (result.manifest.length === 0) return;
  if (result.dryRun) return;

  const paths = getVaultPaths(settings);
  await ensureFolder(app, paths.patchReports);

  const manifest = {
    run_id: result.runId,
    patch_file: result.patchFile,
    description: result.description,
    applied_at: result.appliedAt,
    schema_version: result.schemaVersion,
    changes: result.manifest,
  };

  const manifestPath = normalizePath(
    `${paths.patchReports}/${result.runId}-patch-manifest.json`
  );

  await app.vault.create(manifestPath, JSON.stringify(manifest, null, 2));
}

// ── Archive patch file ────────────────────────────────────────────────────────

/**
 * Moves the applied patch note into the Applied archive folder.
 */
export async function archivePatchFile(
  app: App,
  settings: VaultForgeSettings,
  result: PatchRunResult
): Promise<void> {
  if (result.dryRun) return;

  const paths = getVaultPaths(settings);
  await ensureFolder(app, paths.patchApplied);

  const sourceFile = app.vault.getAbstractFileByPath(
    normalizePath(result.patchFile)
  );

  if (!(sourceFile instanceof TFile)) return;

  const sourceExt = sourceFile.extension || "md";
  const archivePath = normalizePath(
    `${paths.patchApplied}/${result.runId}-vault-patch.${sourceExt}`
  );

  if (app.vault.getAbstractFileByPath(archivePath)) return;

  await app.vault.rename(sourceFile, archivePath);
}

// ── Report note ───────────────────────────────────────────────────────────────

/**
 * Writes a human-readable patch report note.
 * For dry runs, writes to System/Exports/ as a preview.
 * For apply runs, writes to System/VaultForge/Patches/Reports/.
 */
export async function writePatchReport(
  app: App,
  settings: VaultForgeSettings,
  result: PatchRunResult
): Promise<string> {
  const paths = getVaultPaths(settings);

  const folder = result.dryRun ? paths.exports : paths.patchReports;
  await ensureFolder(app, folder);

  const mode = result.dryRun ? "dry-run" : "apply";
  const reportPath = normalizePath(
    `${folder}/${result.runId}-patch-report-${mode}.md`
  );

  const changed = result.results.filter((r) => r.status === "changed");
  const skipped = result.results.filter((r) => r.status === "skipped");
  const errors = result.results.filter((r) => r.status === "error");

  const today = todayString();

  const content = buildReportNote(result, changed, skipped, errors, today, mode);

  const existing = app.vault.getAbstractFileByPath(reportPath);

  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
  } else {
    await app.vault.create(reportPath, content);
  }

  return reportPath;
}

function buildReportNote(
  result: PatchRunResult,
  changed: PatchRunResult["results"],
  skipped: PatchRunResult["results"],
  errors: PatchRunResult["results"],
  today: string,
  mode: string
): string {
  const lines: string[] = [
    "---",
    "type: reference",
    "status: active",
    "tags:",
    "  - meta/patch-report",
    `created: ${today}`,
    `updated: ${today}`,
    "ai_private: false",
    "review_cycle: never",
    "---",
    "",
    `source:: ${result.patchFile}`,
    `patch_mode:: ${mode}`,
    `changed_count:: ${changed.length}`,
    `skipped_count:: ${skipped.length}`,
    `error_count:: ${errors.length}`,
    "",
    "# Patch Report",
    "",
    "## Summary",
    "",
    `- Mode: ${mode}`,
    `- Run ID: ${result.runId}`,
    `- Patch file: ${result.patchFile}`,
    `- Description: ${result.description}`,
    `- Applied at: ${result.appliedAt}`,
    `- Changed: ${changed.length}`,
    `- Skipped: ${skipped.length}`,
    `- Errors: ${errors.length}`,
    "",
  ];

  if (errors.length > 0) {
    lines.push("## Errors", "");

    for (const r of errors) {
      lines.push(`- \`[${r.op}]\` \`${r.file}\` — ${r.detail}`);
    }

    lines.push("");
  }

  if (changed.length > 0) {
    lines.push("## Changed", "");

    const byOp = groupBy(changed, (r) => r.op);

    for (const [op, items] of Object.entries(byOp)) {
      lines.push(`### ${op}`, "");

      for (const r of items) {
        lines.push(`- \`${r.file}\` — ${r.detail}`);
      }

      lines.push("");
    }
  }

  if (skipped.length > 0) {
    lines.push("## Skipped", "");

    for (const r of skipped) {
      lines.push(`- \`[${r.op}]\` \`${r.file}\` — ${r.detail}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  return arr.reduce<Record<string, T[]>>((acc, item) => {
    const k = key(item);

    if (!acc[k]) acc[k] = [];

    acc[k].push(item);

    return acc;
  }, {});
}
