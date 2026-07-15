import {
  buildDashboardSummary,
  createWorkspaceHealthResult,
  type DashboardIssue,
  type WorkspaceHealthResult,
} from "./dashboard.js";
import { lintResultToDashboardIssue, type ForgeDocument, type LintRunResult } from "./lint.js";
import { planNormalizeFrontmatter, planNormalizeTags } from "./normalization.js";
import type { ShapeLintRunResult } from "./shape-lint.js";

export interface ForgeNormalizationCandidate {
  path: string;
  details: string[];
}

export interface WorkspaceSummaryOptions {
  normalizationCandidates?: number | null;
  unresolvedLinks?: number | null;
  schemaViolations?: readonly DashboardIssue[];
}

export function summarizeWorkspaceMarkdown(
  notesScanned: number,
  options: WorkspaceSummaryOptions = {}
): WorkspaceHealthResult {
  return createWorkspaceHealthResult(
    buildDashboardSummary({
      notesScanned,
      lintIssues: [],
      reviewItems: [],
      schemaViolations: options.schemaViolations ?? [],
      shapeIssues: [],
      normalizationCandidates: options.normalizationCandidates,
      unresolvedLinks: options.unresolvedLinks,
    })
  );
}

export function summarizeLintRun(lintRun: LintRunResult): WorkspaceHealthResult {
  return summarizeForgeRuns(lintRun, null);
}

export function summarizeForgeRuns(
  lintRun: LintRunResult,
  shapeLintRun: ShapeLintRunResult | null,
  options: WorkspaceSummaryOptions = {}
): WorkspaceHealthResult {
  const lintIssues = [
    ...lintRun.errors,
    ...lintRun.warnings,
    ...lintRun.infos,
  ].map(lintResultToDashboardIssue);
  const reviewItems = lintRun.reviewItems.map(lintResultToDashboardIssue);
  const shapeIssues = (shapeLintRun?.results ?? []).map((issue) => ({
    ...lintResultToDashboardIssue(issue),
    source_command: "run-shape-lint",
  }));

  return createWorkspaceHealthResult(
    buildDashboardSummary({
      notesScanned: lintRun.envelope.notes_scanned,
      lintIssues,
      reviewItems,
      schemaViolations: options.schemaViolations ?? [],
      shapeIssues,
      normalizationCandidates: options.normalizationCandidates,
      unresolvedLinks: options.unresolvedLinks,
    })
  );
}

export function findNormalizationCandidates(
  documents: ForgeDocument[],
  lowercaseFields: Iterable<string>
): ForgeNormalizationCandidate[] {
  const lowercaseFieldList = [...lowercaseFields];

  return documents.flatMap((document) => {
    if (!document.hasFrontmatter) return [];

    const tagPlan = planNormalizeTags(document.frontmatter);
    const frontmatterPlan = planNormalizeFrontmatter(document.frontmatter, lowercaseFieldList);
    const details = [
      ...frontmatterPlan.details.map((detail) => `frontmatter: ${detail}`),
      ...tagPlan.details.map((detail) => `tags: ${detail}`),
    ];

    if (details.length === 0) return [];
    return [{
      path: document.path,
      details,
    }];
  });
}
