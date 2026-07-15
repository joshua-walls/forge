import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDashboardSummary,
  createWorkspaceHealthResult,
} from "@forge/core";

describe("Forge Core dashboard integration", () => {
  it("resolves the shared dashboard model from the Obsidian adapter", () => {
    const summary = buildDashboardSummary({
      notesScanned: 5,
      lintIssues: [
        {
          file_path: "Inbox/Example.md",
          issue_type: "required_field",
          severity: "critical",
          message: "Missing required field",
          source_command: "run-vault-lint",
        },
      ],
    });

    const health = createWorkspaceHealthResult(summary);

    assert.equal(summary.notes_scanned, 5);
    assert.equal(summary.invalid_frontmatter_count, 1);
    assert.equal(health.status, "attention");
  });
});
