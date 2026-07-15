import { localTimestamp, normalisePath, todayString } from "../vault/paths.js";
import type { ForgeSettings } from "../config/settings.js";
import type { PatchRunResult } from "./model.js";
import type { PatchRestoreApplyResult, PatchRestoreManifest } from "./restore.js";

export interface PatchArtifactSettings {
  patchesFolder: ForgeSettings["patchesFolder"];
  exportsFolder: ForgeSettings["exportsFolder"];
  patchGenerateManifest: ForgeSettings["patchGenerateManifest"];
}

export interface PatchTextArtifact {
  folder: string;
  path: string;
  content: string;
}

export interface PatchJsonArtifact<T> {
  folder: string;
  path: string;
  data: T;
  content: string;
}

export interface PatchArchiveArtifact {
  folder: string;
  path: string;
}

export interface BuildPatchReportNoteOptions {
  today?: string;
  mode?: string;
}

export interface BuildPatchRestoreReportNoteOptions {
  today?: string;
  restoredAt?: string;
  legacy?: boolean;
  summary?: PatchRestoreReportSummary;
}

export interface PatchRestoreReportSummary {
  restored: number;
  conflicted: number;
  skipped: number;
  errors: number;
}

export function shouldWritePatchRestoreManifest(
  settings: Pick<PatchArtifactSettings, "patchGenerateManifest">,
  result: PatchRunResult
): boolean {
  return Boolean(
    settings.patchGenerateManifest &&
    !result.dryRun &&
    (result.manifest.length > 0 || result.operations.length > 0)
  );
}

export function buildPatchRestoreManifest(result: PatchRunResult): PatchRestoreManifest {
  return {
    manifest_version: 2,
    run_id: result.runId,
    patch_file: result.patchFile,
    description: result.description,
    applied_at: result.appliedAt,
    schema_version: result.schemaVersion,
    changes: result.manifest,
    operations: result.operations,
  };
}

export function buildPatchRestoreManifestArtifact(
  settings: Pick<PatchArtifactSettings, "patchesFolder" | "patchGenerateManifest">,
  result: PatchRunResult
): PatchJsonArtifact<PatchRestoreManifest> | null {
  if (!shouldWritePatchRestoreManifest(settings, result)) return null;

  const folder = patchReportsFolder(settings);
  const data = buildPatchRestoreManifest(result);
  return {
    folder,
    path: normalisePath(`${folder}/${result.runId}-patch-manifest.json`),
    data,
    content: JSON.stringify(data, null, 2),
  };
}

export function buildPatchArchiveArtifact(
  settings: Pick<PatchArtifactSettings, "patchesFolder">,
  result: PatchRunResult,
  sourceExtension?: string
): PatchArchiveArtifact | null {
  if (result.dryRun) return null;

  const folder = patchAppliedFolder(settings);
  const extension = normalisePatchExtension(sourceExtension ?? extensionFromPath(result.patchFile));
  return {
    folder,
    path: normalisePath(`${folder}/${result.runId}-vault-patch.${extension}`),
  };
}

export function buildPatchReportArtifact(
  settings: Pick<PatchArtifactSettings, "patchesFolder" | "exportsFolder">,
  result: PatchRunResult,
  options: BuildPatchReportNoteOptions = {}
): PatchTextArtifact {
  const mode = options.mode ?? (result.dryRun ? "dry-run" : "apply");
  const folder = result.dryRun ? normalisePath(settings.exportsFolder) : patchReportsFolder(settings);

  return {
    folder,
    path: normalisePath(`${folder}/${result.runId}-patch-report-${mode}.md`),
    content: buildPatchReportNote(result, {
      ...options,
      mode,
    }),
  };
}

export function buildPatchReportNote(
  result: PatchRunResult,
  options: BuildPatchReportNoteOptions = {}
): string {
  const mode = options.mode ?? (result.dryRun ? "dry-run" : "apply");
  const date = options.today ?? todayString();
  const changed = result.results.filter((item) => item.status === "changed");
  const skipped = result.results.filter((item) => item.status === "skipped");
  const errors = result.results.filter((item) => item.status === "error");

  const lines: string[] = [
    "---",
    "type: reference",
    "status: active",
    "tags:",
    "  - meta/patch-report",
    `created: ${date}`,
    `updated: ${date}`,
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
    for (const resultItem of errors) {
      lines.push(`- \`[${resultItem.op}]\` \`${resultItem.file}\` — ${resultItem.detail}`);
    }
    lines.push("");
  }

  if (changed.length > 0) {
    lines.push("## Changed", "");
    const byOp = groupBy(changed, (resultItem) => resultItem.op);
    for (const [op, items] of Object.entries(byOp)) {
      lines.push(`### ${op}`, "");
      for (const resultItem of items) {
        lines.push(`- \`${resultItem.file}\` — ${resultItem.detail}`);
      }
      lines.push("");
    }
  }

  if (skipped.length > 0) {
    lines.push("## Skipped", "");
    for (const resultItem of skipped) {
      lines.push(`- \`[${resultItem.op}]\` \`${resultItem.file}\` — ${resultItem.detail}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function buildPatchRestoreReportArtifact(
  settings: Pick<PatchArtifactSettings, "patchesFolder">,
  manifest: PatchRestoreManifest,
  results: PatchRestoreApplyResult[],
  options: BuildPatchRestoreReportNoteOptions = {}
): PatchTextArtifact {
  const folder = patchReportsFolder(settings);
  return {
    folder,
    path: normalisePath(`${folder}/${manifest.run_id}-patch-report-restore.md`),
    content: buildPatchRestoreReportNote(manifest, results, options),
  };
}

export function buildPatchRestoreReportNote(
  manifest: PatchRestoreManifest,
  results: PatchRestoreApplyResult[],
  options: BuildPatchRestoreReportNoteOptions = {}
): string {
  const today = options.today ?? todayString();
  const restoredAt = options.restoredAt ?? localTimestamp();
  const legacy = options.legacy ?? false;
  const restored = results.filter((result) => result.status === "restored");
  const conflicted = results.filter((result) => result.status === "conflicted");
  const skipped = results.filter((result) => result.status === "skipped");
  const errors = results.filter((result) => result.status === "error");
  const summary = options.summary ?? {
    restored: restored.length,
    conflicted: conflicted.length,
    skipped: skipped.length,
    errors: errors.length,
  };

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
    `source:: ${manifest.patch_file}`,
    "patch_mode:: restore",
    `source_patch_run:: ${manifest.run_id}`,
    `restore_legacy:: ${legacy}`,
    `restored_count:: ${summary.restored}`,
    `conflicted_count:: ${summary.conflicted}`,
    `skipped_count:: ${summary.skipped}`,
    `error_count:: ${summary.errors}`,
    "",
    "# Patch Restore Report",
    "",
    "## Summary",
    "",
    `- Source run: ${manifest.run_id}`,
    `- Description: ${manifest.description || ""}`,
    `- Restored at: ${restoredAt}`,
    `- Legacy full-file restore: ${legacy ? "yes" : "no"}`,
    `- Restored: ${summary.restored}`,
    `- Conflicted: ${summary.conflicted}`,
    `- Skipped: ${summary.skipped}`,
    `- Errors: ${summary.errors}`,
    "",
  ];

  if (legacy) {
    lines.push("## Legacy Restore", "");
    lines.push(
      "This restore used full-file backup replacement because the manifest did not contain operation-level restore data.",
      ""
    );
  }

  for (const [heading, items] of [
    ["Restored", restored],
    ["Conflicted", conflicted],
    ["Skipped", skipped],
    ["Errors", errors],
  ] as const) {
    if (items.length === 0) continue;
    lines.push(`## ${heading}`, "");
    for (const item of items) {
      lines.push(`- \`[${item.operation.op}]\` \`${item.operation.file_after}\` — ${item.detail}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function patchReportsFolder(settings: Pick<PatchArtifactSettings, "patchesFolder">): string {
  return normalisePath(`${settings.patchesFolder}/Reports`);
}

function patchAppliedFolder(settings: Pick<PatchArtifactSettings, "patchesFolder">): string {
  return normalisePath(`${settings.patchesFolder}/Applied`);
}

function extensionFromPath(path: string): string {
  const normalized = normalisePath(path);
  const filename = normalized.split("/").pop() ?? normalized;
  const index = filename.lastIndexOf(".");
  return index >= 0 && index < filename.length - 1 ? filename.slice(index + 1) : "md";
}

function normalisePatchExtension(extension: string): string {
  const normalized = extension.replace(/^\./u, "").trim().toLowerCase();
  return normalized || "md";
}

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const value = key(item);
    acc[value] ??= [];
    acc[value].push(item);
    return acc;
  }, {});
}
