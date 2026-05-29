// src/commands/export-overview.ts
// Export Vault Overview — single command, three outputs + optional dashboard:
//
//   vault-inventory.json   — flat note index (schema-optional)
//   vault-meta.json        — aggregate counts, private notes excluded if configured
//   vault-export.md        — human-readable Obsidian note, no H1
//   <dashboard>.md         — created once on first run, Dataview dashboard

import { App, Notice, TFile, normalizePath } from "obsidian";
import type ForgePlugin from "../main";
import { ensureFolder, isExempt, localTimestamp, todayString } from "../utils/files";
import { readNote, getFmString } from "../utils/frontmatter";
import { loadSchema } from "../utils/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InventoryRecord {
  path: string;
  filename: string;
  tags: string;
  type: string;
  domain: string;
  status: string;
  isPrivate: boolean;
}

export interface InventoryExport {
  generated_at: string;
  schema_version: string;
  count: number;
  items: InventoryRecord[];
}

export interface VaultMetaExport {
  generated_at: string;
  schema_version: string;
  [key: string]: unknown;  // keys are dynamic: note_counts_by_{fieldName}
}

// ── Entry point ───────────────────────────────────────────────────────────────

interface ExportOverviewOptions {
  silent?: boolean;
}

export async function runExportOverview(
  plugin: ForgePlugin,
  options: ExportOverviewOptions = {}
): Promise<void> {
  const { app, settings } = plugin;
  const { silent = false } = options;

  if (!settings.exportEnabled) {
    if (!silent) new Notice("Forge: Export is not enabled — enable it in Settings → Export.", 5000);
    return;
  }

  if (!silent) new Notice("Forge: Building vault overview…", 3000);
  await ensureFolder(app, settings.exportsFolder);

  const inventory = await buildInventory(plugin);
  const meta      = buildMeta(settings, inventory);

  await writeFile(app,
    normalizePath(`${settings.exportsFolder}/vault-inventory.json`),
    JSON.stringify(inventory, null, 2)
  );

  await writeFile(app,
    normalizePath(`${settings.exportsFolder}/vault-meta.json`),
    JSON.stringify(meta, null, 2)
  );

  await writeFile(app,
    normalizePath(`${settings.exportsFolder}/vault-export.md`),
    buildExportNote(inventory, meta, settings, todayString())
  );

  // Dashboard — create once only, never overwrite
  const dashName = settings.exportDashboardName?.trim() || "vault-dashboard";
  const dashPath = normalizePath(`${settings.exportsFolder}/${dashName}.md`);
  const dashExists = app.vault.getAbstractFileByPath(dashPath) instanceof TFile;
  if (!dashExists) {
    await app.vault.create(dashPath, buildDashboardNote(settings, todayString()));
  }

  if (!silent) new Notice(`Forge: Overview complete — ${inventory.count} notes indexed.`, 5000);
}

// ── Inventory builder ─────────────────────────────────────────────────────────

async function buildInventory(plugin: ForgePlugin): Promise<InventoryExport> {
  const { app, settings } = plugin;

  const schema        = await loadSchema(app, settings);
  const exemptPaths   = schema?.exempt_paths ?? [];
  const schemaVer     = schema?.version ?? "unknown";
  const privateField  = settings.exportPrivateEnabled ? settings.exportPrivateField : "";
  const domainField   = settings.exportDomainField;
  const typeField     = settings.exportTypeField   || "type";
  const statusField   = settings.exportStatusField || "status";

  const allFiles = app.vault.getMarkdownFiles().filter((f) => {
    if (f.path.split("/").some((seg) => seg.startsWith("."))) return false;
    if (exemptPaths.length > 0 && isExempt(f.path, exemptPaths)) return false;
    return true;
  });

  const items: InventoryRecord[] = [];

  for (const file of allFiles) {
    const note = await readNote(app, file);
    const fm   = note?.frontmatter ?? {};

    let domain = domainField ? getFmString(fm, domainField) : "";
    if (!domain) {
      const parts = file.path.split("/");
      domain = parts.length > 1 ? parts[0] : "(root)";
    }

    items.push({
      path:      file.path,
      filename:  file.basename,
      tags:      getFmString(fm, "tags"),
      type:      getFmString(fm, typeField),
      domain,
      status:    getFmString(fm, statusField),
      isPrivate: privateField ? Boolean(fm[privateField]) : false,
    });
  }

  items.sort((a, b) => a.path.localeCompare(b.path));

  return {
    generated_at:   localTimestamp(),
    schema_version: schemaVer,
    count:          items.length,
    items,
  };
}

// ── Meta builder ──────────────────────────────────────────────────────────────

function buildMeta(settings: ForgePlugin["settings"], inventory: InventoryExport): VaultMetaExport {
  const schemaVer = inventory.schema_version;

  // Use configured field names as JSON keys
  const domainLabel  = settings.exportDomainField  || "domain";
  const typeLabel    = settings.exportTypeField    || "type";
  const statusLabel  = settings.exportStatusField  || "status";

  const byDomain: Record<string, number> = {};
  const byType:   Record<string, number> = {};
  const byStatus: Record<string, number> = {};

  for (const item of inventory.items) {
    if (settings.exportPrivateEnabled && item.isPrivate) continue;

    byDomain[item.domain]     = (byDomain[item.domain]     ?? 0) + 1;
    if (item.type)   byType[item.type]     = (byType[item.type]     ?? 0) + 1;
    if (item.status) byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
  }

  return {
    generated_at:   localTimestamp(),
    schema_version: schemaVer,
    [`note_counts_by_${domainLabel}`]:  byDomain,
    [`note_counts_by_${typeLabel}`]:    byType,
    [`note_counts_by_${statusLabel}`]:  byStatus,
  };
}

// ── Export note builder ───────────────────────────────────────────────────────

function buildExportNote(
  inventory: InventoryExport,
  meta: VaultMetaExport,
  settings: ForgePlugin["settings"],
  today: string
): string {
  const privateEnabled = settings.exportPrivateEnabled && settings.exportPrivateField;
  const domainLabel    = settings.exportDomainField  || "domain";
  const typeLabel      = settings.exportTypeField    || "type";
  const statusLabel    = settings.exportStatusField  || "status";

  const allItems     = inventory.items;
  const privateItems = privateEnabled ? allItems.filter((i) => i.isPrivate) : [];
  const totalNotes   = allItems.length;
  const totalPrivate = privateItems.length;

  const countBy = (items: InventoryRecord[], key: keyof InventoryRecord) => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      const val = String(item[key] || "");
      if (!val) continue;
      counts[val] = (counts[val] ?? 0) + 1;
    }
    return counts;
  };

  const tableRows = (counts: Record<string, number>, col: string) => [
    `| ${col} | Count |`,
    `|--------|-------|`,
    ...Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `| ${k} | ${v} |`),
  ];

  const lines: string[] = [
    "---",
    "type: reference",
    "status: complete",
    "tags:",
    "  - meta/vault-export",
    `created: ${today}`,
    `updated: ${today}`,
    ...(settings.exportPrivateField ? [`${settings.exportPrivateField}: false`] : []),
    "review_cycle: never",
    "---",
    "",
    `schema_version:: "${inventory.schema_version}"`,
    `generated:: ${inventory.generated_at}`,
    `total_notes:: ${totalNotes}`,
    `total_private_notes:: ${totalPrivate}`,
    "",
    `> Generated ${inventory.generated_at}`,
    "> Machine-readable data: `vault-inventory.json`, `vault-meta.json`",
    "",
    `## All Notes by ${domainLabel}`,
    "",
    ...tableRows(countBy(allItems, "domain"), domainLabel),
    "",
    `## All Notes by ${typeLabel}`,
    "",
    ...tableRows(countBy(allItems, "type"), typeLabel),
    "",
    `## All Notes by ${statusLabel}`,
    "",
    ...tableRows(countBy(allItems, "status"), statusLabel),
    "",
  ];

  if (privateEnabled && privateItems.length > 0) {
    lines.push(
      "---",
      "",
      `## Private Notes by ${domainLabel}`,
      "",
      ...tableRows(countBy(privateItems, "domain"), domainLabel),
      "",
      `## Private Notes by ${typeLabel}`,
      "",
      ...tableRows(countBy(privateItems, "type"), typeLabel),
      "",
      `## Private Notes by ${statusLabel}`,
      "",
      ...tableRows(countBy(privateItems, "status"), statusLabel),
      "",
    );
  }

  return lines.join("\n");
}

// ── Dashboard note builder ────────────────────────────────────────────────────

function buildDashboardNote(settings: ForgePlugin["settings"], today: string): string {
  const folder      = settings.exportsFolder;
  const typeLabel   = settings.exportTypeField || "type";
  const privateEnabled = settings.exportPrivateEnabled && settings.exportPrivateField;

  const lines: string[] = [
    "---",
    "type: reference",
    "status: active",
    "tags:",
    "  - meta/dashboard",
    `created: ${today}`,
    `updated: ${today}`,
    "review_cycle: never",
    "---",
    "",
    "> This dashboard is generated once and never overwritten — edit freely.",
    "",
    "## Vault Overview",
    "",
    "```dataview",
    `TABLE total_notes, total_private_notes, generated, schema_version`,
    `FROM "${folder}"`,
    `WHERE contains(tags, "meta/vault-export") AND file.name = "vault-export"`,
    "```",
    "",
    `## Ontology Indexes`,
    "",
    "```dataview",
    `TABLE total_notes, total_private_notes, relationship_heading, generated`,
    `FROM "${folder}"`,
    `WHERE contains(tags, "meta/vault-export") AND node_type`,
    `SORT ${typeLabel} ASC`,
    "```",
    "",
  ];

  if (privateEnabled) {
    lines.push(
      "## Private Note Breakdown",
      "",
      "```dataview",
      `TABLE total_private_notes, total_notes, generated`,
      `FROM "${folder}"`,
      `WHERE contains(tags, "meta/vault-export")`,
      `SORT total_private_notes DESC`,
      "```",
      "",
    );
  }

  return lines.join("\n");
}

// ── Inventory loader (used by ontology export) ────────────────────────────────

export async function loadInventory(
  app: App,
  exportsFolder: string
): Promise<InventoryExport | null> {
  const path = normalizePath(`${exportsFolder}/vault-inventory.json`);
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;
  try {
    return JSON.parse(await app.vault.read(file)) as InventoryExport;
  } catch (e) {
    console.warn("[Forge] Could not load inventory:", e);
    return null;
  }
}

// ── Write helper ──────────────────────────────────────────────────────────────

async function writeFile(app: App, path: string, content: string): Promise<void> {
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
  } else {
    await app.vault.create(path, content);
  }
}
