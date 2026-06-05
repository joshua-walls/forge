// src/commands/shape-lint.ts
// Shape heading validation — part of the standard lint pass.
//
// Rules:
//   shape_heading_missing  — a heading required by the template is absent from
//                            the note at the correct level under the correct parent
//   shape_heading_order    — template headings are present but in the wrong order
//                            within their parent section
//   shape_heading_extra    — a heading exists in the note that is not in the
//                            template at that level under that parent
//                            H1 extra = warning (non-strict) / error (strict)
//                            H2+ extra = info (non-strict) / warning (strict)
//   shape_section_empty    — a heading required by the template has no direct
//                            non-heading content beneath it and no populated
//                            descendant sections
//                            non-strict = info, strict = warning
//
// Matching: text + level + parent chain. A heading only satisfies a template
// node if it has the correct text, the correct level, AND sits under the
// correct parent heading in the note. This matches the repair engine exactly.

import { App, TFile, TFolder } from "obsidian";
import type { ForgeSettings } from "../settings";
import type { LintResult, LintSeverity } from "../lint-engine";
import { readNote } from "../utils/frontmatter";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParsedHeading {
  level: number;    // 1–6
  text: string;     // heading text without the # prefix
  lineIndex: number;
}

// ── Template tree ─────────────────────────────────────────────────────────────
//
// Shared with shape-repair.ts. Exported so both commands use the same tree
// definition and matching semantics.

export interface TemplateNode {
  text: string;           // heading text (original casing from template)
  level: number;          // expected # depth
  children: TemplateNode[];
}

/**
 * Builds a TemplateNode tree from a flat, ordered ParsedHeading list.
 * Headings are nested by level: a heading is a child of the nearest preceding
 * heading with a lower level number.
 */
export function buildTemplateTree(headings: ParsedHeading[]): TemplateNode[] {
  const roots: TemplateNode[] = [];
  const stack: TemplateNode[] = [];

  for (const h of headings) {
    const node: TemplateNode = { text: h.text, level: h.level, children: [] };

    while (stack.length > 0 && stack[stack.length - 1].level >= h.level) {
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

/**
 * Flattens a TemplateNode tree into a pre-order list.
 */
export function flattenTemplateTree(nodes: TemplateNode[]): TemplateNode[] {
  const result: TemplateNode[] = [];
  const visit = (n: TemplateNode) => {
    result.push(n);
    n.children.forEach(visit);
  };
  nodes.forEach(visit);
  return result;
}

// ── Template cache ────────────────────────────────────────────────────────────

/**
 * Builds a map of shape name → template headings for all templates
 * in the configured templates folder. Called once per lint run.
 */
export async function buildShapeHeadingCache(
  app: App,
  settings: ForgeSettings
): Promise<Map<string, ParsedHeading[]>> {
  const cache = new Map<string, ParsedHeading[]>();

  const templateFiles: TFile[] = [];
  const walk = (node: import("obsidian").TAbstractFile) => {
    if (node instanceof TFile && node.extension === "md") {
      templateFiles.push(node);
    } else if (node instanceof TFolder) {
      node.children.forEach(walk);
    }
  };

  const abstractFolder = app.vault.getAbstractFileByPath(settings.shapeTemplatesFolder);
  if (!(abstractFolder instanceof TFolder)) return cache;
  abstractFolder.children.forEach(walk);

  for (const file of templateFiles) {
    if (!file.name.startsWith("Template, ")) continue;
    const shapeName = templateFileToShapeName(file.basename);
    const content = await app.vault.read(file);
    const headings = extractHeadings(content);
    cache.set(shapeName.toLowerCase(), headings);
  }

  return cache;
}

// ── Per-note shape lint ───────────────────────────────────────────────────────

/**
 * Validates a note's heading structure against its matching template using
 * recursive tree matching. A heading satisfies a template node only when
 * text, level, AND parent chain all agree.
 */
export async function lintShapeHeadings(
  app: App,
  file: TFile,
  content: string,
  settings: ForgeSettings,
  headingCache: Map<string, ParsedHeading[]>
): Promise<LintResult[]> {
  const results: LintResult[] = [];
  const strict = settings.lintStrictMode;
  const flagExtraHeadings = settings.shapeLintStrictMode;

  const note = await readNote(app, file);
  if (!note || !note.hasFrontmatter) return results;

  const typeValue = note.frontmatter[settings.shapeTypeTargetField];
  if (!typeValue || typeof typeValue !== "string") return results;

  // Scope filter
  if (settings.shapeLintScope === "folder") {
    const folders = settings.shapeLintFolders ?? [];
    if (folders.length > 0) {
      const prefixes = folders.map((f) => f.toLowerCase().replace(/\/?$/, "/"));
      if (!prefixes.some((p) => file.path.toLowerCase().startsWith(p))) return results;
    }
  }

  const shapeName = typeValue.trim().toLowerCase();
  const templateHeadings = headingCache.get(shapeName);
  if (!templateHeadings || templateHeadings.length === 0) return results;

  const lines = content.split("\n");
  const { bodyLines } = splitFrontmatter(lines);
  const templateRoots = buildTemplateTree(templateHeadings);
  const { roots: docRoots } = buildDocSectionTree(bodyLines);

  lintLevel(
    templateRoots,
    docRoots,
    bodyLines,
    file.path,
    typeValue,
    strict,
    flagExtraHeadings,
    results,
    null
  );

  return results;
}

// ── Recursive lint walker ─────────────────────────────────────────────────────

/**
 * Lints one level of the heading hierarchy.
 *
 * For each template node at this level:
 *   - Look for a matching doc section (text + exact level) in the current scope
 *   - If missing: emit shape_heading_missing
 *   - If present but out of order: emit shape_heading_order
 *   - If present with no direct content or populated descendants:
 *     emit shape_section_empty
 *   - Recurse into children
 *
 * Unknown doc sections (not in template at this level): emit shape_heading_extra
 */
function lintLevel(
  templateNodes: TemplateNode[],
  docSections: DocSection[],
  bodyLines: string[],
  filePath: string,
  typeValue: string,
  strict: boolean,
  flagExtraHeadings: boolean,
  results: LintResult[],
  parentText: string | null
): void {
  const consumed = new Set<DocSection>();

  // ── Missing and recursion ─────────────────────────────────────────────────
  for (const tn of templateNodes) {
    const match = docSections.find(
      (ds) =>
        !consumed.has(ds) &&
        ds.headingText.toLowerCase() === tn.text.toLowerCase() &&
        ds.headingLevel === tn.level
    );

    if (!match) {
      const prefix = "#".repeat(tn.level);
      const ctx = parentText ? ` under '${parentText}'` : "";
      results.push(newResult(
        filePath,
        strict ? "error" : "warning",
        "shape_heading_missing",
        `Missing heading: '${prefix} ${tn.text}'${ctx} (required by shape '${typeValue}')`
      ));
    } else {
      consumed.add(match);

      // Empty section check — direct content satisfies the section, and so
      // do populated descendants. This keeps container headings flexible even
      // when the template does not statically declare child headings.
      if (!sectionHasMeaningfulContent(match)) {
        results.push(newResult(
          filePath,
          strict ? "warning" : "info",
          "shape_section_empty",
          `Section '${match.headingText}' is empty (required by shape '${typeValue}')`
        ));
      }

      // Recurse into children
      lintLevel(
        tn.children,
        match.children,
        bodyLines,
        filePath,
        typeValue,
        strict,
        flagExtraHeadings,
        results,
        tn.text
      );
    }
  }

  // ── Order check ───────────────────────────────────────────────────────────
  // Compare the order matched sections appear in the doc against template order
  const docOrder = docSections
    .filter((ds) => consumed.has(ds))
    .map((ds) => ds.headingText.toLowerCase());

  const expectedOrder = templateNodes
    .map((tn) => tn.text.toLowerCase())
    .filter((t) => docOrder.includes(t));

  if (!arraysEqualOrder(docOrder, expectedOrder) && expectedOrder.length > 1) {
    const ctx = parentText ? ` within '${parentText}'` : "";
    results.push(newResult(
      filePath,
      strict ? "error" : "warning",
      "shape_heading_order",
      `Headings out of order${ctx} for shape '${typeValue}'. ` +
      `Expected: ${expectedOrder.map((t) => `'${t}'`).join(" → ")}`
    ));
  }

  // ── Extra headings ────────────────────────────────────────────────────────
  if (!flagExtraHeadings) return;

  const unknowns = docSections.filter((ds) => !consumed.has(ds));
  for (const u of unknowns) {
    const sev: LintSeverity = u.headingLevel === 1
      ? strict ? "error" : "warning"
      : strict ? "warning" : "info";
    const ctx = parentText ? ` under '${parentText}'` : "";
    results.push(newResult(
      filePath,
      sev,
      "shape_heading_extra",
      `Extra heading: '${u.headingText}'${ctx} (not in shape '${typeValue}' template)`
    ));

    // Recurse into unknown children so we catch extras at deeper levels too
    lintLevel([], u.children, bodyLines, filePath, typeValue, strict, flagExtraHeadings, results, u.headingText);
  }
}

// ── Document section model ────────────────────────────────────────────────────

interface DocSection {
  headingText: string;
  headingLevel: number;
  contentLines: string[];   // direct non-heading content (excluding child sections)
  children: DocSection[];
}

function sectionHasMeaningfulContent(section: DocSection): boolean {
  if (section.contentLines.join("\n").trim().length > 0) return true;
  return section.children.some(sectionHasMeaningfulContent);
}

function buildDocSectionTree(
  bodyLines: string[]
): { roots: DocSection[] } {
  const headings = extractHeadingsFromLines(bodyLines);

  // Build flat section list
  const flatSections: Array<DocSection & { lineIndex: number }> = [];

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];

    // Direct content: lines after heading, before the next heading at any level
    const nextHeading = headings[i + 1];
    const contentEnd = nextHeading ? nextHeading.lineIndex : bodyLines.length;
    const contentLines = bodyLines.slice(h.lineIndex + 1, contentEnd);

    flatSections.push({
      headingText: h.text,
      headingLevel: h.level,
      contentLines,
      children: [],
      lineIndex: h.lineIndex,
    });
  }

  // Nest into tree by level
  const roots: DocSection[] = [];
  const stack: Array<DocSection & { lineIndex: number }> = [];

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

// ── Heading extraction ────────────────────────────────────────────────────────

/**
 * Extracts all ATX headings from markdown content, skipping frontmatter.
 */
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

    const m = line.match(/^(#{1,6})\s+(.+)$/);
    if (m) {
      headings.push({ level: m[1].length, text: m[2].trim(), lineIndex });
    }

    lineIndex++;
  }

  return headings;
}

function extractHeadingsFromLines(lines: string[]): ParsedHeading[] {
  const headings: ParsedHeading[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (m) headings.push({ level: m[1].length, text: m[2].trim(), lineIndex: i });
  }
  return headings;
}

// ── Frontmatter splitter ──────────────────────────────────────────────────────

function splitFrontmatter(lines: string[]): {
  frontmatterLines: string[];
  bodyLines: string[];
} {
  if (lines[0]?.trim() !== "---") return { frontmatterLines: [], bodyLines: lines };
  let closingIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") { closingIdx = i; break; }
  }
  if (closingIdx === -1) return { frontmatterLines: [], bodyLines: lines };
  return {
    frontmatterLines: lines.slice(0, closingIdx + 1),
    bodyLines: lines.slice(closingIdx + 1),
  };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function templateFileToShapeName(basename: string): string {
  return basename.replace(/^Template,\s*/i, "").trim().toLowerCase();
}

function arraysEqualOrder(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function newResult(
  file: string,
  severity: LintSeverity,
  rule: string,
  message: string
): LintResult {
  return { file, severity, rule, message };
}
