import type { ForgeDocument } from "./lint.js";
import { getVaultPaths, localTimestamp, normalisePath, todayString } from "./paths.js";
import type { ForgeSettings } from "./settings.js";
import {
  buildShapeHeadingCacheFromTemplates,
  buildTemplateTree,
  type ForgeShapeTemplate,
  type ParsedHeading,
  type TemplateNode,
} from "./shape-lint.js";

interface DocSection {
  headingText: string;
  headingLevel: number;
  headingLine: string;
  contentLines: string[];
  children: DocSection[];
}

export type ShapeRepairFileStatus = "repaired" | "skipped" | "dry_run" | "error";

export interface ShapeRepairFileResult {
  path: string;
  status: ShapeRepairFileStatus;
  operations: string[];
  detail: string;
  backupPath?: string;
}

export interface ShapeRepairRunResult {
  ranAt: string;
  dryRun: boolean;
  repaired: number;
  skipped: number;
  errors: number;
  files: ShapeRepairFileResult[];
}

export interface ShapeRepairHistoryEntry {
  ranAt: string;
  dryRun: boolean;
  repaired: number;
  skipped: number;
  errors: number;
  files: ShapeRepairFileResult[];
}

export interface ShapeRepairContentResult {
  repairedContent: string;
  descriptions: string[];
}

export interface ShapeRepairDocumentResult {
  file: ShapeRepairFileResult;
  contentBefore?: string;
  contentAfter?: string;
}

export interface ShapeRepairDocumentUpdate {
  path: string;
  contentBefore: string;
  contentAfter: string;
  operations: string[];
}

export interface RepairShapeDocumentInput {
  document: ForgeDocument;
  settings: ForgeSettings;
  headingCache: Map<string, ParsedHeading[]>;
  dryRun?: boolean;
}

export interface PlanShapeRepairForDocumentsInput {
  documents: ForgeDocument[];
  templates: ForgeShapeTemplate[];
  settings: ForgeSettings;
  dryRun?: boolean;
  timestamp?: string;
}

export interface ShapeRepairPlanResult {
  run: ShapeRepairRunResult;
  updates: ShapeRepairDocumentUpdate[];
}

export interface ShapeRepairRunNoteArtifact {
  folder: string;
  path: string;
  content: string;
}

export function planShapeRepairForDocuments(
  input: PlanShapeRepairForDocumentsInput
): ShapeRepairPlanResult {
  const dryRun = input.dryRun ?? false;
  const headingCache = buildShapeHeadingCacheFromTemplates(input.templates);
  const files: ShapeRepairFileResult[] = [];
  const updates: ShapeRepairDocumentUpdate[] = [];
  let repaired = 0;
  let skipped = 0;
  let errors = 0;

  if (headingCache.size > 0) {
    const documents = uniqueMarkdownDocuments(input.documents)
      .filter((document) => isInShapeRepairScope(document, input.settings));

    for (const document of documents) {
      const result = repairShapeDocument({
        document,
        settings: input.settings,
        headingCache,
        dryRun,
      });
      files.push(result.file);

      if (result.file.status === "repaired" || result.file.status === "dry_run") {
        repaired += 1;
      } else if (result.file.status === "skipped") {
        skipped += 1;
      } else {
        errors += 1;
      }

      if (
        result.file.status === "repaired" &&
        result.contentBefore !== undefined &&
        result.contentAfter !== undefined
      ) {
        updates.push({
          path: result.file.path,
          contentBefore: result.contentBefore,
          contentAfter: result.contentAfter,
          operations: result.file.operations,
        });
      }
    }
  }

  return {
    run: {
      ranAt: input.timestamp ?? localTimestamp(),
      dryRun,
      repaired,
      skipped,
      errors,
      files,
    },
    updates,
  };
}

export function repairShapeDocument(input: RepairShapeDocumentInput): ShapeRepairDocumentResult {
  const { document, settings, headingCache } = input;
  const dryRun = input.dryRun ?? false;

  try {
    if (!document.hasFrontmatter) return { file: skip(document.path, "No frontmatter") };

    const typeValue = document.frontmatter[settings.shapeTypeTargetField];
    if (!typeValue || typeof typeValue !== "string") {
      return { file: skip(document.path, "No type target field") };
    }

    const shapeName = typeValue.trim().toLowerCase();
    const templateHeadings = headingCache.get(shapeName);
    if (!templateHeadings || templateHeadings.length === 0) {
      return { file: skip(document.path, "No matching template") };
    }

    const { repairedContent, descriptions } = applyShapeRepair(document.content, templateHeadings);
    if (descriptions.length === 0) return { file: skip(document.path, "Already conforms") };

    const file: ShapeRepairFileResult = {
      path: document.path,
      status: dryRun ? "dry_run" : "repaired",
      operations: descriptions,
      detail: dryRun
        ? `${descriptions.length} operation(s) would be applied`
        : `${descriptions.length} operation(s) applied`,
    };

    return {
      file,
      contentBefore: document.content,
      contentAfter: repairedContent,
    };
  } catch (error) {
    return {
      file: {
        path: document.path,
        status: "error",
        operations: [],
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function applyShapeRepair(
  content: string,
  templateHeadings: ParsedHeading[]
): ShapeRepairContentResult {
  const lines = content.split("\n");
  const { frontmatterLines, bodyLines } = splitFrontmatterLines(lines);

  const templateRoots = buildTemplateTree(templateHeadings);
  const { roots: docRoots, leadingLines } = buildDocTree(bodyLines);
  const descriptions: string[] = [];
  const repairedRoots = repairLevel(templateRoots, docRoots, descriptions);
  const repairedBody = [
    ...leadingLines,
    ...serializeSections(repairedRoots),
  ];

  return {
    repairedContent: [...frontmatterLines, ...repairedBody].join("\n"),
    descriptions,
  };
}

export function buildShapeRepairHistoryEntry(run: ShapeRepairRunResult): ShapeRepairHistoryEntry {
  return {
    ranAt: run.ranAt,
    dryRun: run.dryRun,
    repaired: run.repaired,
    skipped: run.skipped,
    errors: run.errors,
    files: run.files.filter((file) => file.status !== "skipped"),
  };
}

export function buildShapeRepairHistoryContent(
  existingContent: string | null | undefined,
  run: ShapeRepairRunResult,
  retentionCount = 20
): string {
  let history = parseShapeRepairHistory(existingContent);
  history.push(buildShapeRepairHistoryEntry(run));

  const max = Math.max(0, retentionCount);
  if (history.length > max) history = history.slice(history.length - max);

  return JSON.stringify(history, null, 2);
}

export function buildShapeRepairRunNoteArtifact(
  settings: ForgeSettings,
  run: ShapeRepairRunResult,
  today = todayString()
): ShapeRepairRunNoteArtifact {
  const runsFolder = normalisePath(settings.shapeRepairRunsFolder || getVaultPaths(settings).exports);
  const safeTs = run.ranAt.replace(/[:.]/g, "-").replace("T", "_").replace(/\s/g, "_");
  return {
    folder: runsFolder,
    path: normalisePath(`${runsFolder}/shape-repair-${safeTs}.md`),
    content: buildShapeRepairRunNote(run, today, settings.shapeRepairFileLinks ?? false),
  };
}

export function buildShapeRepairRunNote(
  run: ShapeRepairRunResult,
  today: string,
  fileLinks: boolean
): string {
  const dryLabel = run.dryRun ? " (Dry Run)" : "";
  const lines: string[] = [
    "---",
    "type: reference",
    "status: complete",
    "tags:",
    "  - meta/shape-repair",
    `created: ${today}`,
    `updated: ${today}`,
    "ai_private: false",
    "review_cycle: never",
    "---",
    "",
    `runtime:: ${run.ranAt}`,
    `dry_run:: ${run.dryRun}`,
    `repaired:: ${run.repaired}`,
    `skipped:: ${run.skipped}`,
    `errors:: ${run.errors}`,
    "",
    `# Shape Repair Run${dryLabel}`,
    "",
    "## Summary",
    "",
    "| Status | Count |",
    "|--------|-------|",
    `| ✅ Repaired${run.dryRun ? " (would)" : ""} | ${run.repaired} |`,
    `| ⏭️ Skipped  | ${run.skipped}   |`,
    `| 🔴 Errors   | ${run.errors}    |`,
    "",
  ];

  const touched = run.files.filter((file) => file.status === "repaired" || file.status === "dry_run");
  const errored = run.files.filter((file) => file.status === "error");

  if (touched.length > 0) {
    lines.push(`## ${run.dryRun ? "Would Repair" : "Repaired"}`, "");
    for (const file of touched) {
      const ref = fileLinks ? `[[${file.path}]]` : `\`${file.path}\``;
      lines.push(`### ${ref}`, "");
      for (const operation of file.operations) lines.push(`- ${operation}`);
      lines.push("");
    }
  }

  if (errored.length > 0) {
    lines.push("## Errors", "");
    for (const file of errored) {
      const ref = fileLinks ? `[[${file.path}]]` : `\`${file.path}\``;
      lines.push(`- ${ref}: ${file.detail}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function buildDocTree(bodyLines: string[]): { roots: DocSection[]; leadingLines: string[] } {
  const headings = extractHeadingsFromLines(bodyLines);
  const flatSections: DocSection[] = [];

  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index];
    const nextSameOrHigher = headings.slice(index + 1).find((next) => next.level <= heading.level);
    const sectionEnd = nextSameOrHigher ? nextSameOrHigher.lineIndex : bodyLines.length;
    const firstChildHeading = headings.slice(index + 1).find(
      (next) => next.lineIndex < sectionEnd && next.level > heading.level
    );
    const contentEnd = firstChildHeading ? firstChildHeading.lineIndex : sectionEnd;
    const contentLines = bodyLines.slice(heading.lineIndex + 1, contentEnd);

    flatSections.push({
      headingText: heading.text,
      headingLevel: heading.level,
      headingLine: bodyLines[heading.lineIndex],
      contentLines,
      children: [],
    });
  }

  const roots: DocSection[] = [];
  const stack: DocSection[] = [];

  for (const section of flatSections) {
    while (stack.length > 0 && stack[stack.length - 1].headingLevel >= section.headingLevel) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(section);
    } else {
      stack[stack.length - 1].children.push(section);
    }

    stack.push(section);
  }

  const firstHeadingLine = headings.length > 0 ? headings[0].lineIndex : bodyLines.length;
  const leadingLines = bodyLines.slice(0, firstHeadingLine);

  return { roots, leadingLines };
}

function repairLevel(
  templateNodes: TemplateNode[],
  docSections: DocSection[],
  descriptions: string[],
  parentText?: string
): DocSection[] {
  const result: DocSection[] = [];
  const consumed = new Set<DocSection>();

  for (const templateNode of templateNodes) {
    const match = docSections.find(
      (section) =>
        !consumed.has(section) &&
        section.headingText.toLowerCase() === templateNode.text.toLowerCase() &&
        section.headingLevel === templateNode.level
    );

    if (match) {
      consumed.add(match);
      const repairedChildren = repairLevel(templateNode.children, match.children, descriptions, templateNode.text);
      result.push({ ...match, children: repairedChildren });
    } else {
      const prefix = "#".repeat(templateNode.level);
      const context = parentText ? ` (under '${parentText}')` : "";
      descriptions.push(`Insert missing heading: '${prefix} ${templateNode.text}'${context}`);

      const newSection: DocSection = {
        headingText: templateNode.text,
        headingLevel: templateNode.level,
        headingLine: `${prefix} ${templateNode.text}`,
        contentLines: [""],
        children: [],
      };

      newSection.children = repairLevel(templateNode.children, [], descriptions, templateNode.text);
      result.push(newSection);
    }
  }

  const unknowns = docSections.filter((section) => !consumed.has(section));
  for (const unknown of unknowns) {
    result.push({
      ...unknown,
      children: repairLevel([], unknown.children, descriptions, unknown.headingText),
    });
  }

  const originalOrder = docSections
    .filter((section) => consumed.has(section))
    .map((section) => section.headingText.toLowerCase());
  const expectedOrder = originalOrder.length > 0
    ? templateNodes
      .map((templateNode) => templateNode.text.toLowerCase())
      .filter((text) => originalOrder.includes(text))
    : [];

  if (originalOrder.length > 1 && !arraysEqualOrder(originalOrder, expectedOrder)) {
    const context = parentText ? ` within '${parentText}'` : "";
    descriptions.push(
      `Reorder headings${context}: ${expectedOrder.map((text) => `'${text}'`).join(" → ")}`
    );
  }

  return result;
}

function serializeSections(sections: DocSection[]): string[] {
  const lines: string[] = [];
  for (const section of sections) {
    lines.push(section.headingLine);
    lines.push(...section.contentLines);
    lines.push(...serializeSections(section.children));
  }
  return lines;
}

function splitFrontmatterLines(lines: string[]): {
  frontmatterLines: string[];
  bodyLines: string[];
} {
  if (lines[0]?.trim() !== "---") return { frontmatterLines: [], bodyLines: lines };

  let closingIndex = -1;
  for (let index = 1; index < lines.length; index++) {
    if (lines[index].trim() === "---") {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex === -1) return { frontmatterLines: [], bodyLines: lines };
  return {
    frontmatterLines: lines.slice(0, closingIndex + 1),
    bodyLines: lines.slice(closingIndex + 1),
  };
}

function extractHeadingsFromLines(lines: string[]): ParsedHeading[] {
  const headings: ParsedHeading[] = [];
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^(#{1,6})\s+(.+)$/);
    if (match) headings.push({ level: match[1].length, text: match[2].trim(), lineIndex: index });
  }
  return headings;
}

function uniqueMarkdownDocuments(documents: ForgeDocument[]): ForgeDocument[] {
  const seen = new Set<string>();
  const unique: ForgeDocument[] = [];

  for (const document of documents) {
    const path = normalisePath(document.path);
    if (document.extension.toLowerCase() !== "md" || seen.has(path)) continue;
    seen.add(path);
    unique.push({ ...document, path });
  }

  return unique;
}

function isInShapeRepairScope(document: ForgeDocument, settings: ForgeSettings): boolean {
  if (settings.shapeRepairScope !== "folder") return true;

  const folders = settings.shapeRepairFolders ?? [];
  if (folders.length === 0) return false;

  const path = normalisePath(document.path).toLowerCase();
  const prefixes = folders.map((folder) => `${normalisePath(folder).toLowerCase().replace(/\/+$/, "")}/`);
  return prefixes.some((prefix) => path.startsWith(prefix));
}

function parseShapeRepairHistory(content: string | null | undefined): ShapeRepairHistoryEntry[] {
  if (!content) return [];

  try {
    const parsed = JSON.parse(content) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isShapeRepairHistoryEntry) : [];
  } catch {
    return [];
  }
}

function isShapeRepairHistoryEntry(value: unknown): value is ShapeRepairHistoryEntry {
  return typeof value === "object" && value !== null;
}

function arraysEqualOrder(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function skip(path: string, detail: string): ShapeRepairFileResult {
  return { path, status: "skipped", operations: [], detail };
}
