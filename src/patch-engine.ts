// src/patch-engine.ts
// Forge patch engine.
//
// Port of Invoke-VaultPatch.ps1 — reads a vault-patch.md or legacy YAML file,
// resolves target files, and applies each operation.
//
// Operations supported:
//   set_field       — add or overwrite a frontmatter field
//   remove_field    — remove a frontmatter field
//   add_tag         — append a tag if not present
//   remove_tag      — remove a tag if present
//   replace_tag     — atomic remove + add
//   normalize_tags  — sort and deduplicate tags
//   compute_field   — derive field from file metadata
//   sort_frontmatter — reorder fields into canonical order
//   move_note       — move notes to a new location
//
// Each operation returns a PatchOpResult.
// The engine collects all results and returns a PatchRunResult
// which the command uses to write the report and manifest.

import { App, TFile, normalizePath, parseYaml } from "obsidian";
import type { ForgeSettings } from "./settings";
import {
  readNote,
  writeNote,
  sortFrontmatterFields,
  isFieldPresent,
} from "./utils/frontmatter";
import {
  getTags,
  setTags,
  normalizeTags,
  addTag,
  removeTag,
} from "./utils/tags";
import {
  resolveTargets,
  ensureFolder,
  localTimestamp,
  safeTimestamp,
  todayString,
} from "./utils/files";
import { serializeYaml, trimTrailingWhitespace } from "./utils/yaml";

function formatPatchValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

// ── Types ────────────────────────────────────────────────────────────────────

export type PatchOpStatus = "changed" | "skipped" | "error";

export interface PatchOpResult {
  op: string;
  file: string;
  status: PatchOpStatus;
  detail: string;
  change?: PatchOperationChange;
}

export interface PatchManifestEntry {
  file: string;
  backup: string;
}

export type PatchRestoreTarget =
  | { kind: "frontmatter_field"; field: string }
  | { kind: "frontmatter_tags" }
  | { kind: "frontmatter_order" }
  | { kind: "note_move" };

export type PatchRestoreValue =
  | { exists: true; value: unknown }
  | { exists: false };

export type PatchReverseAction =
  | { kind: "set_field"; field: string; value?: unknown; delete_if_missing_before: boolean }
  | { kind: "set_tags"; value: string[] }
  | { kind: "set_frontmatter_order"; keys: string[] }
  | { kind: "move_note"; from: string; to: string };

export interface PatchOperationChange {
  id: string;
  op_index: number;
  op: string;
  file_before: string;
  file_after: string;
  status: "changed";
  label: string;
  target: PatchRestoreTarget;
  before: PatchRestoreValue;
  after: PatchRestoreValue;
  reverse: PatchReverseAction;
  backup?: string;
}

export interface PatchRunResult {
  runId: string;
  patchFile: string;
  description: string;
  appliedAt: string;
  schemaVersion: string;
  dryRun: boolean;
  results: PatchOpResult[];
  manifest: PatchManifestEntry[];
  operations: PatchOperationChange[];
}

export interface PatchMeta {
  generated_at?: string;
  description?: string;
  schema_version?: string;
  source?: string;
  contains_schema_changes?: boolean;
}

export interface PatchOperation {
  op: string;
  target?: string;
  target_pattern?: string;
  field?: string;
  value?: unknown;
  value_from?: string;
  path_segment_index?: number;
  trim_prefix?: string;
  trim_suffix?: string;
  lowercase?: boolean;
  uppercase?: boolean;
  only_if_missing?: boolean;
  when?: { field: string; equals: string };
  tag?: string;
  old_tag?: string;
  new_tag?: string;
  strategy?: string;
  format?: string;
  when_missing?: boolean;
  days?: number;
  value_if_true?: string;
  skip_if?: string[];
  source?: string;
  destination?: string;
  frontmatter?: Record<string, unknown>;
  source_root?: string;
  destination_folder?: string;
  strip_frontmatter?: boolean;
}

export interface PatchFile {
  meta: PatchMeta;
  operations: PatchOperation[];
}

// ── Main engine ──────────────────────────────────────────────────────────────

/**
 * Reads and parses a patch file.
 * Preferred format:
 *   - Markdown note containing a fenced YAML block
 *
 * Legacy format:
 *   - Raw .yaml / .yml file
 *
 * Returns null if the file cannot be found or parsed.
 */
export async function loadPatchFile(
  app: App,
  patchFilePath: string
): Promise<PatchFile | null> {
  const file = app.vault.getAbstractFileByPath(normalizePath(patchFilePath));

  if (!(file instanceof TFile)) {
    return null;
  }

  let raw: string;

  try {
    raw = await app.vault.read(file);
  } catch (e) {
    console.warn(`[Forge] Could not read patch file: ${patchFilePath}`, e);
    return null;
  }

  try {
    const yamlText = extractPatchYaml(raw, patchFilePath);

    if (!yamlText.trim()) {
      console.warn(`[Forge] Patch file contains no YAML payload: ${patchFilePath}`);
      return null;
    }

    const parsed = parseYaml(yamlText) as Record<string, unknown>;

    const meta = (parsed?.meta ?? {}) as PatchMeta;

    const operations = Array.isArray(parsed?.operations)
      ? (parsed.operations as PatchOperation[])
      : [];

    return { meta, operations };
  } catch (e) {
    console.warn(`[Forge] Could not parse patch YAML:`, e);
    return null;
  }
}

/**
 * Applies a patch file to the vault.
 * If dryRun is true, no files are modified — results show what would change.
 *
 * Port of the main operation loop in Invoke-VaultPatch.ps1.
 */
export async function applyPatch(
  app: App,
  settings: ForgeSettings,
  patchFile: PatchFile,
  patchFilePath: string,
  dryRun: boolean
): Promise<PatchRunResult> {
  const runId = safeTimestamp();
  const appliedAt = localTimestamp();
  const results: PatchOpResult[] = [];
  const manifest: PatchManifestEntry[] = [];
  const operations: PatchOperationChange[] = [];
  let operationSeq = 0;

  // ── Process each operation ───────────────────────────────────────
  for (let opIndex = 0; opIndex < patchFile.operations.length; opIndex++) {
    const op = patchFile.operations[opIndex];
    const opName = op.op ?? "<unknown>";

    // Resolve target files
    const targets = resolveTargets(app, op.target, op.target_pattern);

    if (targets.length === 0) {
      results.push({
        op: opName,
        file: op.target ?? op.target_pattern ?? "<no target>",
        status: "error",
        detail: "No matching files found",
      });
      continue;
    }

    // Apply operation to each target
    for (const file of targets) {
      let result: PatchOpResult;

      switch (opName) {
        case "set_field":
          result = await applySetField(app, op, file, dryRun, settings.frontmatterFieldOrder);
          break;
        case "remove_field":
          result = await applyRemoveField(app, op, file, dryRun, settings.frontmatterFieldOrder);
          break;
        case "add_tag":
          result = await applyAddTag(app, op, file, dryRun, settings.frontmatterFieldOrder);
          break;
        case "remove_tag":
          result = await applyRemoveTag(app, op, file, dryRun, settings.frontmatterFieldOrder);
          break;
        case "replace_tag":
          result = await applyReplaceTagOp(app, op, file, dryRun, settings.frontmatterFieldOrder);
          break;
        case "normalize_tags":
          result = await applyNormalizeTags(app, op, file, dryRun, settings.frontmatterFieldOrder);
          break;
        case "compute_field":
          result = await applyComputeField(app, op, file, dryRun, settings.frontmatterFieldOrder);
          break;
        case "sort_frontmatter":
          result = await applySortFrontmatter(app, op, file, dryRun, settings.frontmatterFieldOrder);
          break;
        case "move_note":
          result = await applyMoveNote(app, op, file, settings, dryRun);
          break;
        default:
          result = {
            op: opName,
            file: file.path,
            status: "error",
            detail: `Unknown operation: '${opName}'`,
          };
      }

      if (result.status === "changed") {
        if (result.change) {
          operationSeq++;
          result.change.id = makeOperationId(operationSeq);
          result.change.op_index = opIndex;
          operations.push(result.change);
        }
      }

      results.push(result);
    }
  }

  return {
    runId,
    patchFile: patchFilePath,
    description: patchFile.meta.description ?? "",
    appliedAt,
    schemaVersion: patchFile.meta.schema_version ?? "",
    dryRun,
    results,
    manifest,
    operations,
  };
}

// ── Operation handlers ───────────────────────────────────────────────────────

async function applySetField(
  app: App,
  op: PatchOperation,
  file: TFile,
  dryRun: boolean,
  fieldOrder: string[]
): Promise<PatchOpResult> {
  const fieldName = op.field;
  if (!fieldName) {
    return opError("set_field", file, "Missing field name");
  }

  const note = await readNote(app, file);
  if (!note) return opError("set_field", file, "Could not read file");

  const fm = note.frontmatter;
  const currentValue = fm[fieldName];
  const onlyIfMissing = op.only_if_missing ?? false;

  if (onlyIfMissing && isFieldPresent(fm, fieldName)) {
    return opSkipped("set_field", file, `Field '${fieldName}' already has a value`);
  }

  // when condition — skip unless field equals expected value
  if (op.when) {
    const whenVal = fm[op.when.field];
    const whenCurrent = whenVal === undefined ? "" : formatPatchValue(whenVal);
    if (whenCurrent !== op.when.equals) {
      return opSkipped("set_field", file, `Condition not met: '${op.when.field}' is '${whenCurrent}', expected '${op.when.equals}'`);
    }
  }

  // Resolve the new value
  let newValue: unknown;
  try {
    newValue = resolveFieldValue(op, file);
  } catch (e) {
    return opError("set_field", file, String(e));
  }

  // Compare current vs new
  const currentStr = currentValue === undefined ? "<missing>" : JSON.stringify(currentValue);
  const newStr = JSON.stringify(newValue);

  if (currentStr === newStr) {
    return opSkipped("set_field", file, `Field '${fieldName}' already = ${newStr}`);
  }

  if (!dryRun) {
    fm[fieldName] = newValue;
    await writeNote(app, note, fieldOrder);
  }

  return opChanged(
    "set_field",
    file,
    `Set '${fieldName}': ${currentStr} → ${newStr}`,
    fieldChange("set_field", file.path, file.path, fieldName, currentValue, newValue)
  );
}

async function applyRemoveField(
  app: App,
  op: PatchOperation,
  file: TFile,
  dryRun: boolean,
  fieldOrder: string[]
): Promise<PatchOpResult> {
  const fieldName = op.field;
  if (!fieldName) return opError("remove_field", file, "Missing field name");

  const note = await readNote(app, file);
  if (!note) return opError("remove_field", file, "Could not read file");

  if (!isFieldPresent(note.frontmatter, fieldName)) {
    return opSkipped("remove_field", file, `Field '${fieldName}' not present`);
  }

  const beforeValue = note.frontmatter[fieldName];

  if (!dryRun) {
    delete note.frontmatter[fieldName];
    await writeNote(app, note, fieldOrder);
  }

  return opChanged(
    "remove_field",
    file,
    `Removed field '${fieldName}'`,
    fieldChange("remove_field", file.path, file.path, fieldName, beforeValue, undefined)
  );
}

async function applyAddTag(
  app: App,
  op: PatchOperation,
  file: TFile,
  dryRun: boolean,
  fieldOrder: string[]
): Promise<PatchOpResult> {
  const tag = op.tag;
  if (!tag) return opError("add_tag", file, "Missing tag");

  const note = await readNote(app, file);
  if (!note) return opError("add_tag", file, "Could not read file");

  const current = getTags(note.frontmatter);
  const updated = addTag(current, tag);

  if (updated === current) {
    return opSkipped("add_tag", file, `Tag '${tag}' already present`);
  }

  if (!dryRun) {
    setTags(note.frontmatter, updated);
    await writeNote(app, note, fieldOrder);
  }

  return opChanged(
    "add_tag",
    file,
    `Added tag '${tag}'`,
    tagsChange("add_tag", file.path, file.path, current, normalizeTags(updated), `Add tag '${tag}'`)
  );
}

async function applyRemoveTag(
  app: App,
  op: PatchOperation,
  file: TFile,
  dryRun: boolean,
  fieldOrder: string[]
): Promise<PatchOpResult> {
  const tag = op.tag;
  if (!tag) return opError("remove_tag", file, "Missing tag");

  const note = await readNote(app, file);
  if (!note) return opError("remove_tag", file, "Could not read file");

  const current = getTags(note.frontmatter);
  const updated = removeTag(current, tag);

  if (updated === current) {
    return opSkipped("remove_tag", file, `Tag '${tag}' not present`);
  }

  if (!dryRun) {
    setTags(note.frontmatter, updated);
    await writeNote(app, note, fieldOrder);
  }

  return opChanged(
    "remove_tag",
    file,
    `Removed tag '${tag}'`,
    tagsChange("remove_tag", file.path, file.path, current, normalizeTags(updated), `Remove tag '${tag}'`)
  );
}

async function applyReplaceTagOp(
  app: App,
  op: PatchOperation,
  file: TFile,
  dryRun: boolean,
  fieldOrder: string[]
): Promise<PatchOpResult> {
  const oldTag = op.old_tag;
  const newTagVal = op.new_tag;
  if (!oldTag || !newTagVal) {
    return opError("replace_tag", file, "Missing old_tag or new_tag");
  }

  const note = await readNote(app, file);
  if (!note) return opError("replace_tag", file, "Could not read file");

  const current = getTags(note.frontmatter);
  const hasOld = current.some((t) => t.toLowerCase() === oldTag.toLowerCase());

  if (!hasOld) {
    return opSkipped("replace_tag", file, `Tag '${oldTag}' not present`);
  }

  const hasNew = current.some((t) => t.toLowerCase() === newTagVal.toLowerCase());
  if (hasNew) {
    return opSkipped("replace_tag", file, `Tag '${newTagVal}' already present`);
  }

  const updated = current.map((t) =>
    t.toLowerCase() === oldTag.toLowerCase() ? newTagVal : t
  );

  if (!dryRun) {
    setTags(note.frontmatter, updated);
    await writeNote(app, note, fieldOrder);
  }

  return opChanged(
    "replace_tag",
    file,
    `Replaced tag '${oldTag}' → '${newTagVal}'`,
    tagsChange("replace_tag", file.path, file.path, current, normalizeTags(updated), `Replace tag '${oldTag}'`)
  );
}

async function applyNormalizeTags(
  app: App,
  op: PatchOperation,
  file: TFile,
  dryRun: boolean,
  fieldOrder: string[]
): Promise<PatchOpResult> {
  const note = await readNote(app, file);
  if (!note) return opError("normalize_tags", file, "Could not read file");

  const current = getTags(note.frontmatter);
  const normalized = normalizeTags(current);

  const currentStr = current.join("|");
  const normalizedStr = normalized.join("|");

  if (currentStr === normalizedStr) {
    return opSkipped("normalize_tags", file, "Tags already normalized");
  }

  if (!dryRun) {
    setTags(note.frontmatter, normalized);
    await writeNote(app, note, fieldOrder);
  }

  return opChanged(
    "normalize_tags",
    file,
    "Normalized tags",
    tagsChange("normalize_tags", file.path, file.path, current, normalized, "Normalize tags")
  );
}

async function applyComputeField(
  app: App,
  op: PatchOperation,
  file: TFile,
  dryRun: boolean,
  fieldOrder: string[]
): Promise<PatchOpResult> {
  const fieldName = op.field;
  const strategy = op.strategy;

  if (!fieldName) return opError("compute_field", file, "Missing field name");
  if (!strategy) return opError("compute_field", file, "Missing strategy");

  const note = await readNote(app, file);
  if (!note) return opError("compute_field", file, "Could not read file");

  const fm = note.frontmatter;
  const beforeValue = fm[fieldName];
  const whenMissing = op.when_missing ?? false;

  if (whenMissing && isFieldPresent(fm, fieldName)) {
    return opSkipped("compute_field", file, `Field '${fieldName}' already has a value`);
  }

  const format = op.format ?? "yyyy-MM-dd";
  let newValue: string;

  try {
    switch (strategy) {
      case "file_created_time": {
        // Obsidian TFile has stat.ctime in ms
        newValue = formatDate(new Date(file.stat.ctime), format);
        break;
      }
      case "file_modified_time": {
        newValue = formatDate(new Date(file.stat.mtime), format);
        break;
      }
      case "recent_activity": {
        const days = op.days ?? 30;
        const valueIfTrue = op.value_if_true;
        if (!valueIfTrue) {
          return opError("compute_field", file, "recent_activity requires value_if_true");
        }

        const skipIf = op.skip_if ?? [];
        const currentVal = formatPatchValue(fm[fieldName]).trim();
        if (skipIf.includes(currentVal)) {
          return opSkipped("compute_field", file, `Field '${fieldName}' is '${currentVal}' — excluded by skip_if`);
        }

        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        if (file.stat.mtime >= cutoff) {
          newValue = valueIfTrue;
        } else {
          return opSkipped("compute_field", file, `File not modified in last ${days} days`);
        }
        break;
      }
      default:
        return opError("compute_field", file, `Unsupported strategy '${strategy}'`);
    }
  } catch (e) {
    return opError("compute_field", file, String(e));
  }

  const currentVal = fm[fieldName] !== undefined ? formatPatchValue(fm[fieldName]) : "<missing>";
  if (currentVal === newValue) {
    return opSkipped("compute_field", file, `Field '${fieldName}' already = '${newValue}'`);
  }

  if (!dryRun) {
    fm[fieldName] = newValue;
    await writeNote(app, note, fieldOrder);
  }

  return opChanged(
    "compute_field",
    file,
    `Computed '${fieldName}': '${currentVal}' → '${newValue}'`,
    fieldChange("compute_field", file.path, file.path, fieldName, beforeValue, newValue)
  );
}

async function applySortFrontmatter(
  app: App,
  op: PatchOperation,
  file: TFile,
  dryRun: boolean,
  fieldOrder: string[]
): Promise<PatchOpResult> {
  const note = await readNote(app, file);
  if (!note) return opError("sort_frontmatter", file, "Could not read file");

  if (!note.hasFrontmatter) {
    return opSkipped("sort_frontmatter", file, "No frontmatter found");
  }

  const sorted = sortFrontmatterFields(note.frontmatter, fieldOrder);
  const beforeKeys = Object.keys(note.frontmatter);
  const afterKeys = Object.keys(sorted);
  const originalKeys = beforeKeys.join(",");
  const sortedKeys = afterKeys.join(",");

  if (originalKeys === sortedKeys) {
    return opSkipped("sort_frontmatter", file, "Frontmatter already in correct order");
  }

  if (!dryRun) {
    note.frontmatter = sorted;
    await writeNote(app, note, fieldOrder);
  }

  return opChanged(
    "sort_frontmatter",
    file,
    "Sorted frontmatter fields",
    frontmatterOrderChange(file.path, beforeKeys, afterKeys)
  );
}

async function applyMoveNote(
  app: App,
  op: PatchOperation,
  file: TFile,
  settings: ForgeSettings,
  dryRun: boolean
): Promise<PatchOpResult> {
  const destinationFolder = op.destination_folder;
  const sourceRoot = op.source_root;

  if (!destinationFolder) return opError("move_note", file, "Missing destination_folder");
  if (!sourceRoot) return opError("move_note", file, "Missing source_root");

  // Validate strip_frontmatter and frontmatter are not both set
  if (op.strip_frontmatter && op.frontmatter) {
    return opError("move_note", file, "Cannot use both strip_frontmatter and frontmatter");
  }

  const normalizedSourceRoot = normalizePath(sourceRoot).toLowerCase();
  const filePath = normalizePath(file.path);

  if (!filePath.toLowerCase().startsWith(normalizedSourceRoot + "/")) {
    return opError("move_note", file, `File is not under source_root '${sourceRoot}'`);
  }

  const relativeUnderSource = file.path.substring(sourceRoot.length).replace(/^\//, "");
  const destPath = normalizePath(`${destinationFolder}/${relativeUnderSource}`);

  if (filePath === destPath.toLowerCase()) {
    return opSkipped("move_note", file, "Already in correct location");
  }

  const existing = app.vault.getAbstractFileByPath(destPath);
  if (existing) {
    return opError("move_note", file, `Destination already exists: ${destPath}`);
  }

  if (!dryRun) {
    await ensureFolder(app, normalizePath(destPath.substring(0, destPath.lastIndexOf("/"))));

    // Handle frontmatter changes before moving
    if (op.strip_frontmatter || op.frontmatter) {
      const note = await readNote(app, file);
      let content = await app.vault.read(file);

      if (op.strip_frontmatter) {
        // Strip frontmatter entirely — keep body only
        const bodyMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
        content = bodyMatch ? bodyMatch[1] : content;
      } else if (op.frontmatter && note) {
        // Merge — op.frontmatter wins on conflicts, existing fields survive
        const merged = { ...note.frontmatter, ...op.frontmatter };
        const sorted = sortFrontmatterFields(merged, settings.frontmatterFieldOrder);
        const yamlStr = trimTrailingWhitespace(serializeYaml(sorted));
        const bodyMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
        const body = bodyMatch ? bodyMatch[1] : content;
        content = `---\n${yamlStr}\n---\n${body}`;
      }

      await app.vault.create(destPath, content);
      await app.fileManager.trashFile(file);
    } else {
      await app.vault.rename(file, destPath);
    }
  }

  return opChanged(
    "move_note",
    file,
    `Moved → ${destPath}`,
    op.strip_frontmatter || op.frontmatter ? undefined : moveNoteChange(file.path, destPath)
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractPatchYaml(raw: string, patchFilePath: string): string {
  const lowerPath = patchFilePath.toLowerCase();

  if (!lowerPath.endsWith(".md")) {
    return raw;
  }

  const match = raw.match(/```ya?ml\s*\r?\n([\s\S]*?)```/i);

  return match?.[1]?.trim() ?? "";
}

function resolveFieldValue(op: PatchOperation, file: TFile): unknown {
  const hasLiteralValue = "value" in op && op.value !== undefined;
  const valueFrom = op.value_from;

  if (hasLiteralValue && valueFrom) {
    throw new Error("Cannot specify both 'value' and 'value_from'");
  }

  if (!hasLiteralValue && !valueFrom) {
    throw new Error("set_field requires either 'value' or 'value_from'");
  }

  if (hasLiteralValue) return op.value;

  // Derive from file path/name
  const parts = normalizePath(file.path).split("/");
  const fileName = parts[parts.length - 1];
  const baseName = fileName.replace(/\.md$/, "");
  const folderName = parts.length >= 2 ? parts[parts.length - 2] : "";
  const parentFolder = parts.length >= 3 ? parts[parts.length - 3] : "";

  let value: string;
  switch (valueFrom) {
    case "filename":      value = fileName; break;
    case "basename":      value = baseName; break;
    case "folder":        value = folderName; break;
    case "parent_folder": value = parentFolder; break;
    case "path": {
      const idx = op.path_segment_index;
      if (idx === undefined) throw new Error("value_from: path requires path_segment_index");
      if (idx < 0 || idx >= parts.length) throw new Error(`path_segment_index ${idx} out of range`);
      value = parts[idx];
      break;
    }
    default:
      throw new Error(`Unsupported value_from '${valueFrom}'`);
  }

  // Apply transforms
  const trimPrefix = op.trim_prefix;
  if (trimPrefix && value.startsWith(trimPrefix)) {
    value = value.substring(trimPrefix.length);
  }

  const trimSuffix = op.trim_suffix;
  if (trimSuffix && value.endsWith(trimSuffix)) {
    value = value.substring(0, value.length - trimSuffix.length);
  }

  if (op.lowercase && op.uppercase) throw new Error("Cannot specify both lowercase and uppercase");
  if (op.lowercase) value = value.toLowerCase();
  if (op.uppercase) value = value.toUpperCase();

  return value;
}

function formatDate(date: Date, format: string): string {
  // Only yyyy-MM-dd is needed for vault use — extend if required
  if (format === "yyyy-MM-dd") {
    return todayString();
  }
  return todayString();
}

function opChanged(
  op: string,
  file: TFile,
  detail: string,
  change?: PatchOperationChange
): PatchOpResult {
  return { op, file: file.path, status: "changed", detail, change };
}

function opSkipped(op: string, file: TFile, detail: string): PatchOpResult {
  return { op, file: file.path, status: "skipped", detail };
}

function opError(op: string, file: TFile | string, detail: string): PatchOpResult {
  const filePath = typeof file === "string" ? file : file.path;
  return { op, file: filePath, status: "error", detail };
}

function makeOperationId(seq: number): string {
  return `op-${String(seq).padStart(5, "0")}`;
}

function restoreValue(value: unknown): PatchRestoreValue {
  return value === undefined
    ? { exists: false }
    : { exists: true, value: cloneValue(value) };
}

function cloneValue<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function fieldChange(
  op: string,
  fileBefore: string,
  fileAfter: string,
  field: string,
  before: unknown,
  after: unknown
): PatchOperationChange {
  return {
    id: "",
    op_index: -1,
    op,
    file_before: fileBefore,
    file_after: fileAfter,
    status: "changed",
    label: `${op} ${field}`,
    target: { kind: "frontmatter_field", field },
    before: restoreValue(before),
    after: restoreValue(after),
    reverse: {
      kind: "set_field",
      field,
      value: before === undefined ? undefined : cloneValue(before),
      delete_if_missing_before: before === undefined,
    },
  };
}

function tagsChange(
  op: string,
  fileBefore: string,
  fileAfter: string,
  before: string[],
  after: string[],
  label: string
): PatchOperationChange {
  return {
    id: "",
    op_index: -1,
    op,
    file_before: fileBefore,
    file_after: fileAfter,
    status: "changed",
    label,
    target: { kind: "frontmatter_tags" },
    before: restoreValue([...before]),
    after: restoreValue([...after]),
    reverse: { kind: "set_tags", value: [...before] },
  };
}

function frontmatterOrderChange(
  filePath: string,
  beforeKeys: string[],
  afterKeys: string[]
): PatchOperationChange {
  return {
    id: "",
    op_index: -1,
    op: "sort_frontmatter",
    file_before: filePath,
    file_after: filePath,
    status: "changed",
    label: "Sort frontmatter fields",
    target: { kind: "frontmatter_order" },
    before: restoreValue([...beforeKeys]),
    after: restoreValue([...afterKeys]),
    reverse: { kind: "set_frontmatter_order", keys: [...beforeKeys] },
  };
}

function moveNoteChange(fileBefore: string, fileAfter: string): PatchOperationChange {
  return {
    id: "",
    op_index: -1,
    op: "move_note",
    file_before: fileBefore,
    file_after: fileAfter,
    status: "changed",
    label: `Move note to ${fileAfter}`,
    target: { kind: "note_move" },
    before: restoreValue(fileBefore),
    after: restoreValue(fileAfter),
    reverse: { kind: "move_note", from: fileAfter, to: fileBefore },
  };
}
