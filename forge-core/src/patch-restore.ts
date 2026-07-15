import { splitFrontmatter, sortFrontmatterFields } from "./frontmatter.js";
import type { ForgeDocument } from "./lint.js";
import { normalisePath } from "./paths.js";
import type { ForgeSettings } from "./settings.js";
import { getTags, addTag, normalizeTags, removeTag, replaceTag, setTags } from "./tags.js";
import type {
  ForgeYamlStringifier,
  PatchDocumentUpdate,
  PatchFile,
  PatchManifestEntry,
  PatchOperation,
  PatchOperationChange,
  PatchRestoreValue,
} from "./patch.js";

export interface PatchRestoreManifest {
  manifest_version?: number;
  run_id: string;
  patch_file: string;
  description: string;
  applied_at: string;
  schema_version: string;
  changes: PatchManifestEntry[];
  operations?: PatchOperationChange[];
}

export type PatchRestoreStatus =
  | "reversible"
  | "conflicted"
  | "missing_target"
  | "unsupported"
  | "already_restored"
  | "error";

export interface PatchRestoreCandidate {
  operation: PatchOperationChange;
  status: PatchRestoreStatus;
  reason: string;
  selected: boolean;
}

export interface PatchRestoreApplyResult {
  operation: PatchOperationChange;
  status: "restored" | "skipped" | "conflicted" | "error";
  detail: string;
}

export interface ApplyPatchRestoreOperationsInput {
  documents: ForgeDocument[];
  operations: PatchOperationChange[];
  settings: Pick<ForgeSettings, "frontmatterFieldOrder">;
  stringifyYaml: ForgeYamlStringifier;
}

export interface ApplyPatchRestoreOperationsResult {
  results: PatchRestoreApplyResult[];
  documents: PatchDocumentUpdate[];
}

export interface LegacyPatchRestoreBackupDocument {
  file: string;
  frontmatter: Record<string, unknown>;
}

export interface BuildLegacyPatchRestoreCandidatesInput {
  patchFile: PatchFile;
  manifest: PatchRestoreManifest;
  currentDocuments: ForgeDocument[];
  backupDocuments: LegacyPatchRestoreBackupDocument[];
}

export function isPatchRestoreManifest(value: unknown): value is PatchRestoreManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.run_id === "string"
    && typeof candidate.patch_file === "string"
    && typeof candidate.description === "string"
    && typeof candidate.applied_at === "string"
    && typeof candidate.schema_version === "string"
    && Array.isArray(candidate.changes)
    && candidate.changes.every(isManifestChange)
    && (
      candidate.operations === undefined ||
      (Array.isArray(candidate.operations) && candidate.operations.every(isPatchOperationChange))
    );
}

export function evaluatePatchRestoreCandidates(
  manifest: PatchRestoreManifest,
  documents: ForgeDocument[]
): PatchRestoreCandidate[] {
  return (manifest.operations ?? []).map((operation) => {
    const evaluated = evaluatePatchRestoreOperation(documents, operation);
    return {
      operation,
      status: evaluated.status,
      reason: evaluated.reason,
      selected: evaluated.status === "reversible",
    };
  });
}

export function evaluatePatchRestoreOperation(
  documents: ForgeDocument[],
  operation: PatchOperationChange
): { status: PatchRestoreStatus; reason: string } {
  try {
    switch (operation.target.kind) {
      case "frontmatter_field": {
        const document = findDocumentByPath(documents, operation.file_after);
        if (!document) return { status: "missing_target", reason: "Current file is missing" };

        const current = restoreValue(document.frontmatter[operation.target.field]);
        return compareCurrentToManifest(current, operation.before, operation.after);
      }
      case "frontmatter_tags": {
        const document = findDocumentByPath(documents, operation.file_after);
        if (!document) return { status: "missing_target", reason: "Current file is missing" };

        const current = restoreValue(normalizeTags(getTags(document.frontmatter)));
        return compareCurrentToManifest(
          current,
          normalizeManifestArray(operation.before),
          normalizeManifestArray(operation.after)
        );
      }
      case "frontmatter_order": {
        const document = findDocumentByPath(documents, operation.file_after);
        if (!document) return { status: "missing_target", reason: "Current file is missing" };

        const current = restoreValue(Object.keys(document.frontmatter));
        return compareCurrentToManifest(current, operation.before, operation.after);
      }
      case "note_move": {
        const currentDocument = findDocumentByPath(documents, operation.file_after);
        const originalDocument = findDocumentByPath(documents, operation.file_before);
        if (currentDocument && !originalDocument) {
          return { status: "reversible", reason: "Ready to move note back" };
        }
        if (!currentDocument && originalDocument) {
          return { status: "already_restored", reason: "Note is already back at its original path" };
        }
        if (!currentDocument) return { status: "missing_target", reason: "Moved note is missing" };
        return { status: "conflicted", reason: "Original path is occupied" };
      }
      default:
        return { status: "unsupported", reason: "Operation target is unsupported" };
    }
  } catch (error) {
    return { status: "error", reason: formatError(error) };
  }
}

export function applyPatchRestoreOperations(
  input: ApplyPatchRestoreOperationsInput
): ApplyPatchRestoreOperationsResult {
  const documentsByPath = new Map<string, ForgeDocument>();
  const pathOrigins = new Map<string, string>();
  const originalsByOrigin = new Map<string, ForgeDocument>();
  const updatesByOrigin = new Map<string, PatchDocumentUpdate>();

  for (const document of input.documents) {
    const cloned = cloneDocument(document);
    const key = pathKey(cloned.path);
    documentsByPath.set(key, cloned);
    pathOrigins.set(key, cloned.path);
    originalsByOrigin.set(pathKey(cloned.path), cloneDocument(cloned));
  }

  const results: PatchRestoreApplyResult[] = [];

  for (const operation of input.operations) {
    const documents = [...documentsByPath.values()];
    const evaluated = evaluatePatchRestoreOperation(documents, operation);
    if (evaluated.status !== "reversible") {
      results.push(nonReversibleResult(operation, evaluated));
      continue;
    }

    const applied = applyReverseOperation({
      operation,
      documentsByPath,
      pathOrigins,
      originalsByOrigin,
      updatesByOrigin,
      fieldOrder: input.settings.frontmatterFieldOrder,
      stringifyYaml: input.stringifyYaml,
    });
    results.push(applied);
  }

  return {
    results,
    documents: [...updatesByOrigin.values()],
  };
}

export function buildLegacyPatchRestoreCandidates(
  input: BuildLegacyPatchRestoreCandidatesInput
): PatchRestoreCandidate[] {
  const byFile = new Map<string, PatchManifestEntry>();
  for (const change of input.manifest.changes ?? []) {
    byFile.set(pathKey(change.file), change);
  }

  const backupsByFile = new Map<string, LegacyPatchRestoreBackupDocument>();
  for (const backup of input.backupDocuments) {
    backupsByFile.set(pathKey(backup.file), backup);
  }

  const candidates: PatchRestoreCandidate[] = [];
  let seq = 0;

  for (let opIndex = 0; opIndex < input.patchFile.operations.length; opIndex += 1) {
    const op = input.patchFile.operations[opIndex];
    const target = op.target ? normalisePath(op.target) : null;
    if (!target) continue;

    const manifestChange = byFile.get(pathKey(target));
    const backup = backupsByFile.get(pathKey(target));
    if (!manifestChange || !backup) continue;

    const change = synthesizeLegacyPatchOperationChange(op, {
      manifestChange,
      filePath: target,
      beforeFrontmatter: backup.frontmatter,
      seq: ++seq,
      opIndex,
    });
    if (!change) continue;

    const evaluated = evaluatePatchRestoreOperation(input.currentDocuments, change);
    candidates.push({
      operation: change,
      status: evaluated.status,
      reason: `Reconstructed from legacy manifest: ${evaluated.reason}`,
      selected: evaluated.status === "reversible",
    });
  }

  return candidates;
}

export function synthesizeLegacyPatchOperationChange(
  op: PatchOperation,
  options: {
    manifestChange: PatchManifestEntry;
    filePath: string;
    beforeFrontmatter: Record<string, unknown>;
    seq: number;
    opIndex: number;
  }
): PatchOperationChange | null {
  const id = `legacy-op-${String(options.seq).padStart(5, "0")}`;
  const normalizedFile = normalisePath(options.filePath);
  const backup = options.manifestChange.backup;

  switch (op.op) {
    case "set_field": {
      if (!op.field) return null;
      if (!Object.prototype.hasOwnProperty.call(op, "value") || op.value === undefined) return null;
      const before = valueFromFrontmatter(options.beforeFrontmatter, op.field);
      const after: PatchRestoreValue = { exists: true, value: op.value };
      return {
        id,
        op_index: options.opIndex,
        op: op.op,
        file_before: normalizedFile,
        file_after: normalizedFile,
        status: "changed",
        label: `${op.op} ${op.field}`,
        target: { kind: "frontmatter_field", field: op.field },
        before,
        after,
        reverse: {
          kind: "set_field",
          field: op.field,
          value: before.exists ? before.value : undefined,
          delete_if_missing_before: !before.exists,
        },
        backup,
      };
    }
    case "remove_field": {
      if (!op.field) return null;
      const before = valueFromFrontmatter(options.beforeFrontmatter, op.field);
      return {
        id,
        op_index: options.opIndex,
        op: op.op,
        file_before: normalizedFile,
        file_after: normalizedFile,
        status: "changed",
        label: `${op.op} ${op.field}`,
        target: { kind: "frontmatter_field", field: op.field },
        before,
        after: { exists: false },
        reverse: {
          kind: "set_field",
          field: op.field,
          value: before.exists ? before.value : undefined,
          delete_if_missing_before: !before.exists,
        },
        backup,
      };
    }
    case "add_tag":
    case "remove_tag":
    case "replace_tag":
    case "normalize_tags": {
      const beforeTags = normalizeTags(getTags(options.beforeFrontmatter));
      const afterTags = synthesizeLegacyTagsAfter(op, beforeTags);
      if (!afterTags) return null;
      return {
        id,
        op_index: options.opIndex,
        op: op.op,
        file_before: normalizedFile,
        file_after: normalizedFile,
        status: "changed",
        label: op.op,
        target: { kind: "frontmatter_tags" },
        before: { exists: true, value: beforeTags },
        after: { exists: true, value: afterTags },
        reverse: { kind: "set_tags", value: beforeTags },
        backup,
      };
    }
    default:
      return null;
  }
}

interface ApplyReverseOperationContext {
  operation: PatchOperationChange;
  documentsByPath: Map<string, ForgeDocument>;
  pathOrigins: Map<string, string>;
  originalsByOrigin: Map<string, ForgeDocument>;
  updatesByOrigin: Map<string, PatchDocumentUpdate>;
  fieldOrder: string[];
  stringifyYaml: ForgeYamlStringifier;
}

function applyReverseOperation(context: ApplyReverseOperationContext): PatchRestoreApplyResult {
  const { operation } = context;

  try {
    switch (operation.reverse.kind) {
      case "set_field": {
        const document = getDocument(context.documentsByPath, operation.file_after);
        if (!document) return restoreResult(operation, "error", "Current file is missing");

        const frontmatter = cloneRecord(document.frontmatter);
        if (operation.reverse.delete_if_missing_before) {
          delete frontmatter[operation.reverse.field];
        } else {
          frontmatter[operation.reverse.field] = cloneValue(operation.reverse.value);
        }

        updateDocument(context, document, updateFrontmatterDocument(document, frontmatter, context));
        return restoreResult(operation, "restored", "Field restored");
      }
      case "set_tags": {
        const document = getDocument(context.documentsByPath, operation.file_after);
        if (!document) return restoreResult(operation, "error", "Current file is missing");

        const frontmatter = cloneRecord(document.frontmatter);
        setTags(frontmatter, operation.reverse.value);
        updateDocument(context, document, updateFrontmatterDocument(document, frontmatter, context));
        return restoreResult(operation, "restored", "Tags restored");
      }
      case "set_frontmatter_order": {
        const document = getDocument(context.documentsByPath, operation.file_after);
        if (!document) return restoreResult(operation, "error", "Current file is missing");

        const frontmatter = sortFrontmatterFields(document.frontmatter, operation.reverse.keys);
        updateDocument(context, document, updateFrontmatterDocument(document, frontmatter, context, false));
        return restoreResult(operation, "restored", "Frontmatter order restored");
      }
      case "move_note": {
        const from = normalisePath(operation.reverse.from);
        const to = normalisePath(operation.reverse.to);
        const document = getDocument(context.documentsByPath, from);
        if (!document) return restoreResult(operation, "error", "Moved note is missing");
        if (getDocument(context.documentsByPath, to)) {
          return restoreResult(operation, "conflicted", "Original path is occupied");
        }

        updateDocument(context, document, updatePath(document, to));
        return restoreResult(operation, "restored", "Note moved back");
      }
    }
  } catch (error) {
    return restoreResult(operation, "error", formatError(error));
  }
}

function updateFrontmatterDocument(
  document: ForgeDocument,
  frontmatter: Record<string, unknown>,
  context: Pick<ApplyReverseOperationContext, "fieldOrder" | "stringifyYaml">,
  sortFields = true
): ForgeDocument {
  const sorted = sortFields ? sortFrontmatterFields(frontmatter, context.fieldOrder) : frontmatter;
  return {
    ...document,
    content: renderMarkdownDocument(sorted, documentBody(document), context.stringifyYaml),
    frontmatter: sorted,
    hasFrontmatter: true,
  };
}

function updatePath(document: ForgeDocument, path: string): ForgeDocument {
  const normalizedPath = normalisePath(path);
  const { basename, extension } = parsePathParts(normalizedPath);
  return {
    ...document,
    path: normalizedPath,
    basename,
    extension,
  };
}

function updateDocument(
  context: Pick<
    ApplyReverseOperationContext,
    "documentsByPath" | "pathOrigins" | "originalsByOrigin" | "updatesByOrigin"
  >,
  previous: ForgeDocument,
  next: ForgeDocument
): void {
  const previousKey = pathKey(previous.path);
  const nextKey = pathKey(next.path);
  const originPath = context.pathOrigins.get(previousKey) ?? previous.path;
  const originKey = pathKey(originPath);
  const original = context.originalsByOrigin.get(originKey) ?? previous;

  context.documentsByPath.delete(previousKey);
  context.documentsByPath.set(nextKey, next);
  context.pathOrigins.delete(previousKey);
  context.pathOrigins.set(nextKey, originPath);
  context.updatesByOrigin.set(originKey, {
    pathBefore: originPath,
    pathAfter: next.path,
    contentBefore: original.content,
    contentAfter: next.content,
  });
}

function nonReversibleResult(
  operation: PatchOperationChange,
  evaluated: { status: PatchRestoreStatus; reason: string }
): PatchRestoreApplyResult {
  if (evaluated.status === "already_restored") return restoreResult(operation, "skipped", evaluated.reason);
  if (evaluated.status === "conflicted") return restoreResult(operation, "conflicted", evaluated.reason);
  return restoreResult(operation, "error", evaluated.reason);
}

function compareCurrentToManifest(
  current: PatchRestoreValue,
  before: PatchRestoreValue,
  after: PatchRestoreValue
): { status: PatchRestoreStatus; reason: string } {
  if (sameRestoreValue(current, after)) {
    return { status: "reversible", reason: "Current value still matches patch output" };
  }
  if (sameRestoreValue(current, before)) {
    return { status: "already_restored", reason: "Value already matches pre-patch state" };
  }
  return { status: "conflicted", reason: "Current value changed after patch apply" };
}

function synthesizeLegacyTagsAfter(op: PatchFile["operations"][number], beforeTags: string[]): string[] | null {
  switch (op.op) {
    case "add_tag":
      return op.tag ? normalizeTags(addTag(beforeTags, op.tag)) : null;
    case "remove_tag":
      return op.tag ? normalizeTags(removeTag(beforeTags, op.tag)) : null;
    case "replace_tag":
      return op.old_tag && op.new_tag
        ? normalizeTags(replaceTag(beforeTags, op.old_tag, op.new_tag))
        : null;
    case "normalize_tags":
      return normalizeTags(beforeTags);
    default:
      return null;
  }
}

function restoreResult(
  operation: PatchOperationChange,
  status: PatchRestoreApplyResult["status"],
  detail: string
): PatchRestoreApplyResult {
  return { operation, status, detail };
}

function valueFromFrontmatter(frontmatter: Record<string, unknown>, field: string): PatchRestoreValue {
  return Object.prototype.hasOwnProperty.call(frontmatter, field)
    ? { exists: true, value: cloneValue(frontmatter[field]) }
    : { exists: false };
}

function restoreValue(value: unknown): PatchRestoreValue {
  return value === undefined ? { exists: false } : { exists: true, value: cloneValue(value) };
}

function normalizeManifestArray(value: PatchRestoreValue): PatchRestoreValue {
  if (!value.exists || !Array.isArray(value.value)) return value;
  return { exists: true, value: normalizeTags(value.value.map((item) => String(item))) };
}

function sameRestoreValue(a: PatchRestoreValue, b: PatchRestoreValue): boolean {
  if (a.exists !== b.exists) return false;
  if (!a.exists && !b.exists) return true;
  if (!a.exists || !b.exists) return false;
  return stableStringify(a.value) === stableStringify(b.value);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function findDocumentByPath(documents: ForgeDocument[], path: string): ForgeDocument | null {
  const key = pathKey(path);
  return documents.find((document) => pathKey(document.path) === key) ?? null;
}

function getDocument(documentsByPath: Map<string, ForgeDocument>, path: string): ForgeDocument | null {
  return documentsByPath.get(pathKey(path)) ?? null;
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

function cloneDocument(document: ForgeDocument): ForgeDocument {
  return {
    ...document,
    frontmatter: cloneRecord(document.frontmatter),
  };
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return cloneValue(record);
}

function cloneValue<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
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

function pathKey(path: string): string {
  return normalisePath(path).toLowerCase();
}

function isManifestChange(value: unknown): value is PatchManifestEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.file === "string" && typeof candidate.backup === "string";
}

function isPatchOperationChange(value: unknown): value is PatchOperationChange {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string"
    && typeof candidate.op_index === "number"
    && typeof candidate.op === "string"
    && typeof candidate.file_before === "string"
    && typeof candidate.file_after === "string"
    && candidate.status === "changed"
    && typeof candidate.label === "string"
    && typeof candidate.target === "object"
    && candidate.target !== null
    && typeof candidate.before === "object"
    && candidate.before !== null
    && typeof candidate.after === "object"
    && candidate.after !== null
    && typeof candidate.reverse === "object"
    && candidate.reverse !== null;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
