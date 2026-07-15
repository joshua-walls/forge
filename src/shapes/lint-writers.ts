import { App, TFile, normalizePath } from "obsidian";
import type { ForgeSettings } from "../config/settings";
import { getVaultPaths } from "../vault/paths";
import { ensureFolder, todayString } from "../utils/files";
import type { ShapeLintRunResult } from "./lint-service";

export async function writeShapeLintReportJson(
  app: App,
  settings: ForgeSettings,
  run: ShapeLintRunResult
): Promise<string> {
  const paths = getVaultPaths(settings);
  await ensureFolder(app, paths.exports);

  const reportPath = normalizePath(`${paths.exports}/shape-lint-report.json`);
  const content = JSON.stringify({
    run: run.envelope,
    summary: {
      errors: run.errors.length,
      warnings: run.warnings.length,
      info: run.infos.length,
      notes_scanned: run.envelope.notes_scanned,
    },
    results: run.results,
  }, null, 2);

  await writeText(app, reportPath, content);
  return reportPath;
}

export async function writeShapeLintRunNote(
  app: App,
  settings: ForgeSettings,
  run: ShapeLintRunResult
): Promise<string> {
  const paths = getVaultPaths(settings);
  const folder = normalizePath(`${paths.exports}/ShapeLintReports`);
  await ensureFolder(app, folder);

  const safeTs = run.envelope.timestamp.replace(/[:.]/g, "-").replace("T", "_");
  const notePath = normalizePath(`${folder}/shape-lint-run-${safeTs}.md`);
  const today = todayString();
  const lines = [
    "---",
    "type: reference",
    "status: complete",
    "tags:",
    "  - meta/shape-lint",
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
    "# Shape Lint Run",
    "",
    "## Summary",
    "",
    "| Severity | Count |",
    "|----------|-------|",
    `| Error | ${run.errors.length} |`,
    `| Warning | ${run.warnings.length} |`,
    `| Info | ${run.infos.length} |`,
    "",
  ];

  for (const { label, items } of [
    { label: "Errors", items: run.errors },
    { label: "Warnings", items: run.warnings },
    { label: "Info", items: run.infos },
  ]) {
    if (items.length === 0) continue;
    lines.push(`## ${label}`, "");
    for (const item of items) {
      const fileRef = settings.lintFileLinks ? `[[${item.file}]]` : `\`${item.file}\``;
      lines.push(`- \`[${item.rule}]\` ${fileRef} - ${item.message}`);
    }
    lines.push("");
  }

  await writeText(app, notePath, lines.join("\n"));
  return notePath;
}

async function writeText(app: App, path: string, content: string): Promise<void> {
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
  } else {
    await app.vault.create(path, content);
  }
}
