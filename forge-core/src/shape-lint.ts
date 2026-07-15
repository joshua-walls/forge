import type { ForgeSettings } from "./settings.js";
import { buildShapeLintExemptList, isExempt, localTimestamp, normalisePath } from "./paths.js";
import type { ForgeDocument, ForgeRange, LintResult, LintRunEnvelope, LintSeverity } from "./lint.js";

export interface ParsedHeading {
  level: number;
  text: string;
  lineIndex: number;
}

export interface TemplateNode {
  text: string;
  level: number;
  children: TemplateNode[];
}

export interface ForgeShapeTemplate {
  shape: string;
  path?: string;
  content?: string;
  headings?: ParsedHeading[];
}

export interface RunShapeLintForDocumentsInput {
  documents: ForgeDocument[];
  templates: ForgeShapeTemplate[];
  settings: ForgeSettings;
  exemptPaths?: string[];
  schemaVersion?: string;
  vaultPath?: string;
  timestamp?: string;
}

export interface ShapeLintRunResult {
  envelope: LintRunEnvelope;
  results: LintResult[];
  errors: LintResult[];
  warnings: LintResult[];
  infos: LintResult[];
}

export function runShapeLintForDocuments(input: RunShapeLintForDocumentsInput): ShapeLintRunResult {
  const { documents, settings } = input;
  const exemptPaths = buildShapeLintExemptList(settings, input.exemptPaths ?? []);
  const candidateDocuments = uniqueMarkdownDocuments(documents).filter(
    (document) => !isExempt(document.path, exemptPaths)
  );
  const headingCache = buildShapeHeadingCacheFromTemplates(input.templates);
  const results: LintResult[] = [];

  if (settings.shapeLintEnabled && headingCache.size > 0) {
    for (const document of candidateDocuments) {
      results.push(...lintShapeHeadingsForDocument(document, settings, headingCache));
    }
  }

  return {
    envelope: {
      vault_path: input.vaultPath ?? "",
      timestamp: input.timestamp ?? localTimestamp(),
      schema_version: input.schemaVersion ?? "",
      notes_scanned: candidateDocuments.length,
    },
    results,
    errors: results.filter((result) => result.severity === "error"),
    warnings: results.filter((result) => result.severity === "warning"),
    infos: results.filter((result) => result.severity === "info"),
  };
}

export function buildShapeHeadingCacheFromTemplates(
  templates: ForgeShapeTemplate[]
): Map<string, ParsedHeading[]> {
  const cache = new Map<string, ParsedHeading[]>();

  for (const template of templates) {
    const shape = template.shape.trim().toLowerCase();
    if (!shape) continue;

    const headings = template.headings ?? extractHeadings(template.content ?? "");
    if (headings.length === 0) continue;

    cache.set(shape, headings);
  }

  return cache;
}

export function collectShapeTemplatesFromDocuments(
  documents: ForgeDocument[],
  templatesFolder: string
): ForgeShapeTemplate[] {
  const normalizedFolder = normalisePath(templatesFolder).replace(/\/+$/, "");
  if (!normalizedFolder) return [];

  const folderPrefix = `${normalizedFolder}/`;

  return documents
    .filter((document) => {
      const path = normalisePath(document.path);
      return document.extension.toLowerCase() === "md" &&
        path.startsWith(folderPrefix) &&
        document.basename.startsWith("Template, ");
    })
    .map((document) => ({
      shape: templateFileToShapeName(document.basename),
      path: document.path,
      content: document.content,
    }));
}

export function collectShapeNamesFromDocuments(
  documents: ForgeDocument[],
  shapesFolder: string
): string[] {
  const normalizedFolder = normalisePath(shapesFolder).replace(/\/+$/, "");
  if (!normalizedFolder) return [];

  const folderPrefix = `${normalizedFolder}/`;
  const seen = new Set<string>();
  const shapes: string[] = [];

  for (const document of documents) {
    const path = normalisePath(document.path);
    if (document.extension.toLowerCase() !== "md" || !path.startsWith(folderPrefix)) continue;

    const shape = document.basename.trim();
    const key = shape.toLowerCase();
    if (!shape || seen.has(key)) continue;

    seen.add(key);
    shapes.push(shape);
  }

  return shapes;
}

export function lintShapeHeadingsForDocument(
  document: ForgeDocument,
  settings: ForgeSettings,
  headingCache: Map<string, ParsedHeading[]>
): LintResult[] {
  const results: LintResult[] = [];
  const strict = settings.lintStrictMode;
  const flagExtraHeadings = settings.shapeLintStrictMode;
  const allowEmptySections = settings.shapeLintAllowEmptySections;

  if (!document.hasFrontmatter) return results;

  const typeValue = document.frontmatter[settings.shapeTypeTargetField];
  if (!typeValue || typeof typeValue !== "string") return results;

  if (settings.shapeLintScope === "folder") {
    const folders = settings.shapeLintFolders ?? [];
    if (folders.length > 0) {
      const prefixes = folders.map((folder) => folder.toLowerCase().replace(/\/?$/, "/"));
      if (!prefixes.some((prefix) => document.path.toLowerCase().startsWith(prefix))) return results;
    }
  }

  const shapeName = typeValue.trim().toLowerCase();
  const templateHeadings = headingCache.get(shapeName);
  if (!templateHeadings || templateHeadings.length === 0) return results;

  const lines = document.content.split("\n");
  const { bodyLines, bodyStartLineIndex } = splitFrontmatter(lines);
  const templateRoots = buildTemplateTree(templateHeadings);
  const { roots: docRoots } = buildDocSectionTree(bodyLines, bodyStartLineIndex);
  const documentRange = rangeForLine(lines, 0);

  lintLevel(
    templateRoots,
    docRoots,
    document.path,
    typeValue,
    strict,
    flagExtraHeadings,
    allowEmptySections,
    results,
    null,
    documentRange
  );

  return results;
}

export function buildTemplateTree(headings: ParsedHeading[]): TemplateNode[] {
  const roots: TemplateNode[] = [];
  const stack: TemplateNode[] = [];

  for (const heading of headings) {
    const node: TemplateNode = { text: heading.text, level: heading.level, children: [] };

    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }

    stack.push(node);
  }

  return roots;
}

export function flattenTemplateTree(nodes: TemplateNode[]): TemplateNode[] {
  const result: TemplateNode[] = [];
  const visit = (node: TemplateNode) => {
    result.push(node);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return result;
}

export function extractHeadings(content: string): ParsedHeading[] {
  const lines = content.split("\n");
  const headings: ParsedHeading[] = [];
  let inFrontmatter = false;
  let frontmatterDone = false;
  let lineIndex = 0;

  for (const line of lines) {
    if (!frontmatterDone) {
      if (lineIndex === 0 && line.trim() === "---") {
        inFrontmatter = true;
        lineIndex++;
        continue;
      }
      if (inFrontmatter && line.trim() === "---") {
        inFrontmatter = false;
        frontmatterDone = true;
        lineIndex++;
        continue;
      }
      if (inFrontmatter) {
        lineIndex++;
        continue;
      }
      frontmatterDone = true;
    }

    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      headings.push({ level: match[1].length, text: match[2].trim(), lineIndex });
    }

    lineIndex++;
  }

  return headings;
}

export function templateFileToShapeName(basename: string): string {
  return basename.replace(/^Template,\s*/i, "").trim().toLowerCase();
}

interface DocSection {
  headingText: string;
  headingLevel: number;
  range: ForgeRange;
  contentLines: string[];
  children: DocSection[];
}

function lintLevel(
  templateNodes: TemplateNode[],
  docSections: DocSection[],
  filePath: string,
  typeValue: string,
  strict: boolean,
  flagExtraHeadings: boolean,
  allowEmptySections: boolean,
  results: LintResult[],
  parentText: string | null,
  fallbackRange: ForgeRange
): void {
  const consumed = new Set<DocSection>();

  for (const templateNode of templateNodes) {
    const match = docSections.find(
      (section) =>
        !consumed.has(section) &&
        section.headingText.toLowerCase() === templateNode.text.toLowerCase() &&
        section.headingLevel === templateNode.level
    );

    if (!match) {
      const prefix = "#".repeat(templateNode.level);
      const ctx = parentText ? ` under '${parentText}'` : "";
      results.push(newResult(
        filePath,
        strict ? "error" : "warning",
        "shape_heading_missing",
        `Missing heading: '${prefix} ${templateNode.text}'${ctx} (required by shape '${typeValue}')`,
        fallbackRange
      ));
    } else {
      consumed.add(match);

      if (!allowEmptySections && !sectionHasMeaningfulContent(match)) {
        results.push(newResult(
          filePath,
          strict ? "warning" : "info",
          "shape_section_empty",
          `Section '${match.headingText}' is empty (required by shape '${typeValue}')`,
          match.range
        ));
      }

      lintLevel(
        templateNode.children,
        match.children,
        filePath,
        typeValue,
        strict,
        flagExtraHeadings,
        allowEmptySections,
        results,
        templateNode.text,
        match.range
      );
    }
  }

  const docOrder = docSections
    .filter((section) => consumed.has(section))
    .map((section) => section.headingText.toLowerCase());

  const expectedOrder = templateNodes
    .map((templateNode) => templateNode.text.toLowerCase())
    .filter((text) => docOrder.includes(text));

  if (!arraysEqualOrder(docOrder, expectedOrder) && expectedOrder.length > 1) {
    const ctx = parentText ? ` within '${parentText}'` : "";
    const orderRange = docSections.find((section) => consumed.has(section))?.range ?? fallbackRange;
    results.push(newResult(
      filePath,
      strict ? "error" : "warning",
      "shape_heading_order",
      `Headings out of order${ctx} for shape '${typeValue}'. ` +
      `Expected: ${expectedOrder.map((text) => `'${text}'`).join(" → ")}`,
      orderRange
    ));
  }

  if (!flagExtraHeadings) return;

  const unknowns = docSections.filter((section) => !consumed.has(section));
  for (const unknown of unknowns) {
    const severity: LintSeverity = unknown.headingLevel === 1
      ? strict ? "error" : "warning"
      : strict ? "warning" : "info";
    const ctx = parentText ? ` under '${parentText}'` : "";
    results.push(newResult(
      filePath,
      severity,
      "shape_heading_extra",
      `Extra heading: '${unknown.headingText}'${ctx} (not in shape '${typeValue}' template)`,
      unknown.range
    ));

    lintLevel(
      [],
      unknown.children,
      filePath,
      typeValue,
      strict,
      flagExtraHeadings,
      allowEmptySections,
      results,
      unknown.headingText,
      unknown.range
    );
  }
}

function buildDocSectionTree(bodyLines: string[], bodyStartLineIndex: number): { roots: DocSection[] } {
  const headings = extractHeadingsFromLines(bodyLines);
  const flatSections: DocSection[] = [];

  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index];
    const nextHeading = headings[index + 1];
    const contentEnd = nextHeading ? nextHeading.lineIndex : bodyLines.length;
    const contentLines = bodyLines.slice(heading.lineIndex + 1, contentEnd);

    flatSections.push({
      headingText: heading.text,
      headingLevel: heading.level,
      range: rangeForLine(bodyLines, heading.lineIndex, bodyStartLineIndex),
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

  return { roots };
}

function extractHeadingsFromLines(lines: string[]): ParsedHeading[] {
  const headings: ParsedHeading[] = [];
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^(#{1,6})\s+(.+)$/);
    if (match) headings.push({ level: match[1].length, text: match[2].trim(), lineIndex: index });
  }
  return headings;
}

function splitFrontmatter(lines: string[]): {
  frontmatterLines: string[];
  bodyLines: string[];
  bodyStartLineIndex: number;
} {
  if (lines[0]?.trim() !== "---") return { frontmatterLines: [], bodyLines: lines, bodyStartLineIndex: 0 };
  let closingIndex = -1;
  for (let index = 1; index < lines.length; index++) {
    if (lines[index].trim() === "---") {
      closingIndex = index;
      break;
    }
  }
  if (closingIndex === -1) return { frontmatterLines: [], bodyLines: lines, bodyStartLineIndex: 0 };
  return {
    frontmatterLines: lines.slice(0, closingIndex + 1),
    bodyLines: lines.slice(closingIndex + 1),
    bodyStartLineIndex: closingIndex + 1,
  };
}

function rangeForLine(lines: string[], lineIndex: number, lineOffset = 0): ForgeRange {
  const boundedLine = Math.max(0, Math.min(lineIndex, Math.max(0, lines.length - 1)));
  const absoluteLine = lineOffset + boundedLine;
  return {
    start: { line: absoluteLine, character: 0 },
    end: { line: absoluteLine, character: Math.max(1, lines[boundedLine]?.length ?? 1) },
  };
}

function sectionHasMeaningfulContent(section: DocSection): boolean {
  if (section.contentLines.join("\n").trim().length > 0) return true;
  return section.children.some(sectionHasMeaningfulContent);
}

function uniqueMarkdownDocuments(documents: ForgeDocument[]): ForgeDocument[] {
  const seen = new Set<string>();
  const unique: ForgeDocument[] = [];

  for (const document of documents) {
    if (document.extension.toLowerCase() !== "md" || seen.has(document.path)) continue;
    seen.add(document.path);
    unique.push(document);
  }

  return unique;
}

function arraysEqualOrder(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function newResult(
  file: string,
  severity: LintSeverity,
  rule: string,
  message: string,
  range?: ForgeRange
): LintResult {
  return range
    ? { file, severity, rule, message, range }
    : { file, severity, rule, message };
}
