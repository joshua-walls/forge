// src/docs.ts
// Vault Forge documentation installer.
//
// Doc content lives as real .md files in /docs and /examples.
// esbuild inlines them as string constants at build time via the text loader.
// To edit documentation, edit the .md files directly — no TypeScript changes needed.
//
// Placeholders in .md files use {{name}} syntax and are substituted at install time.

import { App, Notice, TFile, normalizePath } from "obsidian";
import type { VaultForgeSettings } from "./settings";
import { getVaultPaths } from "./vault-paths";
import { ensureFolder, todayString } from "./utils/files";

// ── Doc imports — dynamically discovered by esbuild at build time ─────────────
// The docFolderPlugin in esbuild.config.mjs scans docs/ and examples/ at build
// time and generates these virtual modules as Record<string, string>.
// Add, remove, or rename any .md file in those folders — no code changes needed.

import docsRaw     from "vault-forge:docs";
import examplesRaw from "vault-forge:examples";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GeneratedDoc {
  path: string;
  content: string;
}

interface DocContext {
  today: string;
  vaultForge: string;
  docsFolder: string;
  examplesFolder: string;
  patchesFolder: string;
  patchFile: string;
  schemaFile: string;
  exportsFolder: string;
  inboxFolder: string;
  patternsFolder: string;
}

// ── Placeholder substitution ──────────────────────────────────────────────────

/**
 * Replaces {{placeholder}} tokens in doc content with values from DocContext.
 */
function interpolate(template: string, ctx: DocContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return (ctx as any)[key] ?? `{{${key}}}`;
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function installVaultForgeDocumentation(
  app: App,
  settings: VaultForgeSettings
): Promise<void> {
  const paths = getVaultPaths(settings);
  const today = todayString();

  const ctx: DocContext = {
    today,
    vaultForge:      paths.vaultForge,
    docsFolder:      `${paths.vaultForge}/Docs`,
    examplesFolder:  `${paths.vaultForge}/Examples`,
    patchesFolder:   paths.patches,
    patchFile:       paths.patchFile,
    schemaFile:      paths.schemaMd,
    exportsFolder:   paths.exports,
    inboxFolder:     paths.inbox,
    patternsFolder:  paths.patterns,
  };

  await ensureFolder(app, ctx.docsFolder);
  await ensureFolder(app, ctx.examplesFolder);

  const docs = buildDocList(ctx);
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
    `Vault Forge docs installed: ${written} written, ${skipped} already existed.`,
    6000
  );
}

// ── Doc list ──────────────────────────────────────────────────────────────────

function buildDocList(ctx: DocContext): GeneratedDoc[] {
  // Build doc list dynamically from the virtual modules.
  // Each key is the filename without .md extension.
  // Tag and type are inferred from filename — override by adding a frontmatter
  // block to the .md file itself (the installer strips it before writing).
  const docs: Array<{ relativePath: string; raw: string; type: string; tags: string[] }> = [
    ...Object.entries(docsRaw as Record<string, string>).map(([key, raw]) => ({
      relativePath: `Docs/${key}.md`,
      raw,
      type: "reference",
      tags: inferTags(key, "docs"),
    })),
    ...Object.entries(examplesRaw as Record<string, string>).map(([key, raw]) => ({
      relativePath: `Examples/${key}.md`,
      raw,
      type: inferType(key),
      tags: inferTags(key, "examples"),
    })),
  ];

  return docs.map(({ relativePath, raw, type, tags }) => {
    const body = interpolate(raw, ctx);

    const frontmatter = [
      "---",
      `type: ${type}`,
      "status: active",
      "tags:",
      ...tags.map((t) => `  - ${t}`),
      `created: ${ctx.today}`,
      `updated: ${ctx.today}`,
      "ai_private: false",
      "review_cycle: never",
      "---",
      "",
    ].join("\n");

    return {
      path: `${ctx.vaultForge}/${relativePath}`,
      content: frontmatter + body.trim() + "\n",
    };
  });
}

// ── Inference helpers ─────────────────────────────────────────────────────────

/**
 * Infers tags from filename and folder.
 * All docs get tool/vault-forge plus a subject tag based on filename.
 */
function inferTags(key: string, folder: string): string[] {
  const base = ["tool/vault-forge"];
  const lower = key.toLowerCase();

  if (lower.includes("install") || lower.includes("start")) {
    base.push("topic/onboarding");
  } else if (lower.includes("schema") || lower.includes("lint") || lower.includes("structure")) {
    base.push("topic/schema");
  } else if (lower.includes("patch") || lower.includes("trouble") || lower.includes("repair")) {
    base.push("topic/procedure");
  } else {
    base.push("topic/reference");
  }

  return base;
}

/**
 * Infers note type from filename.
 */
function inferType(key: string): string {
  const lower = key.toLowerCase();
  if (lower.includes("patch") || lower.includes("example")) return "procedure";
  return "reference";
}
