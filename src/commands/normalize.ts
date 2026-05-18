// src/commands/normalize.ts
// Normalize Tags and Normalize Frontmatter commands.
//
// Normalize Tags — port of Invoke-NormalizeTags.ps1:
//   - Converts namespace:tag → namespace/tag (legacy separator)
//   - Removes invalid domain/status/type namespace tags
//   - Sorts and deduplicates tag lists
//   - Rewrites frontmatter field order into canonical schema order
//
// Normalize Frontmatter — port of Set-FrontmatterLowercase.ps1:
//   - Lowercases all frontmatter field names
//   - Lowercases values for enum fields defined by schema
//   - Lowercases all individual tags
//
// Both commands:
//   - Run a dry pass first showing what would change
//   - Show a confirm modal before writing
//   - Back up files before modifying (if backup enabled)
//   - Write a summary notice on completion

import { App, Modal, Notice, TFile } from "obsidian";
import type VaultForgePlugin from "../main";
import { getVaultPaths } from "../vault-paths";
import { readNote, writeNote, backupNote } from "../utils/frontmatter";
import {
  getTags,
  setTags,
  normalizeTags,
  convertTagSeparator,
  isInvalidTag,
} from "../utils/tags";
import { getMarkdownFiles, isExempt, safeTimestamp, todayString } from "../utils/files";
import { loadSchema } from "../utils/schema";
import { ensureFolder } from "../utils/files";

// ── Types ─────────────────────────────────────────────────────────────────────

interface NormalizeResult {
  file: string;
  changed: boolean;
  detail: string;
}

// ── Normalize Tags ────────────────────────────────────────────────────────────

export async function runNormalizeTags(plugin: VaultForgePlugin): Promise<void> {
  const { app, settings } = plugin;
  const paths = getVaultPaths(settings);

  const schema = await loadSchema(app, settings);
  const exemptPaths = [
    ...(schema?.exempt_paths ?? []),
    paths.vaultForge,
  ];

  const files = getMarkdownFiles(app).filter(
    (f) => !isExempt(f.path, exemptPaths)
  );

  new Notice("Vault Forge: Scanning tags…", 2000);

  // Dry pass
  const dryResults = await normalizeTagsPass(app, settings, files, true);
  const candidates = dryResults.filter((r) => r.changed);

  if (candidates.length === 0) {
    new Notice("Vault Forge: All tags already normalized — no changes needed.", 4000);
    return;
  }

  new NormalizeConfirmModal(
    app,
    plugin,
    "Normalize Tags",
    `${candidates.length} file(s) have tags to normalize.`,
    candidates,
    async () => {
      const applyResults = await normalizeTagsPass(app, settings, files, false);
      const changed = applyResults.filter((r) => r.changed).length;
      new Notice(`Vault Forge: Normalized tags in ${changed} file(s).`, 4000);
    }
  ).open();
}

async function normalizeTagsPass(
  app: App,
  settings: VaultForgePlugin["settings"],
  files: TFile[],
  dryRun: boolean
): Promise<NormalizeResult[]> {
  const paths = getVaultPaths(settings);
  const results: NormalizeResult[] = [];

  for (const file of files) {
    const note = await readNote(app, file);
    if (!note || !note.hasFrontmatter) continue;

    const originalTags = getTags(note.frontmatter);

    // Convert namespace:tag → namespace/tag, remove invalid tags
    const converted = originalTags
      .map(convertTagSeparator)
      .filter((t) => !isInvalidTag(t));

    // Sort and deduplicate
    const normalized = normalizeTags(converted);

    const originalStr = originalTags.join("|");
    const normalizedStr = normalized.join("|");

    if (originalStr === normalizedStr) continue;

    const removedCount  = originalTags.length - converted.length;
    const convertedCount = originalTags.filter(
      (t, i) => convertTagSeparator(t) !== t
    ).length;

    const details: string[] = [];
    if (convertedCount > 0) details.push(`${convertedCount} separator(s) fixed`);
    if (removedCount > 0) details.push(`${removedCount} invalid tag(s) removed`);
    if (originalStr !== normalizedStr) details.push("sorted/deduped");

    if (!dryRun) {
      await backupNote(app, file, paths.patchBackups);
      setTags(note.frontmatter, normalized);
      await writeNote(app, note);
    }

    results.push({
      file: file.path,
      changed: true,
      detail: details.join(", "),
    });
  }

  return results;
}

// ── Normalize Frontmatter ─────────────────────────────────────────────────────

export async function runNormalizeFrontmatter(plugin: VaultForgePlugin): Promise<void> {
  const { app, settings } = plugin;
  const paths = getVaultPaths(settings);

  const schema = await loadSchema(app, settings);
  const exemptPaths = [
    ...(schema?.exempt_paths ?? []),
    paths.vaultForge,
  ];

  const files = getMarkdownFiles(app).filter(
    (f) => !isExempt(f.path, exemptPaths)
  );

  new Notice("Vault Forge: Scanning frontmatter…", 2000);

  // Dry pass
  const dryResults = await normalizeFrontmatterPass(app, settings, files, true, plugin);
  const candidates = dryResults.filter((r) => r.changed);

  if (candidates.length === 0) {
    new Notice("Vault Forge: All frontmatter already normalized — no changes needed.", 4000);
    return;
  }

  new NormalizeConfirmModal(
    app,
    plugin,
    "Normalize Frontmatter",
    `${candidates.length} file(s) have frontmatter to normalize.`,
    candidates,
    async () => {
      const applyResults = await normalizeFrontmatterPass(app, settings, files, false, plugin);
      const changed = applyResults.filter((r) => r.changed).length;
      new Notice(`Vault Forge: Normalized frontmatter in ${changed} file(s).`, 4000);
    }
  ).open();
}

// Fields whose values should be lowercased — read from schema cache (enum fields)
// Uses no fallback fields if schema is not loaded
const DEFAULT_LOWERCASE_FIELDS: string[] = [];

async function normalizeFrontmatterPass(
  app: App,
  settings: VaultForgePlugin["settings"],
  files: TFile[],
  dryRun: boolean,
  plugin: VaultForgePlugin
): Promise<NormalizeResult[]> {
  const paths = getVaultPaths(settings);
  const results: NormalizeResult[] = [];

  // Get enum field names from schema cache — these are the fields to lowercase
  const enumFields = plugin.schemaCache
    ? plugin.schemaCache.getEnumFieldNames()
    : DEFAULT_LOWERCASE_FIELDS;
  const lowercaseFields = new Set(enumFields);

  for (const file of files) {
    const note = await readNote(app, file);
    if (!note || !note.hasFrontmatter) continue;

    const fm = note.frontmatter;
    let changed = false;
    const details: string[] = [];

    // Lowercase field names
    const upperKeys = Object.keys(fm).filter((k) => k !== k.toLowerCase());
    if (upperKeys.length > 0) {
      for (const key of upperKeys) {
        const lower = key.toLowerCase();
        if (lower !== key) {
          fm[lower] = fm[key];
          delete fm[key];
        }
      }
      changed = true;
      details.push(`${upperKeys.length} field name(s) lowercased`);
    }

    // Lowercase values for enum fields
    for (const field of lowercaseFields) {
      if (field in fm && typeof fm[field] === "string") {
        const original = fm[field] as string;
        const lower = original.toLowerCase();
        if (original !== lower) {
          fm[field] = lower;
          changed = true;
          details.push(`${field} value lowercased`);
        }
      }
    }

    // Lowercase tags
    const tags = getTags(fm);
    const loweredTags = tags.map((t) => t.toLowerCase());
    const tagStr = tags.join("|");
    const loweredStr = loweredTags.join("|");
    if (tagStr !== loweredStr) {
      setTags(fm, loweredTags);
      changed = true;
      details.push("tags lowercased");
    }

    if (!changed) continue;

    if (!dryRun) {
      await backupNote(app, file, paths.patchBackups);
      await writeNote(app, note);
    }

    results.push({
      file: file.path,
      changed: true,
      detail: details.join(", "),
    });
  }

  return results;
}

// ── Shared confirm modal ──────────────────────────────────────────────────────

class NormalizeConfirmModal extends Modal {
  private plugin: VaultForgePlugin;
  private title: string;
  private summary: string;
  private candidates: NormalizeResult[];
  private onConfirm: () => Promise<void>;

  constructor(
    app: App,
    plugin: VaultForgePlugin,
    title: string,
    summary: string,
    candidates: NormalizeResult[],
    onConfirm: () => Promise<void>
  ) {
    super(app);
    this.plugin = plugin;
    this.title = title;
    this.summary = summary;
    this.candidates = candidates;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: this.title });
    contentEl.createEl("p", { text: this.summary });

    // Preview list — up to 20
    const list = contentEl.createEl("ul", { cls: "vault-forge-change-list" });
    for (const r of this.candidates.slice(0, 20)) {
      list.createEl("li", { text: `${r.file} — ${r.detail}` });
    }
    if (this.candidates.length > 20) {
      list.createEl("li", {
        text: `…and ${this.candidates.length - 20} more`,
        cls: "vault-forge-more",
      });
    }

    if (this.plugin.settings.patchBackupEnabled) {
      contentEl.createEl("p", {
        text: "Backups will be written to System/VaultForge/Patches/Backups/",
        cls: "vault-forge-backup-notice",
      });
    }

    const buttonRow = contentEl.createDiv("vault-forge-button-row");

    const applyBtn = buttonRow.createEl("button", {
      text: "Apply",
      cls: "mod-cta",
    });
    applyBtn.addEventListener("click", async () => {
      this.close();
      await this.onConfirm();
    });

    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
