// src/commands/export-ontology.ts
// Export Ontology Index command.
//
// Outputs per selected filter value:
//   System/Exports/<type>-index.json  — machine-readable
//   System/Exports/<type>-index.md    — human-readable, Obsidian-native
//
// Flow:
//   1. Ensure inventory exists — auto-runs Export Inventory if not
//   2. Filter inventory by configured field + values (no hardcoded paths)
//   3. Walk matched notes, extract relationship graph dynamically
//   4. Write one JSON + one MD per matched value

import { App, Notice, TFile, normalizePath } from "obsidian";
import type ForgePlugin from "../main";
import { ensureFolder, localTimestamp, todayString } from "../utils/files";
import { readNote, getFmString } from "../utils/frontmatter";
import { runExportOverview, loadInventory, type InventoryRecord } from "./export-overview";

export interface OntologyRelationships { [key: string]: string[]; }

export interface OntologyNode {
  name: string;
  type: string;
  path: string;
  domain: string;
  status: string;
  tags: string;
  relationships: OntologyRelationships;
  outbound_links: string[];
  modified_utc: string;
}

export interface OntologyIndex {
  generated_at_utc: string;
  schema_version: string;
  index_type: string;
  node_type: string;
  relationship_heading: string;
  filter_field: string;
  filter_value: string;
  total_notes: number;
  total_private_notes: number;
  items: OntologyNode[];
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function runExportOntology(plugin: ForgePlugin): Promise<OntologyIndex[] | null> {
  const { app, settings } = plugin;

  if (!settings.exportEnabled) {
    new Notice("Forge: Export is not enabled — enable it in Settings → Export.", 5000);
    return null;
  }

  if (!settings.exportFilterField || settings.exportFilterValues.length === 0) {
    new Notice("Forge: No filter configured — set a field and values in Settings → Export.", 7000);
    return null;
  }

  const schemaVersion = plugin.schemaCache.peek()?.version ?? "unknown";
  const relHeading    = settings.exportRelationshipHeading?.trim() || "Related";

  // Ensure inventory — auto-run if missing
  let inventory = await loadInventory(app, settings.exportsFolder);
  if (!inventory) {
    new Notice("Forge: No inventory found — running Export Inventory first…", 4000);
    await runExportOverview(plugin);
    inventory = await loadInventory(app, settings.exportsFolder);
    if (!inventory) {
      new Notice("Forge: Inventory export failed — ontology export aborted.", 6000);
      return null;
    }
  }

  // Apply folder exclusion filter
  const excludeFolders = settings.exportExcludeFolders ?? [];
  const filteredItems = excludeFolders.length > 0
    ? inventory.items.filter((r) => {
        const norm = r.path.replace(/\\/g, "/");
        return !excludeFolders.some((folder) => {
          const f = folder.replace(/\\/g, "/").replace(/\/$/, "");
          return norm === f || norm.startsWith(f + "/");
        });
      })
    : inventory.items;

  // Group records by filter value
  const { exportFilterField, exportFilterValues } = settings;
  const recordsByValue = new Map<string, InventoryRecord[]>();

  for (const record of filteredItems) {
    const raw = getRecordField(record, exportFilterField);
    if (!raw) continue;
    for (const val of raw.split(";").map((v) => v.trim()).filter(Boolean)) {
      if (!exportFilterValues.includes(val)) continue;
      if (!recordsByValue.has(val)) recordsByValue.set(val, []);
      recordsByValue.get(val)!.push(record);
    }
  }

  if (recordsByValue.size === 0) {
    new Notice(`Forge: No notes matched '${exportFilterField}' in [${exportFilterValues.join(", ")}].`, 7000);
    return null;
  }

  new Notice(`Forge: Building ontology indexes for ${recordsByValue.size} type(s)…`, 4000);

  const indexes: OntologyIndex[] = [];
  const today = todayString();

  for (const [filterValue, records] of recordsByValue) {
    const items = await buildNodes(app, records, relHeading);
    items.sort((a, b) => a.name.localeCompare(b.name));

    const privateField   = settings.exportPrivateEnabled ? settings.exportPrivateField : "";
    const privateCount   = privateField
      ? records.filter((r) => {
          // isPrivate is set on inventory records from the overview run
          return Boolean((r as InventoryRecord & { isPrivate?: boolean }).isPrivate);
        }).length
      : 0;

    const index: OntologyIndex = {
      generated_at_utc:     localTimestamp(),
      schema_version:       schemaVersion,
      index_type:           `${filterValue}-index`,
      node_type:            filterValue,
      relationship_heading: relHeading,
      filter_field:         exportFilterField,
      filter_value:         filterValue,
      total_notes:          items.length,
      total_private_notes:  privateCount,
      items,
    };

    indexes.push(index);
    await ensureFolder(app, settings.exportsFolder);

    const base = normalizePath(`${settings.exportsFolder}/${filterValue}-index`);
    await writeFile(app, `${base}.json`, JSON.stringify(index, null, 2));
    const domainLabel = settings.exportDomainField  || "domain";
    const statusLabel = settings.exportStatusField || "status";
    await writeFile(app, `${base}.md`,   buildOntologyNote(index, today, domainLabel, statusLabel));
  }

  const total = indexes.reduce((sum, idx) => sum + idx.total_notes, 0);
  new Notice(`Forge: Ontology export complete — ${total} notes across [${[...recordsByValue.keys()].join(", ")}].`, 6000);
  return indexes;
}

// ── Node builder ──────────────────────────────────────────────────────────────

async function buildNodes(app: App, records: InventoryRecord[], relHeading: string): Promise<OntologyNode[]> {
  const nodes: OntologyNode[] = [];
  for (const record of records) {
    const abstractFile = app.vault.getAbstractFileByPath(normalizePath(record.path));
    if (!(abstractFile instanceof TFile)) continue;

    const note = await readNote(app, abstractFile);
    if (!note) continue;

    nodes.push({
      name:           getFmString(note.frontmatter, "title") || note.file.basename,
      type:           record.type,
      path:           record.path,
      domain:         record.domain,
      status:         record.status,
      tags:           record.tags,
      relationships:  extractRelationships(note.body, relHeading),
      outbound_links: extractAllWikilinks(note.body),
      modified_utc:   new Date(note.file.stat.mtime).toISOString(),
    });
  }
  return nodes;
}

// ── Relationship extraction ───────────────────────────────────────────────────

function extractRelationships(body: string, parentHeading: string): OntologyRelationships {
  const relationships: OntologyRelationships = {};
  const parentMatch = new RegExp(`^(#{1,6})\\s+${escapeRegex(parentHeading)}\\s*$`, "m").exec(body);
  if (!parentMatch) return relationships;

  const parentLevel = parentMatch[1].length;
  const lines = body.slice(parentMatch.index + parentMatch[0].length).split(/\r?\n/);
  let currentKey: string | null = null;

  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (h) {
      if (h[1].length <= parentLevel) break;
      currentKey = h[2].trim();
      if (!relationships[currentKey]) relationships[currentKey] = [];
    } else if (currentKey) {
      relationships[currentKey].push(...wikilinkTargets(line));
    }
  }
  return relationships;
}

function extractAllWikilinks(body: string): string[] {
  const seen = new Set<string>();
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) seen.add(m[1].trim());
  return [...seen].sort();
}

function wikilinkTargets(line: string): string[] {
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) out.push(m[1].trim());
  return out;
}

// ── Markdown note builder ─────────────────────────────────────────────────────

function buildOntologyNote(index: OntologyIndex, today: string, domainLabel: string, statusLabel: string): string {
  const allKeys = new Set<string>();
  for (const node of index.items) Object.keys(node.relationships).forEach((k) => allKeys.add(k));

  return [
    "---", "type: reference", "status: complete", "tags:", "  - meta/vault-export",
    `created: ${today}`, `updated: ${today}`, "ai_private: false", "review_cycle: never", "---", "",
    `schema_version:: "${index.schema_version}"`, `generated:: ${index.generated_at_utc}`,
    `node_type:: ${index.node_type}`, `total_notes:: ${index.total_notes}`,
    `total_private_notes:: ${index.total_private_notes}`,
    `relationship_heading:: ${index.relationship_heading}`, "",
    `> Generated ${index.generated_at_utc} — ${index.total_notes} notes.`,
    `> Relationship heading: \`# ${index.relationship_heading}\``,
    `> Machine-readable data: \`${index.node_type}-index.json\``, "",
    "# Relationship Keys Observed", "",
    allKeys.size > 0 ? [...allKeys].sort().map((k) => `- ${k}`).join("\n") : "_No relationship sections found._",
    "", "# Notes", "",
    `| Name | ${statusLabel} | ${domainLabel} | Relationships |`,
    "|------|--------|--------|---------------|",
    ...index.items.map((n) => {
      const links = Object.values(n.relationships).reduce((s, a) => s + a.length, 0);
      return `| [[${n.path}\\|${n.name}]] | ${n.status || "—"} | ${n.domain} | ${links} |`;
    }), "",
  ].join("\n");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getRecordField(record: InventoryRecord, field: string): string {
  switch (field) {
    case "type":   return record.type;
    case "status": return record.status;
    case "domain": return record.domain;
    case "tags":   return record.tags;
    default:       return "";
  }
}

async function writeFile(app: App, path: string, content: string): Promise<void> {
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
  } else {
    await app.vault.create(path, content);
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
