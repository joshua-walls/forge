import { getFmString, splitFrontmatter } from "../vault/frontmatter.js";
import type { ForgeDocument } from "../linting/model.js";
import { localTimestamp, normalisePath, todayString } from "../vault/paths.js";
import type { VaultSchema } from "../schemas/schema.js";
import type { ForgeSettings } from "../config/settings.js";

export interface InventoryRecord {
  path: string;
  filename: string;
  tags: string;
  type: string;
  domain: string;
  status: string;
  isPrivate: boolean;
  fields: Record<string, string>;
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
  [key: string]: unknown;
}

export interface VaultOverviewArtifacts {
  inventoryPath: string;
  inventory: InventoryExport;
  inventoryJson: string;
  metaPath: string;
  meta: VaultMetaExport;
  metaJson: string;
  exportNotePath: string;
  exportNote: string;
  dashboardPath: string;
  dashboardNote: string;
}

export interface OntologyRelationships {
  [key: string]: string[];
}

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

export interface OntologyIndexArtifact {
  filterValue: string;
  jsonPath: string;
  markdownPath: string;
  index: OntologyIndex;
  json: string;
  markdown: string;
}

export interface BuildVaultInventoryInput {
  documents: ForgeDocument[];
  settings: ForgeSettings;
  schema?: Pick<VaultSchema, "version" | "exempt_paths"> | null;
  generatedAt?: string;
}

export interface BuildVaultOverviewArtifactsInput extends BuildVaultInventoryInput {
  today?: string;
}

export interface BuildOntologyIndexArtifactsInput {
  documents: ForgeDocument[];
  inventory: InventoryExport;
  settings: ForgeSettings;
  schemaVersion?: string;
  generatedAt?: string;
  today?: string;
}

export function buildVaultInventory(input: BuildVaultInventoryInput): InventoryExport {
  const settings = input.settings;
  const privateField = settings.exportPrivateEnabled ? settings.exportPrivateField : "";
  const domainField = settings.exportDomainField;
  const typeField = settings.exportTypeField || "type";
  const statusField = settings.exportStatusField || "status";

  const items = input.documents
    .filter((document) => document.extension.toLowerCase() === "md")
    .filter((document) => !document.path.split("/").some((segment) => segment.startsWith(".")))
    .map((document) => {
      const fields = frontmatterStringMap(document.frontmatter);
      let domain = domainField ? getFmString(document.frontmatter, domainField) : "";
      if (!domain) domain = domainFromPath(document.path);

      return {
        path: document.path,
        filename: document.basename,
        tags: getFmString(document.frontmatter, "tags"),
        type: getFmString(document.frontmatter, typeField),
        domain,
        status: getFmString(document.frontmatter, statusField),
        isPrivate: privateField ? Boolean(document.frontmatter[privateField]) : false,
        fields,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));

  return {
    generated_at: input.generatedAt ?? localTimestamp(),
    schema_version: input.schema?.version ?? "unknown",
    count: items.length,
    items,
  };
}

export function buildVaultMeta(settings: ForgeSettings, inventory: InventoryExport, generatedAt?: string): VaultMetaExport {
  const domainLabel = settings.exportDomainField || "domain";
  const typeLabel = settings.exportTypeField || "type";
  const statusLabel = settings.exportStatusField || "status";
  const byDomain: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};

  for (const item of inventory.items) {
    if (settings.exportPrivateEnabled && item.isPrivate) continue;

    byDomain[item.domain] = (byDomain[item.domain] ?? 0) + 1;
    if (item.type) byType[item.type] = (byType[item.type] ?? 0) + 1;
    if (item.status) byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
  }

  return {
    generated_at: generatedAt ?? localTimestamp(),
    schema_version: inventory.schema_version,
    [`note_counts_by_${domainLabel}`]: byDomain,
    [`note_counts_by_${typeLabel}`]: byType,
    [`note_counts_by_${statusLabel}`]: byStatus,
  };
}

export function buildVaultExportNote(
  inventory: InventoryExport,
  meta: VaultMetaExport,
  settings: ForgeSettings,
  today = todayString()
): string {
  const privateEnabled = settings.exportPrivateEnabled && settings.exportPrivateField;
  const domainLabel = settings.exportDomainField || "domain";
  const typeLabel = settings.exportTypeField || "type";
  const statusLabel = settings.exportStatusField || "status";
  const allItems = inventory.items;
  const privateItems = privateEnabled ? allItems.filter((item) => item.isPrivate) : [];
  const totalNotes = allItems.length;
  const totalPrivate = privateItems.length;

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
      ""
    );
  }

  void meta;
  return lines.join("\n");
}

export function buildVaultDashboardNote(settings: ForgeSettings, today = todayString()): string {
  const folder = settings.exportsFolder;
  const typeLabel = settings.exportTypeField || "type";
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
    "TABLE total_notes, total_private_notes, generated, schema_version",
    `FROM "${folder}"`,
    "WHERE contains(tags, \"meta/vault-export\") AND file.name = \"vault-export\"",
    "```",
    "",
    "## Ontology Indexes",
    "",
    "```dataview",
    "TABLE total_notes, total_private_notes, relationship_heading, generated",
    `FROM "${folder}"`,
    "WHERE contains(tags, \"meta/vault-export\") AND node_type",
    `SORT ${typeLabel} ASC`,
    "```",
    "",
  ];

  if (privateEnabled) {
    lines.push(
      "## Private Note Breakdown",
      "",
      "```dataview",
      "TABLE total_private_notes, total_notes, generated",
      `FROM "${folder}"`,
      "WHERE contains(tags, \"meta/vault-export\")",
      "SORT total_private_notes DESC",
      "```",
      ""
    );
  }

  return lines.join("\n");
}

export function buildVaultOverviewArtifacts(input: BuildVaultOverviewArtifactsInput): VaultOverviewArtifacts {
  const inventory = buildVaultInventory(input);
  const meta = buildVaultMeta(input.settings, inventory, input.generatedAt);
  const exportsFolder = normalisePath(input.settings.exportsFolder);
  const dashboardName = input.settings.exportDashboardName?.trim() || "vault-dashboard";

  return {
    inventoryPath: normalisePath(`${exportsFolder}/vault-inventory.json`),
    inventory,
    inventoryJson: JSON.stringify(inventory, null, 2),
    metaPath: normalisePath(`${exportsFolder}/vault-meta.json`),
    meta,
    metaJson: JSON.stringify(meta, null, 2),
    exportNotePath: normalisePath(`${exportsFolder}/vault-export.md`),
    exportNote: buildVaultExportNote(inventory, meta, input.settings, input.today),
    dashboardPath: normalisePath(`${exportsFolder}/${dashboardName}.md`),
    dashboardNote: buildVaultDashboardNote(input.settings, input.today),
  };
}

export function buildOntologyIndexArtifacts(input: BuildOntologyIndexArtifactsInput): OntologyIndexArtifact[] {
  const settings = input.settings;
  if (!settings.exportFilterField || settings.exportFilterValues.length === 0) return [];

  const documentsByPath = new Map(input.documents.map((document) => [document.path, document]));
  const filteredItems = filterInventoryRecords(input.inventory.items, settings.exportExcludeFolders);
  const recordsByValue = groupInventoryRecordsByFilterValue(
    filteredItems,
    settings.exportFilterField,
    settings.exportFilterValues
  );
  const relationshipHeading = settings.exportRelationshipHeading?.trim() || "Related";
  const schemaVersion = input.schemaVersion ?? input.inventory.schema_version ?? "unknown";
  const today = input.today ?? todayString();
  const generatedAt = input.generatedAt ?? localTimestamp();
  const privateField = settings.exportPrivateEnabled ? settings.exportPrivateField : "";
  const exportsFolder = normalisePath(settings.exportsFolder);
  const domainLabel = settings.exportDomainField || "domain";
  const statusLabel = settings.exportStatusField || "status";
  const artifacts: OntologyIndexArtifact[] = [];

  for (const [filterValue, records] of recordsByValue) {
    const items = records
      .map((record) => buildOntologyNode(record, documentsByPath.get(record.path), relationshipHeading))
      .filter((node): node is OntologyNode => node != null)
      .sort((left, right) => left.name.localeCompare(right.name));
    const privateCount = privateField ? records.filter((record) => record.isPrivate).length : 0;
    const index: OntologyIndex = {
      generated_at_utc: generatedAt,
      schema_version: schemaVersion,
      index_type: `${filterValue}-index`,
      node_type: filterValue,
      relationship_heading: relationshipHeading,
      filter_field: settings.exportFilterField,
      filter_value: filterValue,
      total_notes: items.length,
      total_private_notes: privateCount,
      items,
    };
    const base = normalisePath(`${exportsFolder}/${filterValue}-index`);

    artifacts.push({
      filterValue,
      jsonPath: `${base}.json`,
      markdownPath: `${base}.md`,
      index,
      json: JSON.stringify(index, null, 2),
      markdown: buildOntologyNote(index, today, domainLabel, statusLabel),
    });
  }

  return artifacts;
}

export function getInventoryRecordField(record: InventoryRecord, field: string): string {
  switch (field) {
    case "type":
      return record.type;
    case "status":
      return record.status;
    case "domain":
      return record.domain;
    case "tags":
      return record.tags;
    default:
      return record.fields[field] ?? "";
  }
}

export function extractRelationships(body: string, parentHeading: string): OntologyRelationships {
  const relationships: OntologyRelationships = {};
  const parentMatch = new RegExp(`^(#{1,6})\\s+${escapeRegex(parentHeading)}\\s*$`, "m").exec(body);
  if (!parentMatch) return relationships;

  const parentLevel = parentMatch[1].length;
  const lines = body.slice(parentMatch.index + parentMatch[0].length).split(/\r?\n/u);
  let currentKey: string | null = null;

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/u);
    if (heading) {
      if (heading[1].length <= parentLevel) break;
      currentKey = heading[2].trim();
      if (!relationships[currentKey]) relationships[currentKey] = [];
    } else if (currentKey) {
      relationships[currentKey].push(...wikilinkTargets(line));
    }
  }

  return relationships;
}

export function extractAllWikilinks(body: string): string[] {
  const seen = new Set<string>();
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) seen.add(match[1].trim());
  return [...seen].sort();
}

export function buildOntologyNote(
  index: OntologyIndex,
  today = todayString(),
  domainLabel = "domain",
  statusLabel = "status"
): string {
  const relationshipKeys = new Set<string>();
  for (const node of index.items) Object.keys(node.relationships).forEach((key) => relationshipKeys.add(key));

  return [
    "---",
    "type: reference",
    "status: complete",
    "tags:",
    "  - meta/vault-export",
    `created: ${today}`,
    `updated: ${today}`,
    "ai_private: false",
    "review_cycle: never",
    "---",
    "",
    `schema_version:: "${index.schema_version}"`,
    `generated:: ${index.generated_at_utc}`,
    `node_type:: ${index.node_type}`,
    `total_notes:: ${index.total_notes}`,
    `total_private_notes:: ${index.total_private_notes}`,
    `relationship_heading:: ${index.relationship_heading}`,
    "",
    `> Generated ${index.generated_at_utc} — ${index.total_notes} notes.`,
    `> Relationship heading: \`# ${index.relationship_heading}\``,
    `> Machine-readable data: \`${index.node_type}-index.json\``,
    "",
    "# Relationship Keys Observed",
    "",
    relationshipKeys.size > 0
      ? [...relationshipKeys].sort().map((key) => `- ${key}`).join("\n")
      : "_No relationship sections found._",
    "",
    "# Notes",
    "",
    `| Name | ${statusLabel} | ${domainLabel} | Relationships |`,
    "|------|--------|--------|---------------|",
    ...index.items.map((node) => {
      const linkCount = Object.values(node.relationships).reduce((sum, links) => sum + links.length, 0);
      return `| [[${node.path}\\|${node.name}]] | ${node.status || "—"} | ${node.domain} | ${linkCount} |`;
    }),
    "",
  ].join("\n");
}

function buildOntologyNode(
  record: InventoryRecord,
  document: ForgeDocument | undefined,
  relationshipHeading: string
): OntologyNode | null {
  if (!document) return null;
  const split = splitFrontmatter(document.content);
  const body = split?.body ?? document.content;

  return {
    name: getFmString(document.frontmatter, "title") || document.basename,
    type: record.type,
    path: record.path,
    domain: record.domain,
    status: record.status,
    tags: record.tags,
    relationships: extractRelationships(body, relationshipHeading),
    outbound_links: extractAllWikilinks(body),
    modified_utc: document.stat?.mtime ? new Date(document.stat.mtime).toISOString() : "",
  };
}

function frontmatterStringMap(frontmatter: Record<string, unknown>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const key of Object.keys(frontmatter).sort()) {
    const value = getFmString(frontmatter, key);
    if (value) fields[key] = value;
  }
  return fields;
}

function domainFromPath(path: string): string {
  const parts = normalisePath(path).split("/");
  return parts.length > 1 ? parts[0] : "(root)";
}

function countBy(items: InventoryRecord[], key: keyof Pick<InventoryRecord, "domain" | "type" | "status">): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = String(item[key] || "");
    if (!value) continue;
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function tableRows(counts: Record<string, number>, column: string): string[] {
  return [
    `| ${column} | Count |`,
    "|--------|-------|",
    ...Object.entries(counts)
      .sort((left, right) => right[1] - left[1])
      .map(([key, value]) => `| ${key} | ${value} |`),
  ];
}

function filterInventoryRecords(records: InventoryRecord[], excludeFolders: string[]): InventoryRecord[] {
  if (excludeFolders.length === 0) return records;

  return records.filter((record) => {
    const recordPath = normalisePath(record.path);
    return !excludeFolders.some((folder) => {
      const excluded = normalisePath(folder);
      return recordPath === excluded || recordPath.startsWith(`${excluded}/`);
    });
  });
}

function groupInventoryRecordsByFilterValue(
  records: InventoryRecord[],
  filterField: string,
  filterValues: string[]
): Map<string, InventoryRecord[]> {
  const groups = new Map<string, InventoryRecord[]>();

  for (const record of records) {
    const raw = getInventoryRecordField(record, filterField);
    if (!raw) continue;
    for (const value of raw.split(";").map((part) => part.trim()).filter(Boolean)) {
      if (!filterValues.includes(value)) continue;
      const existing = groups.get(value) ?? [];
      existing.push(record);
      groups.set(value, existing);
    }
  }

  return groups;
}

function wikilinkTargets(line: string): string[] {
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const targets: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) targets.push(match[1].trim());
  return targets;
}

function escapeRegex(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
