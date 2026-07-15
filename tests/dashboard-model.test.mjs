import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const {
  buildDashboardSummary,
  createWorkspaceHealthResult,
} = require("../.tmp-test/src/dashboard/model.js");

describe("Forge dashboard model integration", () => {
  it("resolves the dashboard model from the Obsidian adapter", () => {
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
