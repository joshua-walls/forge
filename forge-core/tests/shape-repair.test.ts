import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyShapeRepair,
  buildShapeHeadingCacheFromTemplates,
  buildShapeRepairHistoryContent,
  buildShapeRepairRunNoteArtifact,
  DEFAULT_SETTINGS,
  planShapeRepairForDocuments,
  repairShapeDocument,
  type ForgeDocument,
} from "../src/index.js";

const baseDocument: ForgeDocument = {
  path: "Projects/Example.md",
  basename: "Example",
  extension: "md",
  content: "",
  frontmatter: { type: "project" },
  hasFrontmatter: true,
};

describe("shape repair", () => {
  it("inserts missing headings while preserving frontmatter and note content", () => {
    const result = applyShapeRepair(
      "---\ntype: project\n---\nIntro\n# Overview\nBody",
      [
        { level: 1, text: "Overview", lineIndex: 0 },
        { level: 2, text: "Details", lineIndex: 1 },
        { level: 1, text: "Next", lineIndex: 2 },
      ]
    );

    assert.deepEqual(result.descriptions, [
      "Insert missing heading: '## Details' (under 'Overview')",
      "Insert missing heading: '# Next'",
    ]);
    assert.equal(
      result.repairedContent,
      "---\ntype: project\n---\nIntro\n# Overview\nBody\n## Details\n\n# Next\n"
    );
  });

  it("reorders known headings and preserves unknown user headings", () => {
    const result = applyShapeRepair(
      "# Beta\nBeta body\n# Custom\nCustom body\n# Alpha\nAlpha body",
      [
        { level: 1, text: "Alpha", lineIndex: 0 },
        { level: 1, text: "Beta", lineIndex: 1 },
      ]
    );

    assert.deepEqual(result.descriptions, [
      "Reorder headings: 'alpha' → 'beta'",
    ]);
    assert.equal(
      result.repairedContent,
      "# Alpha\nAlpha body\n# Beta\nBeta body\n# Custom\nCustom body"
    );
  });

  it("returns existing Obsidian skip reasons for per-document repair", () => {
    const settings = { ...DEFAULT_SETTINGS, shapeTypeTargetField: "type" };
    const headingCache = buildShapeHeadingCacheFromTemplates([
      { shape: "project", content: "# Overview\n" },
    ]);

    assert.equal(
      repairShapeDocument({
        document: { ...baseDocument, hasFrontmatter: false, frontmatter: {}, content: "# Overview\n" },
        settings,
        headingCache,
      }).file.detail,
      "No frontmatter"
    );
    assert.equal(
      repairShapeDocument({
        document: { ...baseDocument, frontmatter: {}, content: "---\n---\n# Overview\n" },
        settings,
        headingCache,
      }).file.detail,
      "No type target field"
    );
    assert.equal(
      repairShapeDocument({
        document: { ...baseDocument, frontmatter: { type: "area" }, content: "---\ntype: area\n---\n# Overview\n" },
        settings,
        headingCache,
      }).file.detail,
      "No matching template"
    );
    assert.equal(
      repairShapeDocument({
        document: { ...baseDocument, content: "---\ntype: project\n---\n# Overview\n" },
        settings,
        headingCache,
      }).file.detail,
      "Already conforms"
    );
  });

  it("plans vault-scope updates from shared documents and templates", () => {
    const plan = planShapeRepairForDocuments({
      settings: {
        ...DEFAULT_SETTINGS,
        shapeRepairScope: "folder",
        shapeRepairFolders: ["Projects"],
      },
      templates: [
        {
          shape: "project",
          content: "# Overview\n## Details\n",
        },
      ],
      documents: [
        {
          ...baseDocument,
          path: "Projects/Example.md",
          content: "---\ntype: project\n---\n# Overview\n",
        },
        {
          ...baseDocument,
          path: "Archive/Example.md",
          content: "---\ntype: project\n---\n# Overview\n",
        },
      ],
      timestamp: "2026-07-13T12:00:00",
    });

    assert.equal(plan.run.ranAt, "2026-07-13T12:00:00");
    assert.equal(plan.run.repaired, 1);
    assert.equal(plan.updates.length, 1);
    assert.equal(plan.updates[0]?.path, "Projects/Example.md");
  });

  it("builds shared history and run-note artifacts", () => {
    const plan = planShapeRepairForDocuments({
      settings: DEFAULT_SETTINGS,
      templates: [{ shape: "project", content: "# Overview\n## Details\n" }],
      documents: [
        {
          ...baseDocument,
          content: "---\ntype: project\n---\n# Overview\n",
        },
      ],
      timestamp: "2026-07-13T12:00:00",
    });
    const history = buildShapeRepairHistoryContent("[]", plan.run, 20);
    const artifact = buildShapeRepairRunNoteArtifact(DEFAULT_SETTINGS, plan.run, "2026-07-13");

    assert.match(history, /Projects\/Example\.md/);
    assert.equal(artifact.path, "System/Exports/ShapeRepairRuns/shape-repair-2026-07-13_12-00-00.md");
    assert.match(artifact.content, /# Shape Repair Run/);
    assert.match(artifact.content, /Insert missing heading: '## Details'/);
  });
});
