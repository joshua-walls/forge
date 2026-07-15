// src/patch-manifest.ts
// Writes the restore manifest JSON, copies the applied patch note,
// and writes the patch report note after a patch run.
//
// Restore manifest:
//   System/Forge/Patches/Reports/{runId}-patch-manifest.json
//
// Patch report:
//   System/Forge/Patches/Reports/{runId}-patch-report-apply.md
//   System/Exports/{runId}-patch-report-dry-run.md
//
// Applied patch copy:
//   System/Forge/Patches/Applied/{runId}-vault-patch.md

import { App, TFile, normalizePath } from "obsidian";
import {
  buildPatchArchiveArtifact,
  buildPatchReportArtifact,
  buildPatchRestoreManifestArtifact,
} from "@forge/core";
import type { ForgeSettings } from "./settings";
import { ensureFolder } from "./utils/files";
import type { PatchRunResult } from "./patch-engine";

// ── Manifest ─────────────────────────────────────────────────────────────────

/**
 * Writes the restore manifest JSON file.
 * Written when patchGenerateManifest is true. New manifests use operation-level
 * restore data; legacy backup entries are preserved only when present.
 */
export async function writeRestoreManifest(
  app: App,
  settings: ForgeSettings,
  result: PatchRunResult
): Promise<void> {
  const artifact = buildPatchRestoreManifestArtifact(settings, result);
  if (!artifact) return;

  await ensureFolder(app, artifact.folder);
  await app.vault.create(normalizePath(artifact.path), artifact.content);
}

// ── Applied patch copy ────────────────────────────────────────────────────────

/**
 * Copies the applied patch note into the Applied archive folder.
 */
export async function archivePatchFile(
  app: App,
  settings: ForgeSettings,
  result: PatchRunResult
): Promise<void> {
  const sourceFile = app.vault.getAbstractFileByPath(
    normalizePath(result.patchFile)
  );

  if (!(sourceFile instanceof TFile)) return;

  const artifact = buildPatchArchiveArtifact(settings, result, sourceFile.extension);
  if (!artifact) return;

  await ensureFolder(app, artifact.folder);
  if (app.vault.getAbstractFileByPath(normalizePath(artifact.path))) return;

  const content = await app.vault.read(sourceFile);
  await app.vault.create(normalizePath(artifact.path), content);
}

// ── Report note ───────────────────────────────────────────────────────────────

/**
 * Writes a human-readable patch report note.
 * For dry runs, writes to System/Exports/ as a preview.
 * For apply runs, writes to System/Forge/Patches/Reports/.
 */
export async function writePatchReport(
  app: App,
  settings: ForgeSettings,
  result: PatchRunResult
): Promise<string> {
  const artifact = buildPatchReportArtifact(settings, result);
  await ensureFolder(app, artifact.folder);

  const existing = app.vault.getAbstractFileByPath(normalizePath(artifact.path));

  if (existing instanceof TFile) {
    await app.vault.modify(existing, artifact.content);
  } else {
    await app.vault.create(normalizePath(artifact.path), artifact.content);
  }

  return artifact.path;
}
