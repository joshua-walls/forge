import { normalisePath } from "../vault/paths.js";
import { localTimestamp, matchesGlob, safeTimestamp } from "../vault/paths.js";
import type { ForgeYamlParser } from "../schemas/schema.js";
import type { ForgeDocument } from "../linting/model.js";
import type { ForgeSettings } from "../config/settings.js";
import { getTags, addTag, normalizeTags, removeTag, setTags } from "../utils/tags.js";
import { isFieldPresent, sortFrontmatterFields, splitFrontmatter } from "../vault/frontmatter.js";

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
  scope?: PatchScope;
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

export interface PatchScope {
  created_since?: string | Date;
  created_before?: string | Date;
  updated_since?: string | Date;
  updated_before?: string | Date;
  updated_field?: string;
  file_created_since?: string | Date;
  file_created_before?: string | Date;
  file_modified_since?: string | Date;
  file_modified_before?: string | Date;
  field_equals?: Record<string, unknown>;
  field_not_equals?: Record<string, unknown>;
  field_present?: string | string[];
  field_missing?: string | string[];
  has_tag?: string | string[];
  missing_tag?: string | string[];
  path_in?: string | string[];
  path_not_in?: string | string[];
  type_in?: string | string[];
  status_in?: string | string[];
  limit?: number;
}

export interface PatchFile {
  meta: PatchMeta;
  operations: PatchOperation[];
}

export interface PatchParseResult {
  patch: PatchFile | null;
  yaml: string;
  error: string | null;
}

export interface PlanPatchForDocumentsInput {
  documents: ForgeDocument[];
  settings: Pick<ForgeSettings, "frontmatterFieldOrder">;
  patchFile: PatchFile;
  patchFilePath: string;
  runId?: string;
  appliedAt?: string;
  now?: number;
}

export type ForgeYamlStringifier = (value: unknown) => string;

export interface PatchDocumentEdit {
  result: PatchOpResult;
  path: string;
  content: string;
  frontmatter: Record<string, unknown>;
  contentChanged: boolean;
  pathChanged: boolean;
}

export interface ApplyPatchOperationToDocumentInput {
  operation: PatchOperation;
  activeDocument: ForgeDocument;
  settings: Pick<ForgeSettings, "frontmatterFieldOrder">;
  stringifyYaml: ForgeYamlStringifier;
  now?: number;
  existingPaths?: ReadonlySet<string>;
}

export interface PatchDocumentUpdate {
  pathBefore: string;
  pathAfter: string;
  contentBefore: string;
  contentAfter: string;
}

export interface ApplyPatchToDocumentsInput {
  documents: ForgeDocument[];
  settings: Pick<ForgeSettings, "frontmatterFieldOrder">;
  patchFile: PatchFile;
  patchFilePath: string;
  stringifyYaml: ForgeYamlStringifier;
  runId?: string;
  appliedAt?: string;
  now?: number;
}

export interface ApplyPatchToDocumentsResult {
  run: PatchRunResult;
  documents: PatchDocumentUpdate[];
}

export function extractPatchYaml(raw: string, patchFilePath: string): string {
  const lowerPath = normalisePath(patchFilePath).toLowerCase();

  if (!lowerPath.endsWith(".md")) {
    return raw;
  }

  const match = raw.match(/```ya?ml\s*\r?\n([\s\S]*?)```/i);
  return match?.[1]?.trim() ?? "";
}

export function parsePatchFile(
  raw: string,
  patchFilePath: string,
  parseYaml: ForgeYamlParser
): PatchFile | null {
  return parsePatchFileResult(raw, patchFilePath, parseYaml).patch;
}

export function parsePatchFileResult(
  raw: string,
  patchFilePath: string,
  parseYaml: ForgeYamlParser
): PatchParseResult {
  const yaml = extractPatchYaml(raw, patchFilePath);

  if (!yaml.trim()) {
    return {
      patch: null,
      yaml,
      error: "Patch file contains no YAML payload",
    };
  }

  try {
    const parsed = parseYaml(yaml);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        patch: null,
        yaml,
        error: "Patch YAML must be an object",
      };
    }

    const record = parsed as Record<string, unknown>;
    const meta = coercePatchMeta(record.meta);
    const operations = Array.isArray(record.operations)
      ? record.operations.filter(isPatchOperation)
      : [];

    return {
      patch: { meta, operations },
      yaml,
      error: null,
    };
  } catch (error) {
    return {
      patch: null,
      yaml,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function coercePatchMeta(value: unknown): PatchMeta {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function isPatchOperation(value: unknown): value is PatchOperation {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { op?: unknown }).op === "string"
  );
}

export function selectPatchTargetDocuments(
  documents: ForgeDocument[],
  target?: string,
  targetPattern?: string
): ForgeDocument[] {
  const results: ForgeDocument[] = [];

  if (target) {
    const normalizedTarget = normalisePath(target).toLowerCase();
    const exact = documents.find((document) => document.path.toLowerCase() === normalizedTarget);
    if (exact) results.push(exact);
  }

  if (targetPattern) {
    for (const document of documents) {
      if (matchesGlob(document.path, targetPattern)) results.push(document);
    }
  }

  const seen = new Set<string>();
  return results.filter((document) => {
    if (seen.has(document.path)) return false;
    seen.add(document.path);
    return true;
  });
}

export function planPatchForDocuments(input: PlanPatchForDocumentsInput): PatchRunResult {
  const results: PatchOpResult[] = [];
  const operations: PatchOperationChange[] = [];
  let operationSeq = 0;
  const existingPaths = lowerPathSet(input.documents.map((document) => document.path));

  for (let opIndex = 0; opIndex < input.patchFile.operations.length; opIndex += 1) {
    const op = input.patchFile.operations[opIndex];
    const opName = op?.op ?? "<unknown>";
    const targets = selectPatchTargetDocuments(input.documents, op.target, op.target_pattern);

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
    for (const document of targets) {
      const scopeResult = evaluatePatchScopeForDocument(op, document, opName);
      if (scopeResult) {
        results.push(scopeResult);
        continue;
      }

      if (op.scope?.limit !== undefined) {
        if (op.scope.limit < 1) {
          results.push(opError(opName, document.path, "Scope limit must be greater than 0"));
          continue;
        }
        if (scopedTargetCount >= op.scope.limit) {
          results.push(opSkipped(opName, document.path, `Scope limit reached: ${op.scope.limit}`));
          continue;
        }
      }

      scopedTargetCount += 1;
      const result = planPatchOperation(op, document, input.settings.frontmatterFieldOrder, input.now ?? Date.now(), existingPaths);
      if (result.status === "changed" && result.change) {
        operationSeq += 1;
        result.change.id = makeOperationId(operationSeq);
        result.change.op_index = opIndex;
        operations.push(result.change);
      }
      results.push(result);
    }
  }

  return {
    runId: input.runId ?? safeTimestamp(),
    patchFile: input.patchFilePath,
    description: input.patchFile.meta.description ?? "",
    appliedAt: input.appliedAt ?? localTimestamp(),
    schemaVersion: input.patchFile.meta.schema_version ?? "",
    dryRun: true,
    results,
    manifest: [],
    operations,
  };
}

export function applyPatchOperationToDocument(
  input: ApplyPatchOperationToDocumentInput
): PatchDocumentEdit {
  const document = input.activeDocument;
  const result = planPatchOperation(
    input.operation,
    document,
    input.settings.frontmatterFieldOrder,
    input.now ?? Date.now(),
    input.existingPaths
  );

  if (result.status !== "changed") {
    return unchangedDocumentEdit(document, result);
  }

  if (input.operation.op === "move_note") {
    return applyMoveNoteToDocument(input, result);
  }

  const frontmatter = cloneRecord(document.frontmatter);

  switch (input.operation.op) {
    case "set_field":
    case "compute_field":
      applyFieldAfterValue(frontmatter, input.operation.field, result);
      break;
    case "remove_field":
      if (input.operation.field) delete frontmatter[input.operation.field];
      break;
    case "add_tag":
    case "remove_tag":
    case "replace_tag":
    case "normalize_tags":
      applyTagsAfterValue(frontmatter, result);
      break;
    case "sort_frontmatter":
      {
        const sorted = sortFrontmatterFields(frontmatter, input.settings.frontmatterFieldOrder);
        return changedDocumentEdit(
          document,
          result,
          document.path,
          renderMarkdownDocument(sorted, documentBody(document), input.stringifyYaml),
          sorted
        );
      }
    default:
      return unchangedDocumentEdit(document, result);
  }

  const sorted = sortFrontmatterFields(frontmatter, input.settings.frontmatterFieldOrder);
  return changedDocumentEdit(
    document,
    result,
    document.path,
    renderMarkdownDocument(sorted, documentBody(document), input.stringifyYaml),
    sorted
  );
}

export function applyPatchToDocuments(
  input: ApplyPatchToDocumentsInput
): ApplyPatchToDocumentsResult {
  const documentsByPath = new Map<string, ForgeDocument>();
  const pathOrigins = new Map<string, string>();
  const existingPaths = lowerPathSet(input.documents.map((document) => document.path));
  const updatesByOrigin = new Map<string, PatchDocumentUpdate>();

  for (const document of input.documents) {
    documentsByPath.set(document.path, cloneDocument(document));
    pathOrigins.set(document.path, document.path);
  }

  const results: PatchOpResult[] = [];
  const operations: PatchOperationChange[] = [];
  let operationSeq = 0;
  const now = input.now ?? Date.now();

  for (let opIndex = 0; opIndex < input.patchFile.operations.length; opIndex += 1) {
    const op = input.patchFile.operations[opIndex];
    const opName = op?.op ?? "<unknown>";
    const targets = selectPatchTargetDocuments([...documentsByPath.values()], op.target, op.target_pattern);

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
    for (const target of targets) {
      const currentDocument = documentsByPath.get(target.path);
      if (!currentDocument) continue;

      const scopeResult = evaluatePatchScopeForDocument(op, currentDocument, opName);
      if (scopeResult) {
        results.push(scopeResult);
        continue;
      }

      if (op.scope?.limit !== undefined) {
        if (op.scope.limit < 1) {
          results.push(opError(opName, currentDocument.path, "Scope limit must be greater than 0"));
          continue;
        }
        if (scopedTargetCount >= op.scope.limit) {
          results.push(opSkipped(opName, currentDocument.path, `Scope limit reached: ${op.scope.limit}`));
          continue;
        }
      }

      scopedTargetCount += 1;
      const edit = applyPatchOperationToDocument({
        operation: op,
        activeDocument: currentDocument,
        settings: input.settings,
        stringifyYaml: input.stringifyYaml,
        now,
        existingPaths,
      });

      if (edit.result.status === "changed" && edit.result.change) {
        operationSeq += 1;
        edit.result.change.id = makeOperationId(operationSeq);
        edit.result.change.op_index = opIndex;
        operations.push(edit.result.change);
      }

      results.push(edit.result);
      if (!edit.contentChanged && !edit.pathChanged) continue;

      const origin = pathOrigins.get(currentDocument.path) ?? currentDocument.path;
      const existingUpdate = updatesByOrigin.get(origin);
      updatesByOrigin.set(origin, {
        pathBefore: origin,
        pathAfter: edit.path,
        contentBefore: existingUpdate?.contentBefore ?? currentDocument.content,
        contentAfter: edit.content,
      });

      documentsByPath.delete(currentDocument.path);
      pathOrigins.delete(currentDocument.path);
      existingPaths.delete(currentDocument.path.toLowerCase());

      const updatedDocument = updateDocumentFromEdit(currentDocument, edit);
      documentsByPath.set(updatedDocument.path, updatedDocument);
      pathOrigins.set(updatedDocument.path, origin);
      existingPaths.add(updatedDocument.path.toLowerCase());
    }
  }

  return {
    run: {
      runId: input.runId ?? safeTimestamp(),
      patchFile: input.patchFilePath,
      description: input.patchFile.meta.description ?? "",
      appliedAt: input.appliedAt ?? localTimestamp(),
      schemaVersion: input.patchFile.meta.schema_version ?? "",
      dryRun: false,
      results,
      manifest: [],
      operations,
    },
    documents: [...updatesByOrigin.values()],
  };
}

function planPatchOperation(
  op: PatchOperation,
  document: ForgeDocument,
  fieldOrder: string[],
  now: number,
  existingPaths?: ReadonlySet<string>
): PatchOpResult {
  switch (op.op) {
    case "set_field":
      return planSetField(op, document);
    case "remove_field":
      return planRemoveField(op, document);
    case "add_tag":
      return planAddTag(op, document);
    case "remove_tag":
      return planRemoveTag(op, document);
    case "replace_tag":
      return planReplaceTag(op, document);
    case "normalize_tags":
      return planNormalizeTagsOp(document);
    case "compute_field":
      return planComputeField(op, document, now);
    case "sort_frontmatter":
      return planSortFrontmatter(document, fieldOrder);
    case "move_note":
      return planMoveNote(op, document, existingPaths);
    default:
      return opError(op.op ?? "<unknown>", document.path, `Unknown operation: '${op.op ?? "<unknown>"}'`);
  }
}

function planSetField(op: PatchOperation, document: ForgeDocument): PatchOpResult {
  const fieldName = op.field;
  if (!fieldName) return opError("set_field", document.path, "Missing field name");

  const currentValue = document.frontmatter[fieldName];
  if ((op.only_if_missing ?? false) && isFieldPresent(document.frontmatter, fieldName)) {
    return opSkipped("set_field", document.path, `Field '${fieldName}' already has a value`);
  }

  if (op.when) {
    const whenVal = document.frontmatter[op.when.field];
    const whenCurrent = whenVal === undefined ? "" : formatPatchValue(whenVal);
    if (whenCurrent !== op.when.equals) {
      return opSkipped("set_field", document.path, `Condition not met: '${op.when.field}' is '${whenCurrent}', expected '${op.when.equals}'`);
    }
  }

  let newValue: unknown;
  try {
    newValue = resolveFieldValue(op, document);
  } catch (error) {
    return opError("set_field", document.path, String(error));
  }

  const currentStr = currentValue === undefined ? "<missing>" : JSON.stringify(currentValue);
  const newStr = JSON.stringify(newValue);
  if (currentStr === newStr) {
    return opSkipped("set_field", document.path, `Field '${fieldName}' already = ${newStr}`);
  }

  return opChanged(
    "set_field",
    document.path,
    `Set '${fieldName}': ${currentStr} → ${newStr}`,
    fieldChange("set_field", document.path, document.path, fieldName, currentValue, newValue)
  );
}

function planRemoveField(op: PatchOperation, document: ForgeDocument): PatchOpResult {
  const fieldName = op.field;
  if (!fieldName) return opError("remove_field", document.path, "Missing field name");
  if (!isFieldPresent(document.frontmatter, fieldName)) {
    return opSkipped("remove_field", document.path, `Field '${fieldName}' not present`);
  }

  return opChanged(
    "remove_field",
    document.path,
    `Removed field '${fieldName}'`,
    fieldChange("remove_field", document.path, document.path, fieldName, document.frontmatter[fieldName], undefined)
  );
}

function planAddTag(op: PatchOperation, document: ForgeDocument): PatchOpResult {
  const tag = op.tag;
  if (!tag) return opError("add_tag", document.path, "Missing tag");

  const current = getTags(document.frontmatter);
  const updated = addTag(current, tag);
  if (updated === current) return opSkipped("add_tag", document.path, `Tag '${tag}' already present`);

  return opChanged(
    "add_tag",
    document.path,
    `Added tag '${tag}'`,
    tagsChange("add_tag", document.path, document.path, current, normalizeTags(updated), `Add tag '${tag}'`)
  );
}

function planRemoveTag(op: PatchOperation, document: ForgeDocument): PatchOpResult {
  const tag = op.tag;
  if (!tag) return opError("remove_tag", document.path, "Missing tag");

  const current = getTags(document.frontmatter);
  const updated = removeTag(current, tag);
  if (updated === current) return opSkipped("remove_tag", document.path, `Tag '${tag}' not present`);

  return opChanged(
    "remove_tag",
    document.path,
    `Removed tag '${tag}'`,
    tagsChange("remove_tag", document.path, document.path, current, normalizeTags(updated), `Remove tag '${tag}'`)
  );
}

function planReplaceTag(op: PatchOperation, document: ForgeDocument): PatchOpResult {
  const oldTag = op.old_tag;
  const newTag = op.new_tag;
  if (!oldTag || !newTag) return opError("replace_tag", document.path, "Missing old_tag or new_tag");

  const current = getTags(document.frontmatter);
  const hasOld = current.some((tag) => tag.toLowerCase() === oldTag.toLowerCase());
  if (!hasOld) return opSkipped("replace_tag", document.path, `Tag '${oldTag}' not present`);

  const hasNew = current.some((tag) => tag.toLowerCase() === newTag.toLowerCase());
  if (hasNew) return opSkipped("replace_tag", document.path, `Tag '${newTag}' already present`);

  const updated = current.map((tag) => tag.toLowerCase() === oldTag.toLowerCase() ? newTag : tag);
  return opChanged(
    "replace_tag",
    document.path,
    `Replaced tag '${oldTag}' → '${newTag}'`,
    tagsChange("replace_tag", document.path, document.path, current, normalizeTags(updated), `Replace tag '${oldTag}'`)
  );
}

function planNormalizeTagsOp(document: ForgeDocument): PatchOpResult {
  const current = getTags(document.frontmatter);
  const normalized = normalizeTags(current);
  if (current.join("|") === normalized.join("|")) {
    return opSkipped("normalize_tags", document.path, "Tags already normalized");
  }

  return opChanged(
    "normalize_tags",
    document.path,
    "Normalized tags",
    tagsChange("normalize_tags", document.path, document.path, current, normalized, "Normalize tags")
  );
}

function planComputeField(op: PatchOperation, document: ForgeDocument, now: number): PatchOpResult {
  const fieldName = op.field;
  const strategy = op.strategy;
  if (!fieldName) return opError("compute_field", document.path, "Missing field name");
  if (!strategy) return opError("compute_field", document.path, "Missing strategy");
  if ((op.when_missing ?? false) && isFieldPresent(document.frontmatter, fieldName)) {
    return opSkipped("compute_field", document.path, `Field '${fieldName}' already has a value`);
  }

  const beforeValue = document.frontmatter[fieldName];
  const format = op.format ?? "yyyy-MM-dd";
  let newValue: string;

  switch (strategy) {
    case "file_created_time":
      newValue = formatDate(new Date(document.stat?.ctime ?? now), format);
      break;
    case "file_modified_time":
      newValue = formatDate(new Date(document.stat?.mtime ?? now), format);
      break;
    case "recent_activity": {
      const valueIfTrue = op.value_if_true;
      if (!valueIfTrue) return opError("compute_field", document.path, "recent_activity requires value_if_true");

      const currentVal = formatPatchValue(document.frontmatter[fieldName]).trim();
      if ((op.skip_if ?? []).includes(currentVal)) {
        return opSkipped("compute_field", document.path, `Field '${fieldName}' is '${currentVal}' — excluded by skip_if`);
      }

      const days = op.days ?? 30;
      const cutoff = now - days * 24 * 60 * 60 * 1000;
      if ((document.stat?.mtime ?? 0) < cutoff) {
        return opSkipped("compute_field", document.path, `File not modified in last ${days} days`);
      }
      newValue = valueIfTrue;
      break;
    }
    default:
      return opError("compute_field", document.path, `Unsupported strategy '${strategy}'`);
  }

  const currentVal = beforeValue !== undefined ? formatPatchValue(beforeValue) : "<missing>";
  if (currentVal === newValue) {
    return opSkipped("compute_field", document.path, `Field '${fieldName}' already = '${newValue}'`);
  }

  return opChanged(
    "compute_field",
    document.path,
    `Computed '${fieldName}': '${currentVal}' → '${newValue}'`,
    fieldChange("compute_field", document.path, document.path, fieldName, beforeValue, newValue)
  );
}

function planSortFrontmatter(document: ForgeDocument, fieldOrder: string[]): PatchOpResult {
  if (!document.hasFrontmatter) return opSkipped("sort_frontmatter", document.path, "No frontmatter found");

  const sorted = sortFrontmatterFields(document.frontmatter, fieldOrder);
  const beforeKeys = Object.keys(document.frontmatter);
  const afterKeys = Object.keys(sorted);
  if (beforeKeys.join(",") === afterKeys.join(",")) {
    return opSkipped("sort_frontmatter", document.path, "Frontmatter already in correct order");
  }

  return opChanged(
    "sort_frontmatter",
    document.path,
    "Sorted frontmatter fields",
    frontmatterOrderChange(document.path, beforeKeys, afterKeys)
  );
}

function planMoveNote(
  op: PatchOperation,
  document: ForgeDocument,
  existingPaths?: ReadonlySet<string>
): PatchOpResult {
  const move = resolveMoveNote(op, document);
  if ("error" in move) return opError("move_note", document.path, move.error);

  if (normalisePath(document.path).toLowerCase() === move.destinationPath.toLowerCase()) {
    return opSkipped("move_note", document.path, "Already in correct location");
  }

  if (existingPaths?.has(move.destinationPath.toLowerCase())) {
    return opError("move_note", document.path, `Destination already exists: ${move.destinationPath}`);
  }

  return opChanged(
    "move_note",
    document.path,
    `Moved → ${move.destinationPath}`,
    op.strip_frontmatter || op.frontmatter ? undefined : moveNoteChange(document.path, move.destinationPath)
  );
}

function applyMoveNoteToDocument(
  input: ApplyPatchOperationToDocumentInput,
  result: PatchOpResult
): PatchDocumentEdit {
  const document = input.activeDocument;
  const move = resolveMoveNote(input.operation, document);
  if ("error" in move) return unchangedDocumentEdit(document, opError("move_note", document.path, move.error));

  let content = document.content;
  let frontmatter = cloneRecord(document.frontmatter);
  if (input.operation.strip_frontmatter) {
    content = documentBody(document);
    frontmatter = {};
  } else if (input.operation.frontmatter) {
    frontmatter = sortFrontmatterFields(
      { ...frontmatter, ...input.operation.frontmatter },
      input.settings.frontmatterFieldOrder
    );
    content = renderMarkdownDocument(frontmatter, documentBody(document), input.stringifyYaml);
  }

  return changedDocumentEdit(document, result, move.destinationPath, content, frontmatter);
}

function resolveMoveNote(
  op: PatchOperation,
  document: ForgeDocument
): { destinationPath: string } | { error: string } {
  const destinationFolder = op.destination_folder;
  const sourceRoot = op.source_root;

  if (!destinationFolder) return { error: "Missing destination_folder" };
  if (!sourceRoot) return { error: "Missing source_root" };
  if (op.strip_frontmatter && op.frontmatter) return { error: "Cannot use both strip_frontmatter and frontmatter" };

  const normalizedSourceRoot = normalisePath(sourceRoot).replace(/\/+$/u, "");
  const filePath = normalisePath(document.path);
  const lowerFilePath = filePath.toLowerCase();
  const lowerSourceRoot = normalizedSourceRoot.toLowerCase();
  if (lowerFilePath !== lowerSourceRoot && !lowerFilePath.startsWith(`${lowerSourceRoot}/`)) {
    return { error: `File is not under source_root '${sourceRoot}'` };
  }

  const relativeUnderSource = filePath.slice(normalizedSourceRoot.length).replace(/^\/+/u, "");
  return {
    destinationPath: normalisePath(`${destinationFolder}/${relativeUnderSource}`),
  };
}

function unchangedDocumentEdit(document: ForgeDocument, result: PatchOpResult): PatchDocumentEdit {
  return {
    result,
    path: document.path,
    content: document.content,
    frontmatter: document.frontmatter,
    contentChanged: false,
    pathChanged: false,
  };
}

function changedDocumentEdit(
  document: ForgeDocument,
  result: PatchOpResult,
  path: string,
  content: string,
  frontmatter: Record<string, unknown>
): PatchDocumentEdit {
  return {
    result,
    path,
    content,
    frontmatter,
    contentChanged: content !== document.content,
    pathChanged: normalisePath(path).toLowerCase() !== normalisePath(document.path).toLowerCase(),
  };
}

function applyFieldAfterValue(
  frontmatter: Record<string, unknown>,
  field: string | undefined,
  result: PatchOpResult
): void {
  if (!field) return;
  const after = result.change?.after;
  if (!after?.exists) return;
  frontmatter[field] = cloneValue(after.value);
}

function applyTagsAfterValue(frontmatter: Record<string, unknown>, result: PatchOpResult): void {
  const after = result.change?.after;
  if (!after?.exists || !Array.isArray(after.value)) return;
  setTags(frontmatter, after.value.map((tag) => String(tag)));
}

function renderMarkdownDocument(
  frontmatter: Record<string, unknown>,
  body: string,
  stringifyYaml: ForgeYamlStringifier
): string {
  const yaml = trimTrailingWhitespace(stringifyYaml(frontmatter));
  return `---\n${yaml}\n---\n${body}`;
}

function documentBody(document: ForgeDocument): string {
  return splitFrontmatter(document.content)?.body ?? document.content;
}

function updateDocumentFromEdit(document: ForgeDocument, edit: PatchDocumentEdit): ForgeDocument {
  const { basename, extension } = parsePathParts(edit.path);
  return {
    path: edit.path,
    basename,
    extension,
    content: edit.content,
    frontmatter: edit.frontmatter,
    hasFrontmatter: splitFrontmatter(edit.content) !== null,
    ...(document.stat ? { stat: document.stat } : {}),
  };
}

function cloneDocument(document: ForgeDocument): ForgeDocument {
  return {
    ...document,
    frontmatter: cloneRecord(document.frontmatter),
  };
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return cloneValue(record);
}

function lowerPathSet(paths: Iterable<string>): Set<string> {
  return new Set([...paths].map((path) => normalisePath(path).toLowerCase()));
}

function trimTrailingWhitespace(value: string): string {
  return value.replace(/\s+$/u, "");
}

function parsePathParts(path: string): { basename: string; extension: string } {
  const filename = path.split("/").pop() ?? path;
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === filename.length - 1) {
    return { basename: filename, extension: "" };
  }
  return {
    basename: filename.slice(0, lastDot),
    extension: filename.slice(lastDot + 1).toLowerCase(),
  };
}

function evaluatePatchScopeForDocument(
  op: PatchOperation,
  document: ForgeDocument,
  opName: string
): PatchOpResult | null {
  const scope = op.scope;
  if (!scope) return null;

  if (scope.path_in && !scopePathMatches(document.path, scope.path_in)) {
    return opSkipped(opName, document.path, "Scope not met: path not in scoped paths");
  }
  if (scope.path_not_in && scopePathMatches(document.path, scope.path_not_in)) {
    return opSkipped(opName, document.path, "Scope not met: path in excluded paths");
  }

  const fieldEquals = { ...(scope.field_equals ?? {}) };
  if (scope.type_in) fieldEquals.type = toScopeList(scope.type_in);
  if (scope.status_in) fieldEquals.status = toScopeList(scope.status_in);

  for (const [field, expected] of Object.entries(fieldEquals)) {
    if (!scopeValueMatches(document.frontmatter[field], expected)) {
      return opSkipped(opName, document.path, `Scope not met: '${field}' does not match`);
    }
  }

  for (const [field, expected] of Object.entries(scope.field_not_equals ?? {})) {
    if (scopeValueMatches(document.frontmatter[field], expected)) {
      return opSkipped(opName, document.path, `Scope not met: '${field}' matches excluded value`);
    }
  }

  for (const field of toScopeList(scope.field_present)) {
    if (!isFieldPresent(document.frontmatter, field)) {
      return opSkipped(opName, document.path, `Scope not met: '${field}' missing`);
    }
  }

  for (const field of toScopeList(scope.field_missing)) {
    if (isFieldPresent(document.frontmatter, field)) {
      return opSkipped(opName, document.path, `Scope not met: '${field}' present`);
    }
  }

  const currentTags = getTags(document.frontmatter).map((tag) => tag.toLowerCase());
  for (const tag of toScopeList(scope.has_tag)) {
    if (!currentTags.includes(tag.toLowerCase())) {
      return opSkipped(opName, document.path, `Scope not met: tag '${tag}' missing`);
    }
  }

  for (const tag of toScopeList(scope.missing_tag)) {
    if (currentTags.includes(tag.toLowerCase())) {
      return opSkipped(opName, document.path, `Scope not met: tag '${tag}' present`);
    }
  }

  return evaluateDateScope(scope, document, opName);
}

function evaluateDateScope(scope: PatchScope, document: ForgeDocument, opName: string): PatchOpResult | null {
  const checks: Array<{ field: string; since?: string | Date; before?: string | Date; label: string }> = [];
  if (scope.created_since) checks.push({ field: "created", since: scope.created_since, label: "created_since" });
  if (scope.created_before) checks.push({ field: "created", before: scope.created_before, label: "created_before" });
  if (scope.updated_since) checks.push({ field: scope.updated_field ?? "updated", since: scope.updated_since, label: "updated_since" });
  if (scope.updated_before) checks.push({ field: scope.updated_field ?? "updated", before: scope.updated_before, label: "updated_before" });

  for (const check of checks) {
    const timestamp = parseScopeDate(document.frontmatter[check.field]);
    if (timestamp === null) return opSkipped(opName, document.path, `Scope not met: '${check.field}' is missing or not a date`);

    const sinceResult = compareSince(timestamp, check.since, check.label, check.field, document.path, opName);
    if (sinceResult) return sinceResult;
    const beforeResult = compareBefore(timestamp, check.before, check.label, check.field, document.path, opName);
    if (beforeResult) return beforeResult;
  }

  return evaluateFileDateScope(scope, document, opName);
}

function evaluateFileDateScope(scope: PatchScope, document: ForgeDocument, opName: string): PatchOpResult | null {
  const created = document.stat?.ctime ?? 0;
  const modified = document.stat?.mtime ?? 0;
  return compareSince(created, scope.file_created_since, "file_created_since", "file created", document.path, opName) ??
    compareBefore(created, scope.file_created_before, "file_created_before", "file created", document.path, opName) ??
    compareSince(modified, scope.file_modified_since, "file_modified_since", "file modified", document.path, opName) ??
    compareBefore(modified, scope.file_modified_before, "file_modified_before", "file modified", document.path, opName);
}

function compareSince(
  timestamp: number,
  since: string | Date | undefined,
  label: string,
  field: string,
  path: string,
  opName: string
): PatchOpResult | null {
  if (!since) return null;
  const cutoff = parseScopeDate(since);
  if (cutoff === null) return opError(opName, path, `Invalid scope date '${formatScopeDate(since)}' for '${label}'`);
  return timestamp < cutoff
    ? opSkipped(opName, path, `Scope not met: '${field}' before ${formatScopeDate(since)}`)
    : null;
}

function compareBefore(
  timestamp: number,
  before: string | Date | undefined,
  label: string,
  field: string,
  path: string,
  opName: string
): PatchOpResult | null {
  if (!before) return null;
  const cutoff = parseScopeDate(before);
  if (cutoff === null) return opError(opName, path, `Invalid scope date '${formatScopeDate(before)}' for '${label}'`);
  return timestamp > cutoff
    ? opSkipped(opName, path, `Scope not met: '${field}' after ${formatScopeDate(before)}`)
    : null;
}

function resolveFieldValue(op: PatchOperation, document: ForgeDocument): unknown {
  const hasLiteralValue = "value" in op && op.value !== undefined;
  const valueFrom = op.value_from;

  if (hasLiteralValue && valueFrom) throw new Error("Cannot specify both 'value' and 'value_from'");
  if (!hasLiteralValue && !valueFrom) throw new Error("set_field requires either 'value' or 'value_from'");
  if (hasLiteralValue) return op.value;

  const parts = normalisePath(document.path).split("/");
  const fileName = parts[parts.length - 1] ?? document.path;
  const baseName = document.basename;
  const folderName = parts.length >= 2 ? parts[parts.length - 2] : "";
  const parentFolder = parts.length >= 3 ? parts[parts.length - 3] : "";

  let value: string;
  switch (valueFrom) {
    case "filename":
      value = fileName;
      break;
    case "basename":
      value = baseName;
      break;
    case "folder":
      value = folderName ?? "";
      break;
    case "parent_folder":
      value = parentFolder ?? "";
      break;
    case "path": {
      const idx = op.path_segment_index;
      if (idx === undefined) throw new Error("value_from: path requires path_segment_index");
      if (idx < 0 || idx >= parts.length) throw new Error(`path_segment_index ${idx} out of range`);
      value = parts[idx] ?? "";
      break;
    }
    default:
      throw new Error(`Unsupported value_from '${valueFrom}'`);
  }

  if (op.trim_prefix && value.startsWith(op.trim_prefix)) value = value.slice(op.trim_prefix.length);
  if (op.trim_suffix && value.endsWith(op.trim_suffix)) value = value.slice(0, value.length - op.trim_suffix.length);
  if (op.lowercase && op.uppercase) throw new Error("Cannot specify both lowercase and uppercase");
  if (op.lowercase) value = value.toLowerCase();
  if (op.uppercase) value = value.toUpperCase();
  return value;
}

function formatPatchValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

function scopePathMatches(path: string, patterns: string | string[]): boolean {
  return toScopeList(patterns).some((pattern) =>
    matchesGlob(path, pattern) || normalisePath(path).toLowerCase() === normalisePath(pattern).toLowerCase()
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
  if (Array.isArray(expected)) return expected.some((value) => scopeValueMatches(actual, value));
  if (Array.isArray(actual)) return actual.some((value) => scopeValueMatches(value, expected));
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return parseDateOnly(trimmed);

  const time = new Date(trimmed).getTime();
  return Number.isNaN(time) ? null : time;
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

function formatScopeDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function formatDate(date: Date, format: string): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  if (format === "yyyy-MM-dd") {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  return date.toISOString();
}

function opChanged(
  op: string,
  file: string,
  detail: string,
  change?: PatchOperationChange
): PatchOpResult {
  return { op, file, status: "changed", detail, change };
}

function opSkipped(op: string, file: string, detail: string): PatchOpResult {
  return { op, file, status: "skipped", detail };
}

function opError(op: string, file: string, detail: string): PatchOpResult {
  return { op, file, status: "error", detail };
}

function makeOperationId(seq: number): string {
  return `op-${String(seq).padStart(5, "0")}`;
}

function restoreValue(value: unknown): PatchRestoreValue {
  return value === undefined ? { exists: false } : { exists: true, value: cloneValue(value) };
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
