// src/patch-engine.ts
// Vault Forge patch engine.
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
//   import_note     — move from System/Inbox, apply frontmatter
//   compute_field   — derive field from file metadata
//   sort_frontmatter — reorder fields into canonical order
//   move_note       — move notes to a new location
//
// Each operation returns a PatchOpResult.
// The engine collects all results and returns a PatchRunResult
// which the command uses to write the report and manifest.

import { App, TFile, normalizePath, parseYaml, stringifyYaml } from "obsidian";
import type { VaultForgeSettings } from "./settings";
import { getVaultPaths } from "./vault-paths";
import {
  readNote,
  writeNote,
  backupNote,
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
  safeTimestamp,
  todayString,
  getDomain,
} from "./utils/files";

// ── Types ────────────────────────────────────────────────────────────────────

export type PatchOpStatus = "changed" | "skipped" | "error";

export interface PatchOpResult {
  op: string;
  file: string;
  status: PatchOpStatus;
  detail: string;
}

export interface PatchManifestEntry {
  file: string;
  backup: string;
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
    console.warn(`[VaultForge] Could not read patch file: ${patchFilePath}`, e);
    return null;
  }

  try {
    const yamlText = extractPatchYaml(raw, patchFilePath);

    if (!yamlText.trim()) {
      console.warn(`[VaultForge] Patch file contains no YAML payload: ${patchFilePath}`);
      return null;
    }

    const parsed = parseYaml(yamlText) as Record<string, unknown>;

    const meta = (parsed?.meta ?? {}) as PatchMeta;

    const operations = Array.isArray(parsed?.operations)
      ? (parsed.operations as PatchOperation[])
      : [];

    return { meta, operations };
  } catch (e) {
    console.warn(`[VaultForge] Could not parse patch YAML:`, e);
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
  settings: VaultForgeSettings,
  patchFile: PatchFile,
  patchFilePath: string,
  dryRun: boolean
): Promise<PatchRunResult> {
  const paths = getVaultPaths(settings);
  const runId = safeTimestamp();
  const appliedAt = new Date().toISOString();
  const results: PatchOpResult[] = [];
  const manifest: PatchManifestEntry[] = [];

  // Track which files have been backed up this run to avoid duplicates
  const backedUp = new Set<string>();

  /**
   * Backs up a file once per patch run if backups are enabled.
   * Returns the backup path or null.
   */
  async function maybeBackup(file: TFile): Promise<string | null> {
    if (!settings.patchBackupEnabled || dryRun) return null;
    if (backedUp.has(file.path)) {
      // Already backed up this run — find the existing entry
      const existing = manifest.find((e) => e.file === file.path);
      return existing?.backup ?? null;
    }

    const backupPath = await backupNote(app, file, paths.patchBackups);
    if (backupPath) {
      backedUp.add(file.path);
      manifest.push({ file: file.path, backup: backupPath });
    }
    return backupPath;
  }

  // ── Process each operation ───────────────────────────────────────
  for (const op of patchFile.operations) {
    const opName = op.op ?? "<unknown>";

    // import_note is vault-level, not file-level
    if (opName === "import_note") {
      const result = await applyImportNote(app, op, settings, dryRun);
      results.push(result);
      continue;
    }

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
          result = await applySetField(app, op, file, dryRun);
          break;
        case "remove_field":
          result = await applyRemoveField(app, op, file, dryRun);
          break;
        case "add_tag":
          result = await applyAddTag(app, op, file, dryRun);
          break;
        case "remove_tag":
          result = await applyRemoveTag(app, op, file, dryRun);
          break;
        case "replace_tag":
          result = await applyReplaceTagOp(app, op, file, dryRun);
          break;
        case "normalize_tags":
          result = await applyNormalizeTags(app, op, file, dryRun);
          break;
        case "compute_field":
          result = await applyComputeField(app, op, file, dryRun);
          break;
        case "sort_frontmatter":
          result = await applySortFrontmatter(app, op, file, dryRun);
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

      // Back up changed files
      if (result.status === "changed") {
        await maybeBackup(file);
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
  };
}

// ── Operation handlers ───────────────────────────────────────────────────────

async function applySetField(
  app: App,
  op: PatchOperation,
  file: TFile,
  dryRun: boolean
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
    await writeNote(app, note);
  }

  return opChanged("set_field", file, `Set '${fieldName}': ${currentStr} → ${newStr}`);
}

async function applyRemoveField(
  app: App,
  op: PatchOperation,
  file: TFile,
  dryRun: boolean
): Promise<PatchOpResult> {
  const fieldName = op.field;
  if (!fieldName) return opError("remove_field", file, "Missing field name");

  const note = await readNote(app, file);
  if (!note) return opError("remove_field", file, "Could not read file");

  if (!isFieldPresent(note.frontmatter, fieldName)) {
    return opSkipped("remove_field", file, `Field '${fieldName}' not present`);
  }

  if (!dryRun) {
    delete note.frontmatter[fieldName];
    await writeNote(app, note);
  }

  return opChanged("remove_field", file, `Removed field '${fieldName}'`);
}

async function applyAddTag(
  app: App,
  op: PatchOperation,
  file: TFile,
  dryRun: boolean
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
    await writeNote(app, note);
  }

  return opChanged("add_tag", file, `Added tag '${tag}'`);
}

async function applyRemoveTag(
  app: App,
  op: PatchOperation,
  file: TFile,
  dryRun: boolean
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
    await writeNote(app, note);
  }

  return opChanged("remove_tag", file, `Removed tag '${tag}'`);
}

async function applyReplaceTagOp(
  app: App,
  op: PatchOperation,
  file: TFile,
  dryRun: boolean
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
    await writeNote(app, note);
  }

  return opChanged("replace_tag", file, `Replaced tag '${oldTag}' → '${newTagVal}'`);
}

async function applyNormalizeTags(
  app: App,
  op: PatchOperation,
  file: TFile,
  dryRun: boolean
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
    await writeNote(app, note);
  }

  return opChanged("normalize_tags", file, "Normalized tags");
}

async function applyComputeField(
  app: App,
  op: PatchOperation,
  file: TFile,
  dryRun: boolean
): Promise<PatchOpResult> {
  const fieldName = op.field;
  const strategy = op.strategy;

  if (!fieldName) return opError("compute_field", file, "Missing field name");
  if (!strategy) return opError("compute_field", file, "Missing strategy");

  const note = await readNote(app, file);
  if (!note) return opError("compute_field", file, "Could not read file");

  const fm = note.frontmatter;
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
        const currentVal = fm[fieldName] ? String(fm[fieldName]).trim() : "";
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

  const currentVal = fm[fieldName] !== undefined ? String(fm[fieldName]) : "<missing>";
  if (currentVal === newValue) {
    return opSkipped("compute_field", file, `Field '${fieldName}' already = '${newValue}'`);
  }

  if (!dryRun) {
    fm[fieldName] = newValue;
    await writeNote(app, note);
  }

  return opChanged("compute_field", file, `Computed '${fieldName}': '${currentVal}' → '${newValue}'`);
}

async function applySortFrontmatter(
  app: App,
  op: PatchOperation,
  file: TFile,
  dryRun: boolean
): Promise<PatchOpResult> {
  const note = await readNote(app, file);
  if (!note) return opError("sort_frontmatter", file, "Could not read file");

  if (!note.hasFrontmatter) {
    return opSkipped("sort_frontmatter", file, "No frontmatter found");
  }

  const sorted = sortFrontmatterFields(note.frontmatter);
  const originalKeys = Object.keys(note.frontmatter).join(",");
  const sortedKeys = Object.keys(sorted).join(",");

  if (originalKeys === sortedKeys) {
    return opSkipped("sort_frontmatter", file, "Frontmatter already in correct order");
  }

  if (!dryRun) {
    note.frontmatter = sorted;
    await writeNote(app, note);
  }

  return opChanged("sort_frontmatter", file, "Sorted frontmatter fields");
}

async function applyMoveNote(
  app: App,
  op: PatchOperation,
  file: TFile,
  settings: VaultForgeSettings,
  dryRun: boolean
): Promise<PatchOpResult> {
  const destinationFolder = op.destination_folder;
  const sourceRoot = op.source_root;

  if (!destinationFolder) return opError("move_note", file, "Missing destination_folder");
  if (!sourceRoot) return opError("move_note", file, "Missing source_root");

  const normalizedSourceRoot = normalizePath(sourceRoot).toLowerCase();
  const filePath = normalizePath(file.path);

  // Skip system files
  if (filePath.toLowerCase().startsWith("system/")) {
    return opSkipped("move_note", file, "System file — skipped");
  }

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
    await app.vault.rename(file, destPath);
  }

  return opChanged("move_note", file, `Moved → ${destPath}`);
}

async function applyImportNote(
  app: App,
  op: PatchOperation,
  settings: VaultForgeSettings,
  dryRun: boolean
): Promise<PatchOpResult> {
  const paths = getVaultPaths(settings);
  const destination = op.destination;

  if (!destination) {
    return {
      op: "import_note",
      file: "<unknown>",
      status: "error",
      detail: "import_note requires destination",
    };
  }

  const sourceName = op.source ?? destination.split("/").pop() ?? "";
  const inboxPath = normalizePath(`${paths.inbox}/${sourceName}`);
  const destPath = normalizePath(destination);

  const sourceFile = app.vault.getAbstractFileByPath(inboxPath);
  if (!(sourceFile instanceof TFile)) {
    return {
      op: "import_note",
      file: destPath,
      status: "error",
      detail: `Source not found in Inbox: ${inboxPath}`,
    };
  }

  if (app.vault.getAbstractFileByPath(destPath)) {
    return {
      op: "import_note",
      file: destPath,
      status: "skipped",
      detail: `Destination already exists: ${destPath}`,
    };
  }

  if (!dryRun) {
    await ensureFolder(
      app,
      normalizePath(destPath.substring(0, destPath.lastIndexOf("/")))
    );

    // Build frontmatter from op.frontmatter
    const fm: Record<string, unknown> = {};
    if (op.frontmatter) {
      Object.assign(fm, op.frontmatter);
    }

    // Get body — strip frontmatter if source has it
    let body = await app.vault.read(sourceFile);
    const fmMatch = body.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
    if (fmMatch) body = fmMatch[1];

    const sorted = sortFrontmatterFields(fm);
    const yamlStr = stringifyYaml(sorted).trimEnd();
    const finalContent = Object.keys(sorted).length > 0
      ? `---\n${yamlStr}\n---\n${body}`
      : body;

    await app.vault.create(destPath, finalContent);
    await app.vault.delete(sourceFile);
  }

  return {
    op: "import_note",
    file: destPath,
    status: "changed",
    detail: `Imported from Inbox → ${destPath}`,
  };
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
    return date.toISOString().substring(0, 10);
  }
  return date.toISOString().substring(0, 10);
}

function opChanged(op: string, file: TFile, detail: string): PatchOpResult {
  return { op, file: file.path, status: "changed", detail };
}

function opSkipped(op: string, file: TFile, detail: string): PatchOpResult {
  return { op, file: file.path, status: "skipped", detail };
}

function opError(op: string, file: TFile | string, detail: string): PatchOpResult {
  const filePath = typeof file === "string" ? file : file.path;
  return { op, file: filePath, status: "error", detail };
}
