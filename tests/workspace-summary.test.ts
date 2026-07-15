import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findNormalizationCandidates,
  summarizeForgeRuns,
  summarizeLintRun,
  summarizeWorkspaceMarkdown,
} from "../src/dashboard/workspace-summary.js";
import type { ForgeDocument } from "../src/linting/model.js";

describe("workspace helpers", () => {
  it("summarizes Markdown workspace counts", () => {
    const health = summarizeWorkspaceMarkdown(7);

    assert.equal(health.status, "healthy");
    assert.equal(health.summary.notes_scanned, 7);
    assert.equal(health.issue_count, 0);
  });

  it("includes schema violations in workspace health", () => {
    const health = summarizeWorkspaceMarkdown(7, {
      schemaViolations: [{
        file_path: "System/Registry/schema.md",
        issue_type: "schema_validation",
        severity: "warning",
        message: "Schema warning",
        source_command: "validate-schema",
      }],
    });

    assert.equal(health.status, "attention");
    assert.equal(health.issue_count, 1);
    assert.equal(health.summary.schema_violation_count, 1);
  });

  it("summarizes lint results as workspace health", () => {
    const health = summarizeLintRun({
      envelope: {
        vault_path: "",
        timestamp: "2026-07-12T00:00:00",
        schema_version: "1.0.0",
        notes_scanned: 2,
      },
      results: [
        {
          file: "Example.md",
          severity: "error",
          rule: "required_field",
          message: "Missing required field",
        },
      ],
      errors: [
        {
          file: "Example.md",
          severity: "error",
          rule: "required_field",
          message: "Missing required field",
        },
      ],
      warnings: [],
      infos: [],
      reviewItems: [],
    });

    assert.equal(health.status, "attention");
    assert.equal(health.issue_count, 1);
  });

  it("includes shape lint results in workspace health", () => {
    const lintRun = {
      envelope: {
        vault_path: "",
        timestamp: "2026-07-12T00:00:00",
        schema_version: "1.0.0",
        notes_scanned: 1,
      },
      results: [],
      errors: [],
      warnings: [],
      infos: [],
      reviewItems: [],
    };

    const health = summarizeForgeRuns(
      lintRun,
      {
        envelope: lintRun.envelope,
        results: [
          {
            file: "Example.md",
            severity: "warning",
            rule: "shape_heading_missing",
            message: "Missing heading",
          },
        ],
        errors: [],
        warnings: [
          {
            file: "Example.md",
            severity: "warning",
            rule: "shape_heading_missing",
            message: "Missing heading",
          },
        ],
        infos: [],
      },
      {
        normalizationCandidates: 3,
      }
    );

    assert.equal(health.status, "attention");
    assert.equal(health.issue_count, 1);
    assert.equal(health.summary.broken_shape_count, 1);
    assert.equal(health.summary.normalization_candidates, 3);
  });

  it("finds normalization candidates from Forge documents", () => {
    const documents: ForgeDocument[] = [
      {
        path: "Inbox/Example.md",
        basename: "Example",
        extension: "md",
        content: "---\nType: Project\ntags:\n  - topic:z\n---\n",
        frontmatter: {
          Type: "Project",
          tags: ["topic:z"],
        },
        hasFrontmatter: true,
        stat: {
          ctime: 0,
          mtime: 0,
        },
      },
      {
        path: "Inbox/NoFm.md",
        basename: "NoFm",
        extension: "md",
        content: "No frontmatter",
        frontmatter: {},
        hasFrontmatter: false,
        stat: {
          ctime: 0,
          mtime: 0,
        },
      },
    ];

    assert.deepEqual(findNormalizationCandidates(documents, ["type"]), [
      {
        path: "Inbox/Example.md",
        details: [
          "frontmatter: 1 field name(s) lowercased",
          "frontmatter: type value lowercased",
          "tags: 1 separator(s) fixed",
          "tags: sorted/deduped",
        ],
      },
    ]);
  });
});
