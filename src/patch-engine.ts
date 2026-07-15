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
import {
  parsePatchFile,
  type PatchFile,
  type PatchManifestEntry,
  type PatchOperation,
  type PatchOperationChange,
  type PatchOpResult,
  type PatchRestoreValue,
  type PatchRunResult,
} from "@forge/core";
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
  matchesGlob,
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

export type {
  PatchFile,
  PatchManifestEntry,
  PatchMeta,
  PatchOperation,
  PatchOperationChange,
  PatchOpResult,
  PatchOpStatus,
  PatchRestoreTarget,
  PatchRestoreValue,
  PatchReverseAction,
  PatchRunResult,
  PatchScope,
} from "@forge/core";

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

  const patchFile = parsePatchFile(raw, patchFilePath, parseYaml);
  if (!patchFile) console.warn(`[Forge] Could not parse patch YAML: ${patchFilePath}`);
  return patchFile;
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

    let scopedTargetCount = 0;

    // Apply operation to each target
    for (const file of targets) {
      let result: PatchOpResult;
      const scopeResult = await evaluatePatchScope(app, op, file, opName);

      if (scopeResult) {
        results.push(scopeResult);
        continue;
      }

      if (op.scope?.limit !== undefined) {
        if (op.scope.limit < 1) {
          results.push(opError(opName, file, "Scope limit must be greater than 0"));
          continue;
        }
        if (scopedTargetCount >= op.scope.limit) {
          results.push(opSkipped(opName, file, `Scope limit reached: ${op.scope.limit}`));
          continue;
        }
      }

      scopedTargetCount++;

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

async function evaluatePatchScope(
  app: App,
  op: PatchOperation,
  file: TFile,
  opName: string
): Promise<PatchOpResult | null> {
  const scope = op.scope;
  if (!scope) return null;

  if (scope.path_in && !scopePathMatches(file.path, scope.path_in)) {
    return opSkipped(opName, file, "Scope not met: path not in scoped paths");
  }
  if (scope.path_not_in && scopePathMatches(file.path, scope.path_not_in)) {
    return opSkipped(opName, file, "Scope not met: path in excluded paths");
  }

  const frontmatterDateChecks: Array<{
    field: string;
    since?: string | Date;
    before?: string | Date;
    label: string;
  }> = [];
  if (scope.created_since) {
    frontmatterDateChecks.push({
      field: "created",
      since: scope.created_since,
      label: "created_since",
    });
  }
  if (scope.created_before) {
    frontmatterDateChecks.push({
      field: "created",
      before: scope.created_before,
      label: "created_before",
    });
  }
  if (scope.updated_since) {
    frontmatterDateChecks.push({
      field: scope.updated_field ?? "updated",
      since: scope.updated_since,
      label: "updated_since",
    });
  }
  if (scope.updated_before) {
    frontmatterDateChecks.push({
      field: scope.updated_field ?? "updated",
      before: scope.updated_before,
      label: "updated_before",
    });
  }
  const needsFrontmatter =
    frontmatterDateChecks.length > 0 ||
    Boolean(scope.field_equals) ||
    Boolean(scope.field_not_equals) ||
    Boolean(scope.field_present) ||
    Boolean(scope.field_missing) ||
    Boolean(scope.has_tag) ||
    Boolean(scope.missing_tag) ||
    Boolean(scope.type_in) ||
    Boolean(scope.status_in);

  let noteFrontmatter: Record<string, unknown> | null = null;
  if (needsFrontmatter) {
    const note = await readNote(app, file);
    if (!note) return opError(opName, file, "Could not read file for scope check");
    noteFrontmatter = note.frontmatter;
  }

  for (const check of frontmatterDateChecks) {
    const raw = noteFrontmatter?.[check.field];
    const timestamp = parseScopeDate(raw);
    if (timestamp === null) {
      return opSkipped(opName, file, `Scope not met: '${check.field}' is missing or not a date`);
    }

    if (check.since) {
      const cutoff = parseScopeDate(check.since);
      if (cutoff === null) {
        return opError(opName, file, `Invalid scope date '${formatScopeDate(check.since)}' for '${check.label}'`);
      }
      if (timestamp < cutoff) {
        return opSkipped(opName, file, `Scope not met: '${check.field}' before ${formatScopeDate(check.since)}`);
      }
    }

    if (check.before) {
      const cutoff = parseScopeDate(check.before);
      if (cutoff === null) {
        return opError(opName, file, `Invalid scope date '${formatScopeDate(check.before)}' for '${check.label}'`);
      }
      if (timestamp > cutoff) {
        return opSkipped(opName, file, `Scope not met: '${check.field}' after ${formatScopeDate(check.before)}`);
      }
    }
  }

  if (noteFrontmatter) {
    const fieldEquals = { ...(scope.field_equals ?? {}) };
    if (scope.type_in) fieldEquals.type = toScopeList(scope.type_in);
    if (scope.status_in) fieldEquals.status = toScopeList(scope.status_in);

    for (const [field, expected] of Object.entries(fieldEquals)) {
      const actual = noteFrontmatter[field];
      if (!scopeValueMatches(actual, expected)) {
        return opSkipped(opName, file, `Scope not met: '${field}' does not match`);
      }
    }

    for (const [field, expected] of Object.entries(scope.field_not_equals ?? {})) {
      const actual = noteFrontmatter[field];
      if (scopeValueMatches(actual, expected)) {
        return opSkipped(opName, file, `Scope not met: '${field}' matches excluded value`);
      }
    }

    for (const field of toScopeList(scope.field_present)) {
      if (!isFieldPresent(noteFrontmatter, field)) {
        return opSkipped(opName, file, `Scope not met: '${field}' missing`);
      }
    }

    for (const field of toScopeList(scope.field_missing)) {
      if (isFieldPresent(noteFrontmatter, field)) {
        return opSkipped(opName, file, `Scope not met: '${field}' present`);
      }
    }

    const currentTags = getTags(noteFrontmatter).map((tag) => tag.toLowerCase());
    for (const tag of toScopeList(scope.has_tag)) {
      if (!currentTags.includes(tag.toLowerCase())) {
        return opSkipped(opName, file, `Scope not met: tag '${tag}' missing`);
      }
    }

    for (const tag of toScopeList(scope.missing_tag)) {
      if (currentTags.includes(tag.toLowerCase())) {
        return opSkipped(opName, file, `Scope not met: tag '${tag}' present`);
      }
    }
  }

  if (scope.file_created_since) {
    const cutoff = parseScopeDate(scope.file_created_since);
    if (cutoff === null) {
      return opError(opName, file, `Invalid scope date '${formatScopeDate(scope.file_created_since)}' for 'file_created_since'`);
    }
    if (file.stat.ctime < cutoff) {
      return opSkipped(opName, file, `Scope not met: file created before ${formatScopeDate(scope.file_created_since)}`);
    }
  }
  if (scope.file_created_before) {
    const cutoff = parseScopeDate(scope.file_created_before);
    if (cutoff === null) {
      return opError(opName, file, `Invalid scope date '${formatScopeDate(scope.file_created_before)}' for 'file_created_before'`);
    }
    if (file.stat.ctime > cutoff) {
      return opSkipped(opName, file, `Scope not met: file created after ${formatScopeDate(scope.file_created_before)}`);
    }
  }

  if (scope.file_modified_since) {
    const cutoff = parseScopeDate(scope.file_modified_since);
    if (cutoff === null) {
      return opError(opName, file, `Invalid scope date '${formatScopeDate(scope.file_modified_since)}' for 'file_modified_since'`);
    }
    if (file.stat.mtime < cutoff) {
      return opSkipped(opName, file, `Scope not met: file modified before ${formatScopeDate(scope.file_modified_since)}`);
    }
  }
  if (scope.file_modified_before) {
    const cutoff = parseScopeDate(scope.file_modified_before);
    if (cutoff === null) {
      return opError(opName, file, `Invalid scope date '${formatScopeDate(scope.file_modified_before)}' for 'file_modified_before'`);
    }
    if (file.stat.mtime > cutoff) {
      return opSkipped(opName, file, `Scope not met: file modified after ${formatScopeDate(scope.file_modified_before)}`);
    }
  }

  return null;
}

function scopePathMatches(path: string, patterns: string | string[]): boolean {
  return toScopeList(patterns).some((pattern) =>
    matchesGlob(path, pattern) || normalizePath(path).toLowerCase() === normalizePath(pattern).toLowerCase()
  );
}

function toScopeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  return [];
}

function scopeValueMatches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return expected.some((value) => scopeValueMatches(actual, value));
  }

  if (Array.isArray(actual)) {
    return actual.some((value) => scopeValueMatches(value, expected));
  }

  return normalizeScopeValue(actual) === normalizeScopeValue(expected);
}

function normalizeScopeValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim().toLowerCase();
  }
  if (value === null || value === undefined) return "";
  return JSON.stringify(value).toLowerCase();
}

function parseScopeDate(value: unknown): number | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return parseDateOnly(value.toISOString().slice(0, 10));
  }

  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return parseDateOnly(trimmed);
  }

  const time = new Date(trimmed).getTime();
  return Number.isNaN(time) ? null : time;
}

function formatScopeDate(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

function parseDateOnly(value: string): number | null {
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateOnly) return null;

  const year = Number(dateOnly[1]);
  const month = Number(dateOnly[2]) - 1;
  const day = Number(dateOnly[3]);
  const time = new Date(year, month, day).getTime();
  return Number.isNaN(time) ? null : time;
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
