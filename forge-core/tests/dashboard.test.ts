import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDashboardSummary,
  buildDashboardSnapshot,
  buildDashboardTabStates,
  buildVaultFileInventory,
  buildLintScanResult,
  buildOntologyMetricsResult,
  buildPatchHistoryResult,
  buildSchemaValidationResult,
  buildShapeLintResult,
  createWorkspaceHealthResult,
  defaultDashboardTabId,
  schemaIssueToDashboardIssue,
  sortDashboardIssuesBySeverity,
  type DashboardIssue,
} from "../src/index.js";

const criticalIssue: DashboardIssue = {
  file_path: "Project.md",
  issue_type: "required_field",
  severity: "critical",
  message: "Missing required field",
  source_command: "run-vault-lint",
};

const warningIssue: DashboardIssue = {
  file_path: "Reference.md",
  issue_type: "tag_namespace",
  severity: "warning",
  message: "Tag is not namespaced",
  source_command: "run-vault-lint",
};

const infoIssue: DashboardIssue = {
  file_path: "Inbox/Note.md",
  issue_type: "stale_inbox_note",
  severity: "info",
  message: "Review inbox note",
  source_command: "run-vault-lint",
};

describe("dashboard health model", () => {
  it("builds a Forge dashboard summary from plain issue arrays", () => {
    const patternIssue: DashboardIssue = {
      file_path: "Pattern.md",
      issue_type: "pattern_mismatch",
      severity: "critical",
      message: "Pattern mismatch",
      source_command: "run-vault-lint",
    };
    const uniqueIssue: DashboardIssue = {
      file_path: "Duplicate.md",
      issue_type: "unique_field",
      severity: "critical",
      message: "Duplicate field",
      source_command: "run-vault-lint",
    };
    const summary = buildDashboardSummary({
      notesScanned: 12,
      lintIssues: [criticalIssue, warningIssue, patternIssue, uniqueIssue],
      reviewItems: [infoIssue],
      schemaViolations: [criticalIssue],
      shapeIssues: [warningIssue],
    });

    assert.deepEqual(summary, {
      notes_scanned: 12,
      lint_issue_count: 4,
      review_item_count: 1,
      schema_violation_count: 1,
      broken_shape_count: 1,
      invalid_frontmatter_count: 3,
      normalization_candidates: null,
      unresolved_links: null,
    });
  });

  it("sorts dashboard issues without mutating the input", () => {
    const issues = [infoIssue, criticalIssue, warningIssue];
    const sorted = sortDashboardIssuesBySeverity(issues);

    assert.deepEqual(sorted.map((issue) => issue.severity), ["critical", "warning", "info"]);
    assert.deepEqual(issues.map((issue) => issue.severity), ["info", "critical", "warning"]);
  });

  it("derives workspace health from the summary", () => {
    const summary = buildDashboardSummary({
      notesScanned: 3,
      lintIssues: [],
      reviewItems: [infoIssue],
      schemaViolations: [],
      shapeIssues: [],
    });

    assert.equal(createWorkspaceHealthResult(summary).status, "needs_review");
  });

  it("maps schema validation issues to dashboard issues", () => {
    assert.deepEqual(
      schemaIssueToDashboardIssue(
        { severity: "error", message: "schema.md is missing version metadata" },
        "System/Registry/schema.md"
      ),
      {
        file_path: "System/Registry/schema.md",
        issue_type: "schema_validation",
        severity: "critical",
        message: "schema.md is missing version metadata",
        suggested_action: "Open schema.md and update the schema contract.",
        source_command: "validate-schema",
      }
    );
  });

  it("builds lint scan results without mixing review items into lint issues", () => {
    const lintIssue = {
      file: "Project.md",
      severity: "error" as const,
      rule: "required_field",
      message: "Missing required field",
    };
    const reviewItem = {
      file: "Inbox/Note.md",
      severity: "review" as const,
      rule: "stale_inbox_note",
      message: "Review inbox note",
    };

    const result = buildLintScanResult({
      envelope: {
        vault_path: "",
        timestamp: "2026-07-13T10:00:00",
        schema_version: "1.0.0",
        notes_scanned: 2,
      },
      results: [lintIssue, reviewItem],
      errors: [lintIssue],
      warnings: [],
      infos: [],
      reviewItems: [reviewItem],
    }, "run-vault-lint", 25);

    assert.equal(result.schema_version, 3);
    assert.equal(result.duration_ms, 25);
    assert.deepEqual(result.issues.map((issue) => issue.issue_type), ["required_field"]);
    assert.deepEqual(result.review_items.map((issue) => issue.issue_type), ["stale_inbox_note"]);
  });

  it("builds shape lint result summaries from rule buckets", () => {
    const missing = {
      file: "Project.md",
      severity: "warning" as const,
      rule: "shape_heading_missing",
      message: "Missing heading",
    };
    const empty = {
      file: "Project.md",
      severity: "info" as const,
      rule: "shape_section_empty",
      message: "Empty section",
    };

    const result = buildShapeLintResult({
      envelope: {
        vault_path: "",
        timestamp: "2026-07-13T10:00:00",
        schema_version: "1.0.0",
        notes_scanned: 4,
      },
      results: [missing, empty],
      errors: [],
      warnings: [missing],
      infos: [empty],
    }, "run-shape-lint", 12);

    assert.equal(result.files_scanned, 4);
    assert.deepEqual(result.summary, {
      files_scanned: 4,
      issue_count: 2,
      missing_heading_count: 1,
      heading_order_issue_count: 0,
      extra_heading_count: 0,
      empty_section_count: 1,
    });
  });

  it("builds schema validation results from validation issues or custom violations", () => {
    const issueResult = buildSchemaValidationResult({
      sourceCommand: "validate-schema",
      generatedAt: "2026-07-13T10:00:00Z",
      durationMs: 4,
      filesScanned: 1,
      schemaPath: "Forge/Registry/schema.md",
      issues: [
        { severity: "error", message: "Missing version" },
        { severity: "warning", message: "Missing description" },
      ],
    });

    assert.equal(issueResult.errors, 1);
    assert.equal(issueResult.warnings, 1);
    assert.deepEqual(issueResult.violations.map((issue) => issue.severity), ["critical", "warning"]);

    const customResult = buildSchemaValidationResult({
      sourceCommand: "refresh-vault-health-dashboard",
      generatedAt: "2026-07-13T10:00:00Z",
      durationMs: 5,
      filesScanned: 0,
      schemaPath: "Forge/Registry/schema.md",
      violations: [{
        file_path: "Forge/Registry/schema.md",
        issue_type: "schema_missing",
        severity: "critical",
        message: "schema.md not found",
        suggested_action: "Create schema.md or update Forge schema settings.",
        source_command: "validate-schema",
      }],
    });

    assert.equal(customResult.errors, 1);
    assert.equal(customResult.violations[0]?.source_command, "refresh-vault-health-dashboard");
  });

  it("builds dashboard snapshots from latest scan results", () => {
    const lint = {
      schema_version: 3,
      source_command: "refresh-vault-health-dashboard" as const,
      generated_at: "2026-07-13T10:00:00Z",
      duration_ms: 10,
      files_scanned: 2,
      issues: [criticalIssue],
      review_items: [infoIssue],
      errors: 1,
      warnings: 0,
      infos: 0,
    };
    const schema = {
      schema_version: 3,
      source_command: "refresh-vault-health-dashboard" as const,
      generated_at: "2026-07-13T10:00:01Z",
      duration_ms: 5,
      files_scanned: 1,
      schema_path: "Forge/Registry/schema.md",
      violations: [warningIssue],
      errors: 0,
      warnings: 1,
    };
    const shapeLint = {
      schema_version: 3,
      source_command: "refresh-vault-health-dashboard" as const,
      generated_at: "2026-07-13T10:00:02Z",
      duration_ms: 8,
      files_scanned: 2,
      issues: [warningIssue],
      summary: {
        files_scanned: 2,
        issue_count: 1,
        missing_heading_count: 1,
        heading_order_issue_count: 0,
        extra_heading_count: 0,
        empty_section_count: 0,
      },
      errors: 0,
      warnings: 1,
      infos: 0,
    };

    const snapshot = buildDashboardSnapshot({
      vaultName: "Vault Forge",
      generatedAt: "2026-07-13T10:00:03Z",
      durationMs: 42,
      lint,
      schema,
      shapeLint,
    });

    assert.equal(snapshot.schema_version, 3);
    assert.equal(snapshot.vault_name, "Vault Forge");
    assert.equal(snapshot.duration_ms, 42);
    assert.deepEqual(snapshot.issues.map((issue) => issue.issue_type), ["required_field", "tag_namespace"]);
    assert.deepEqual(snapshot.review_items, [infoIssue]);
    assert.equal(snapshot.summary.notes_scanned, 2);
    assert.equal(snapshot.summary.lint_issue_count, 1);
    assert.equal(snapshot.summary.schema_violation_count, 1);
    assert.equal(snapshot.summary.broken_shape_count, 1);
  });

  it("builds dashboard tab states and defaults from snapshot counts", () => {
    const lint = {
      schema_version: 3,
      source_command: "refresh-vault-health-dashboard" as const,
      generated_at: "2026-07-13T10:00:00Z",
      duration_ms: 10,
      files_scanned: 2,
      issues: [criticalIssue, warningIssue],
      review_items: [infoIssue],
      errors: 1,
      warnings: 1,
      infos: 0,
    };
    const shapeLint = {
      schema_version: 3,
      source_command: "refresh-vault-health-dashboard" as const,
      generated_at: "2026-07-13T10:00:02Z",
      duration_ms: 8,
      files_scanned: 2,
      issues: [warningIssue],
      summary: {
        files_scanned: 2,
        issue_count: 1,
        missing_heading_count: 1,
        heading_order_issue_count: 0,
        extra_heading_count: 0,
        empty_section_count: 0,
      },
      errors: 0,
      warnings: 1,
      infos: 0,
    };
    const schemaIssue: DashboardIssue = {
      ...warningIssue,
      issue_type: "schema_validation",
      source_command: "validate-schema",
    };
    const schema = {
      schema_version: 3,
      source_command: "refresh-vault-health-dashboard" as const,
      generated_at: "2026-07-13T10:00:01Z",
      duration_ms: 5,
      files_scanned: 1,
      schema_path: "Forge/Registry/schema.md",
      violations: [schemaIssue],
      errors: 0,
      warnings: 1,
    };
    const snapshot = buildDashboardSnapshot({
      vaultName: "Vault Forge",
      generatedAt: "2026-07-13T10:00:03Z",
      lint,
      schema,
      shapeLint,
      normalizationCandidates: 4,
    });

    const tabs = buildDashboardTabStates({
      snapshot,
      currentNote: { issueCount: 2, reviewItemCount: 0 },
    });

    assert.deepEqual(tabs.map((tab) => tab.id), ["overview", "note", "issues", "tools"]);
    assert.equal(tabs.find((tab) => tab.id === "issues")?.badge?.label, "1");
    assert.equal(tabs.find((tab) => tab.id === "issues")?.badge?.tone, "critical");
    assert.equal(tabs.find((tab) => tab.id === "note")?.badge?.label, "2");
    assert.equal(tabs.find((tab) => tab.id === "tools")?.badge?.label, "1");
    assert.equal(tabs.find((tab) => tab.id === "tools")?.badge?.tone, "warning");
    assert.deepEqual(tabs.find((tab) => tab.id === "overview")?.sectionKeys, ["summary", "recommendations", "vault-inventory", "ontology"]);
    assert.deepEqual(tabs.find((tab) => tab.id === "tools")?.sectionKeys, ["actions", "schema-health", "lockblock", "maintenance-history"]);
    assert.equal(defaultDashboardTabId(snapshot), "issues");

    const shapeOnlySnapshot = buildDashboardSnapshot({
      vaultName: "Vault Forge",
      generatedAt: "2026-07-13T10:00:03Z",
      shapeLint,
    });
    assert.equal(defaultDashboardTabId(shapeOnlySnapshot), "issues");

    const schemaOnlySnapshot = buildDashboardSnapshot({
      vaultName: "Vault Forge",
      generatedAt: "2026-07-13T10:00:03Z",
      schema,
    });
    assert.equal(defaultDashboardTabId(schemaOnlySnapshot), "tools");
  });

  it("builds ontology metrics from plain document records", () => {
    const metrics = buildOntologyMetricsResult({
      sourceCommand: "refresh-vault-health-dashboard",
      generatedAt: "2026-07-13T10:00:00Z",
      durationMs: 9,
      shapesPath: "Forge/Shapes",
      templatesPath: "Forge/Templates",
      relationshipTypeCount: 3,
      documents: [
        { path: "Forge/Shapes/Project.md", frontmatter: { tags: ["topic/a", "#topic/b"] } },
        { path: "Forge/Templates/Project.md", frontmatter: { tags: "topic/a" } },
        { path: "Inbox/Note.md", frontmatter: { tags: ["topic/c"] } },
        { path: ".trash/Hidden.md", frontmatter: { tags: ["topic/hidden"] } },
      ],
    });

    assert.equal(metrics.schema_version, 3);
    assert.equal(metrics.shape_count, 1);
    assert.equal(metrics.template_count, 1);
    assert.equal(metrics.relationship_type_count, 3);
    assert.deepEqual(metrics.folder_coverage, {
      Forge: 2,
      Inbox: 1,
    });
    assert.deepEqual(metrics.tag_distribution, {
      "topic/a": 2,
      "topic/b": 1,
      "topic/c": 1,
    });
  });

  it("builds vault file inventory across non-markdown asset types", () => {
    const inventory = buildVaultFileInventory({
      generatedAt: "2026-07-14T10:00:00Z",
      files: [
        { path: "Notes/A.md", size_bytes: 100 },
        { path: "Assets/photo.JPG", size_bytes: 200 },
        { path: "Docs/report.pdf", size_bytes: 300 },
        { path: "Scripts/tool.ts", size_bytes: 400 },
        { path: "Data/export.json", size_bytes: 500 },
        { path: "Boards/map.canvas", size_bytes: 600 },
        { path: ".obsidian/workspace.json", size_bytes: 700 },
        { path: "node_modules/pkg/index.js", size_bytes: 800 },
      ],
    });

    assert.equal(inventory.schema_version, 3);
    assert.equal(inventory.generated_at, "2026-07-14T10:00:00Z");
    assert.equal(inventory.files_scanned, 6);
    assert.equal(inventory.total_files, 6);
    assert.equal(inventory.total_size_bytes, 2100);
    assert.deepEqual(inventory.categories.map((category) => [category.category, category.count]), [
      ["markdown", 1],
      ["image", 1],
      ["document", 1],
      ["script", 1],
      ["data", 1],
      ["canvas", 1],
    ]);
    assert.deepEqual(inventory.extensions, {
      canvas: 1,
      jpg: 1,
      json: 1,
      md: 1,
      pdf: 1,
      ts: 1,
    });
  });

  it("builds patch history results with operational fallbacks", () => {
    const result = buildPatchHistoryResult({
      sourceCommand: "refresh-vault-health-dashboard",
      generatedAt: "2026-07-13T10:00:00Z",
      durationMs: 7,
      lintScans: 12,
      manifests: [{
        run_id: "patch-1",
        description: "Patch one",
        applied_at: "2026-07-13T09:00:00Z",
        changed_files: 2,
      }],
      operationalHistory: [{
        command: "normalization",
        status: "success",
        started_at: "2026-07-13T08:00:00Z",
        duration_ms: 5,
        affected_files: 3,
        applied_items: 3,
        warnings: [],
        errors: [],
      }, {
        command: "repair",
        status: "success",
        started_at: "2026-07-13T07:00:00Z",
        duration_ms: 6,
        affected_files: 4,
        applied_items: 4,
        warnings: [],
        errors: [],
      }],
    });

    assert.equal(result.restored_runs_available, 1);
    assert.equal(result.last_patch_run?.run_id, "patch-1");
    assert.equal(result.last_repair_run?.description, "repair");
    assert.equal(result.last_normalization_run?.changed_files, 3);
    assert.equal(result.lint_scans, 12);
  });
});
