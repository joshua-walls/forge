// src/docs.ts
// Forge documentation installer.
//
// Doc content lives as real .md files in /docs and /examples.
// esbuild inlines them as string constants at build time via the text loader.
// To edit documentation, edit the .md files directly — no TypeScript changes needed.
//
// Placeholders in .md files use {{name}} syntax and are substituted at install time.

import {
  buildForgeDocumentation,
  buildForgeDocumentationContext,
  todayString,
} from "@forge/core";
import { App, Notice, TFile, normalizePath } from "obsidian";
import type { ForgeSettings } from "./settings";
import { ensureFolder } from "./utils/files";

// ── Doc imports — dynamically discovered by esbuild at build time ─────────────
// The docFolderPlugin in esbuild.config.mjs scans docs/ and examples/ at build
// time and generates these virtual modules as Record<string, string>.
// Add, remove, or rename any .md file in those folders — no code changes needed.

import docsRaw     from "forge:docs";
import examplesRaw from "forge:examples";

// ── Entry point ───────────────────────────────────────────────────────────────

export async function installVaultForgeDocumentation(
  app: App,
  settings: ForgeSettings
): Promise<void> {
  const today = todayString();
  const ctx = buildForgeDocumentationContext(settings, { today });

  await ensureFolder(app, ctx.docsFolder);
  await ensureFolder(app, ctx.examplesFolder);

  const docs = buildForgeDocumentation(settings, {
    docs: docsRaw,
    examples: examplesRaw,
  }, { today });
  let written = 0;
  let skipped = 0;

  for (const doc of docs) {
    const path = normalizePath(doc.path);
    const existing = app.vault.getAbstractFileByPath(path);

    if (existing instanceof TFile) {
      skipped++;
      continue;
    }

    const folder = path.includes("/")
      ? path.substring(0, path.lastIndexOf("/"))
      : "";
    if (folder) await ensureFolder(app, folder);

    await app.vault.create(path, doc.content);
    written++;
  }

  new Notice(
    `Forge docs installed: ${written} written, ${skipped} already existed.`,
    6000
  );
}
