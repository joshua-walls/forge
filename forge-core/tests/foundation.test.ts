import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyPatchToDocuments,
  applyPatchRestoreOperations,
  buildForgeControlPlaneExemptList,
  buildCuratedRepairOperations,
  buildDefaultRepairOperations,
  buildLintExemptList,
  buildForgeDocumentation,
  buildLegacyPatchRestoreCandidates,
  buildOntologyIndexArtifacts,
  buildPatchArchiveArtifact,
  buildPatchReportArtifact,
  buildPatchRestoreReportArtifact,
  buildPatchRestoreManifestArtifact,
  buildRepairFileCandidates,
  buildRepairPatchContent,
  buildVaultOverviewArtifacts,
  buildVaultScanExemptList,
  createForgeDocument,
  createForgeSettings,
  createPatchTemplateContent,
  extractRelationships,
  DEFAULT_SETTINGS,
  evaluatePatchRestoreCandidates,
  extractRepairTagNamespace,
  filterRepairableLintResults,
  isExempt,
  isPatchRestoreManifest,
  getTags,
  getRepairDefaultValue,
  getRepairFieldsToFix,
  matchingTagsForRepairIssue,
  matchesGlob,
  normalizeTags,
  parsePatchFile,
  parsePatchFileResult,
  planPatchForDocuments,
  planNormalizeFrontmatter,
  planNormalizeTags,
  parseSchemaNote,
  runLintForDocuments,
  safeTimestamp,
  selectPatchTargetDocuments,
  shouldWritePatchRestoreManifest,
  sortFrontmatterFields,
  todayString,
  validateSchemaNote,
  type ForgeYamlParser,
  type ForgeSettings,
  type ForgeYamlStringifier,
  type VaultSchema,
} from "../src/index.js";

const parseYaml: ForgeYamlParser = (source) => {
  if (source.includes("frontmatter:")) {
    return {
      frontmatter: {
        required: [
          { name: "type", type: "enum", values: ["project"], severity: "error" },
          { name: "status", type: "string", severity: "warning" },
        ],
        optional: [],
      },
      inline: {
        allowed: [{ name: "owner" }],
      },
      ontology: {
        relationships: {},
      },
      tag_rules: {
        require_namespace: true,
        unknown_tags: "warning",
        severity: "warning",
        allowed_namespaces: ["topic"],
        forbidden_namespaces: ["status"],
      },
      exempt_paths: [],
    };
  }

  if (source.includes("type:")) {
    return { type: "Project" };
  }

  return { version: "1.0.0" };
};

const parsePatchYaml: ForgeYamlParser = (source) => {
  const description = source.match(/description:\s*(.+)/)?.[1]?.trim();
  const op = source.match(/-\s+op:\s*(.+)/)?.[1]?.trim();
  const target = source.match(/target:\s*(.+)/)?.[1]?.trim();
  const targetPattern = source.match(/target_pattern:\s*(.+)/)?.[1]?.trim();
  const field = source.match(/field:\s*(.+)/)?.[1]?.trim();
  const value = source.match(/value:\s*(.+)/)?.[1]?.trim();

  return {
    meta: description ? { description } : {},
    operations: op
      ? [{
        op,
        ...(target ? { target } : {}),
        ...(targetPattern ? { target_pattern: targetPattern } : {}),
        ...(field ? { field } : {}),
        ...(value ? { value } : {}),
      }]
      : [],
  };
};

const stringifyYaml: ForgeYamlStringifier = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return stringifyYamlRecord(value as Record<string, unknown>, 0);
};

function stringifyYamlRecord(record: Record<string, unknown>, indent: number): string {
  const pad = " ".repeat(indent);
  return Object.entries(record)
    .map(([key, item]) => {
      if (Array.isArray(item)) {
        return `${pad}${key}:\n${item.map((entry) => stringifyYamlArrayEntry(entry, indent + 2)).join("\n")}`;
      }
      if (item && typeof item === "object") {
        return `${pad}${key}:\n${stringifyYamlRecord(item as Record<string, unknown>, indent + 2)}`;
      }
      return `${pad}${key}: ${formatYamlValue(item)}`;
    })
    .join("\n");
}

function stringifyYamlArrayEntry(value: unknown, indent: number): string {
  const pad = " ".repeat(indent);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return `${pad}- ${formatYamlValue(value)}`;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const [first, ...rest] = entries;
  if (!first) return `${pad}-`;

  const [firstKey, firstValue] = first;
  const firstLine = `${pad}- ${firstKey}: ${formatYamlValue(firstValue)}`;
  const restLines = rest.map(([key, item]) => {
    if (Array.isArray(item)) {
      return `${pad}  ${key}:\n${item.map((entry) => stringifyYamlArrayEntry(entry, indent + 4)).join("\n")}`;
    }
    if (item && typeof item === "object") {
      return `${pad}  ${key}:\n${stringifyYamlRecord(item as Record<string, unknown>, indent + 4)}`;
    }
    return `${pad}  ${key}: ${formatYamlValue(item)}`;
  });
  return [firstLine, ...restLines].join("\n");
}

function formatYamlValue(value: unknown): string {
  return String(value);
}

describe("shared foundation", () => {
  it("normalizes tag lists and frontmatter field order", () => {
    assert.deepEqual(normalizeTags(["Topic/B", "topic/b", " topic/a "]), ["topic/a", "Topic/B"]);
    assert.deepEqual(getTags({ tags: "topic/a" }), ["topic/a"]);
    assert.deepEqual(Object.keys(sortFrontmatterFields({ z: 1, type: "project", tags: [] })), ["type", "tags", "z"]);
  });

  it("creates Forge documents without host APIs", () => {
    const document = createForgeDocument({
      path: "\\Projects\\Example.Note.MD",
      content: "---\ntype: Project\n---\n# Body\n",
      parseYaml,
      stat: { ctime: 1, mtime: 2 },
    });

    assert.equal(document.path, "Projects/Example.Note.MD");
    assert.equal(document.basename, "Example.Note");
    assert.equal(document.extension, "md");
    assert.deepEqual(document.frontmatter, { type: "Project" });
    assert.equal(document.hasFrontmatter, true);
    assert.deepEqual(document.stat, { ctime: 1, mtime: 2 });
  });

  it("matches exempt paths with folder boundaries and globs", () => {
    assert.equal(isExempt("Forge/Exports/report.md", ["Forge"]), true);
    assert.equal(isExempt("Forgecraft/Note.md", ["Forge"]), false);
    assert.equal(isExempt("Inbox/Note.md", ["Inbox/"]), true);
    assert.equal(isExempt("Work/Skills/Identity.md", ["Work/**/*.md"]), true);
    assert.equal(matchesGlob("Church/Scripture/John/1.md", "Church/**"), true);
  });

  it("builds shared vault scan exemptions from configured control-plane folders", () => {
    const settings = createForgeSettings({
      forgeFolder: "Forge",
      exportsFolder: "System/Exports",
      lintRunsFolder: "System/LintRuns",
      shapeRepairRunsFolder: "System/Exports/ShapeRepairRuns",
      patchesFolder: "Ops/Patches",
      patchBackupFolder: "Ops/Backups",
      lintExcludeInboxFolder: true,
      inboxFolder: "Inbox",
    });

    assert.deepEqual(buildForgeControlPlaneExemptList(settings), [
      "Forge",
      "System/Exports",
      "System/LintRuns",
      "System/Exports/ShapeRepairRuns",
      "Ops/Patches",
      "Ops/Patches/Applied",
      "Ops/Backups",
      "Ops/Patches/Reports",
    ]);
    assert.equal(isExempt("System/Exports/ShapeRepairRuns/run.md", buildVaultScanExemptList(settings)), true);
    assert.equal(isExempt("Ops/Patches/vault-patch.md", buildVaultScanExemptList(settings)), true);
    assert.equal(isExempt("Inbox/Note.md", buildLintExemptList(settings)), true);
  });

  it("formats local date strings without host APIs", () => {
    assert.match(todayString(), /^\d{4}-\d{2}-\d{2}$/);
    assert.match(safeTimestamp(), /^\d{8}_\d{6}$/);
  });

  it("creates the shared Forge patch note template", () => {
    const content = createPatchTemplateContent({ date: "2026-07-13" });

    assert.match(content, /^---\ntype: procedure\nstatus: draft\n/m);
    assert.match(content, /created: 2026-07-13\nupdated: 2026-07-13/);
    assert.equal(
      content.includes("```yaml\nmeta:\n  description: Manual vault patch\n\noperations: []\n```"),
      true
    );
    assert.equal(content.endsWith("\n"), true);
  });

  it("parses Markdown patch notes and raw YAML patches without host APIs", () => {
    const markdownPatch = createPatchTemplateContent({ date: "2026-07-13" }).replace(
      "operations: []",
      [
        "operations:",
        "  - op: set_field",
        "    target: Notes/Example.md",
        "    field: status",
        "    value: active",
      ].join("\n")
    );

    const parsedMarkdown = parsePatchFile(markdownPatch, "Forge/Patches/vault-patch.md", parsePatchYaml);
    assert.equal(parsedMarkdown?.meta.description, "Manual vault patch");
    assert.equal(parsedMarkdown?.operations[0]?.op, "set_field");
    assert.equal(parsedMarkdown?.operations[0]?.target, "Notes/Example.md");

    const parsedYaml = parsePatchFile(
      "meta:\n  description: Raw patch\noperations:\n  - op: normalize_tags\n    target_pattern: Notes/*.md\n",
      "Forge/Patches/vault-patch.yaml",
      parsePatchYaml
    );
    assert.equal(parsedYaml?.meta.description, "Raw patch");
    assert.equal(parsedYaml?.operations[0]?.target_pattern, "Notes/*.md");
  });

  it("reports patch parse failures without throwing", () => {
    const result = parsePatchFileResult("# Missing block", "Forge/Patches/vault-patch.md", parseYaml);

    assert.equal(result.patch, null);
    assert.equal(result.yaml, "");
    assert.equal(result.error, "Patch file contains no YAML payload");
  });

  it("identifies repairable lint issues and schema-driven defaults", () => {
    const schema: VaultSchema = {
      version: "2.0.0",
      frontmatter: {
        required: [
          { name: "type", type: "enum", values: ["note", "project"], severity: "error" },
          { name: "status", type: "enum", values: ["draft", "active"], severity: "error" },
          { name: "created", type: "date", severity: "error" },
          { name: "ai_private", type: "boolean", severity: "warning" },
        ],
        optional: [
          { name: "review_cycle", type: "enum", values: ["never", "weekly"], severity: "warning" },
        ],
      },
      inline: { allowed: [] },
      ontology: { relationships: {} },
      tag_rules: {
        require_namespace: true,
        unknown_tags: "warning",
        severity: "warning",
        allowed_namespaces: ["topic"],
        forbidden_namespaces: ["bad"],
      },
      exempt_paths: [],
    };
    const issues = [
      { file: "Notes/A.md", severity: "error" as const, rule: "required_field", message: "Missing required field: 'status'" },
      { file: "Notes/A.md", severity: "warning" as const, rule: "tag_namespace", message: "Tag 'loose' is not namespaced. Expected format: namespace/tag" },
      { file: "Notes/A.md", severity: "info" as const, rule: "inline_undocumented", message: "Nope" },
    ];

    assert.deepEqual(filterRepairableLintResults(issues, "errors_and_warnings").map((issue) => issue.rule), [
      "required_field",
      "tag_namespace",
    ]);
    assert.deepEqual(getRepairFieldsToFix(schema, issues), ["status"]);
    assert.equal(getRepairDefaultValue(schema, "status", "2026-07-13"), "active");
    assert.equal(getRepairDefaultValue(schema, "created", "2026-07-13"), "2026-07-13");
    assert.equal(getRepairDefaultValue(schema, "ai_private", "2026-07-13"), false);
    assert.equal(extractRepairTagNamespace(issues[1]), "loose");
    assert.deepEqual(matchingTagsForRepairIssue(issues[1], ["loose", "topic/a"]), ["loose"]);
  });

  it("builds a default repair patch from lint issues without host APIs", () => {
    const schema: VaultSchema = {
      version: "2.0.0",
      frontmatter: {
        required: [
          { name: "type", type: "enum", values: ["note", "project"], severity: "error" },
          { name: "status", type: "enum", values: ["draft", "active"], severity: "error" },
          { name: "created", type: "date", severity: "error" },
        ],
        optional: [],
      },
      inline: { allowed: [] },
      ontology: { relationships: {} },
      tag_rules: {
        require_namespace: true,
        unknown_tags: "warning",
        severity: "warning",
        allowed_namespaces: ["topic"],
        forbidden_namespaces: ["bad"],
      },
      exempt_paths: [],
    };
    const issues = [
      { file: "Notes/A.md", severity: "error" as const, rule: "no_frontmatter", message: "No frontmatter block found" },
      { file: "Notes/B.md", severity: "warning" as const, rule: "forbidden_namespace", message: "Tag namespace 'bad' is reserved and must not be used as a tag namespace" },
    ];
    const documents = [
      createForgeDocument({
        path: "Notes/B.md",
        content: "---\ntags:\n  - bad/tag\n  - topic/a\n---\n# B\n",
        parseYaml: () => ({ tags: ["bad/tag", "topic/a"] }),
      }),
    ];

    const repair = buildDefaultRepairOperations({
      schema,
      issues,
      documents,
      threshold: "errors_and_warnings",
      today: "2026-07-13",
      tagAction: "remove",
    });

    assert.deepEqual(repair.filesWithOperations, ["Notes/A.md", "Notes/B.md"]);
    assert.deepEqual(repair.operations, [
      { op: "set_field", target: "Notes/A.md", field: "type", value: "note" },
      { op: "set_field", target: "Notes/A.md", field: "status", value: "active" },
      { op: "set_field", target: "Notes/A.md", field: "created", value: "2026-07-13" },
      { op: "remove_tag", target: "Notes/B.md", tag: "bad/tag" },
    ]);

    const content = buildRepairPatchContent({
      operations: repair.operations,
      schemaVersion: schema.version,
      generatedAt: "2026-07-13T12:00:00",
      today: "2026-07-13",
      stringifyYaml,
    });

    assert.match(content, /Patch generated by Forge Repair/);
    assert.match(content, /description: Repair pass — interactive fix of lint errors/);
    assert.match(content, /source: Forge — Vault Repair/);
    assert.match(content, /schema_version: 2\.0\.0/);
    assert.match(content, /- op: set_field\n {4}target: Notes\/A\.md\n {4}field: status\n {4}value: active/);
    assert.match(content, /- op: remove_tag\n {4}target: Notes\/B\.md\n {4}tag: bad\/tag/);
  });

  it("builds curated repair operations with selected files and tag replacements", () => {
    const schema: VaultSchema = {
      version: "2.0.0",
      frontmatter: {
        required: [
          { name: "status", type: "enum", values: ["draft", "active"], severity: "error" },
        ],
        optional: [],
      },
      inline: { allowed: [] },
      ontology: { relationships: {} },
      tag_rules: {
        require_namespace: true,
        unknown_tags: "warning",
        severity: "warning",
        allowed_namespaces: ["topic"],
        forbidden_namespaces: [],
      },
      exempt_paths: [],
    };
    const issues = [
      { file: "Notes/A.md", severity: "error" as const, rule: "required_field", message: "Missing required field: 'status'" },
      { file: "Notes/A.md", severity: "warning" as const, rule: "unknown_tag_namespace", message: "Tag namespace 'old' is not in allowed_namespaces" },
      { file: "Notes/B.md", severity: "error" as const, rule: "required_field", message: "Missing required field: 'status'" },
    ];
    const documents = [
      createForgeDocument({
        path: "Notes/A.md",
        content: "---\ntags:\n  - old/name\n---\n# A\n",
        parseYaml: () => ({ tags: ["old/name"] }),
      }),
    ];

    const candidates = buildRepairFileCandidates({
      schema,
      issues,
      documents,
      threshold: "errors_and_warnings",
      today: "2026-07-13",
    });
    const repair = buildCuratedRepairOperations({
      candidates,
      includedFiles: ["Notes/A.md"],
      tagDecisions: [
        { file: "Notes/A.md", tag: "old/name", action: "replace", newTag: "topic/name" },
      ],
    });

    assert.deepEqual(candidates.map((candidate) => candidate.file), ["Notes/A.md", "Notes/B.md"]);
    assert.deepEqual(candidates[0]?.fieldCandidates, [{ field: "status", defaultValue: "active" }]);
    assert.deepEqual(candidates[0]?.tagCandidates.map((candidate) => candidate.tag), ["old/name"]);
    assert.deepEqual(repair.operations, [
      { op: "set_field", target: "Notes/A.md", field: "status", value: "active" },
      { op: "replace_tag", target: "Notes/A.md", old_tag: "old/name", new_tag: "topic/name" },
    ]);
    assert.deepEqual(repair.filesWithOperations, ["Notes/A.md"]);
    assert.deepEqual(repair.skippedIssues.map((issue) => issue.file), ["Notes/B.md"]);
  });

  it("builds vault overview export artifacts without host APIs", () => {
    const settings = createForgeSettings({
      exportEnabled: true,
      exportsFolder: "Forge/Exports",
      exportDomainField: "domain",
      exportTypeField: "kind",
      exportStatusField: "status",
      exportPrivateEnabled: true,
      exportPrivateField: "ai_private",
      exportDashboardName: "dash",
    });
    const documents = [
      createForgeDocument({
        path: "Projects/Alpha.md",
        content: "---\ntitle: Alpha\nkind: product\ndomain: Work\nstatus: active\ntags:\n  - topic/a\nai_private: false\n---\n# Alpha\n",
        parseYaml: () => ({
          title: "Alpha",
          kind: "product",
          domain: "Work",
          status: "active",
          tags: ["topic/a"],
          ai_private: false,
        }),
      }),
      createForgeDocument({
        path: "People/Beta.md",
        content: "---\ntitle: Beta\nkind: person\ndomain: People\nstatus: draft\nai_private: true\n---\n# Beta\n",
        parseYaml: () => ({
          title: "Beta",
          kind: "person",
          domain: "People",
          status: "draft",
          ai_private: true,
        }),
      }),
      createForgeDocument({
        path: ".obsidian/Internal.md",
        content: "---\nkind: hidden\n---\n# Internal\n",
        parseYaml: () => ({ kind: "hidden" }),
      }),
      createForgeDocument({
        path: "ZArchive/Gamma.md",
        content: "---\ntitle: Gamma\nkind: product\ndomain: Archive\nstatus: complete\nai_private: false\n---\n# Gamma\n",
        parseYaml: () => ({
          title: "Gamma",
          kind: "product",
          domain: "Archive",
          status: "complete",
          ai_private: false,
        }),
      }),
    ];

    const artifacts = buildVaultOverviewArtifacts({
      documents,
      settings,
      schema: { version: "3.0.0", exempt_paths: ["ZArchive"] },
      generatedAt: "2026-07-13T12:00:00",
      today: "2026-07-13",
    });

    assert.equal(artifacts.inventoryPath, "Forge/Exports/vault-inventory.json");
    assert.equal(artifacts.metaPath, "Forge/Exports/vault-meta.json");
    assert.equal(artifacts.exportNotePath, "Forge/Exports/vault-export.md");
    assert.equal(artifacts.dashboardPath, "Forge/Exports/dash.md");
    assert.equal(artifacts.inventory.count, 3);
    assert.equal(artifacts.inventory.items[0]?.fields.kind, "person");
    assert.equal(artifacts.inventory.items[1]?.fields.kind, "product");
    assert.equal(artifacts.inventory.items[2]?.path, "ZArchive/Gamma.md");
    assert.deepEqual(artifacts.meta.note_counts_by_kind, { product: 2 });
    assert.match(artifacts.exportNote, /total_notes:: 3/);
    assert.match(artifacts.exportNote, /\| product \| 2 \|/);
    assert.match(artifacts.dashboardNote, /generated once and never overwritten — edit freely/);
    assert.match(artifacts.dashboardNote, /FROM "Forge\/Exports"/);
  });

  it("builds ontology export artifacts from inventory fields without host APIs", () => {
    const settings = createForgeSettings({
      exportEnabled: true,
      exportsFolder: "Forge/Exports",
      exportFilterField: "kind",
      exportFilterValues: ["product"],
      exportRelationshipHeading: "Related",
      exportDomainField: "domain",
      exportTypeField: "kind",
      exportStatusField: "status",
    });
    const documents = [
      createForgeDocument({
        path: "Projects/Alpha.md",
        content: "---\ntitle: Alpha\nkind: product\ndomain: Work\nstatus: active\n---\n# Alpha\n\n## Related\n\n### Depends On\n- [[Beta]]\n\n## Notes\n[[Gamma|G]]\n",
        parseYaml: () => ({
          title: "Alpha",
          kind: "product",
          domain: "Work",
          status: "active",
        }),
        stat: { mtime: Date.parse("2026-07-13T12:00:00Z") },
      }),
      createForgeDocument({
        path: "People/Beta.md",
        content: "---\ntitle: Beta\nkind: person\nstatus: active\n---\n# Beta\n",
        parseYaml: () => ({ title: "Beta", kind: "person", status: "active" }),
      }),
    ];
    const overview = buildVaultOverviewArtifacts({
      documents,
      settings,
      schema: { version: "3.0.0", exempt_paths: [] },
      generatedAt: "2026-07-13T12:00:00",
      today: "2026-07-13",
    });

    const artifacts = buildOntologyIndexArtifacts({
      documents,
      inventory: overview.inventory,
      settings,
      schemaVersion: "3.0.0",
      generatedAt: "2026-07-13T12:00:00",
      today: "2026-07-13",
    });

    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0]?.jsonPath, "Forge/Exports/product-index.json");
    assert.equal(artifacts[0]?.markdownPath, "Forge/Exports/product-index.md");
    assert.equal(artifacts[0]?.index.total_notes, 1);
    assert.deepEqual(artifacts[0]?.index.items[0]?.relationships, { "Depends On": ["Beta"] });
    assert.deepEqual(artifacts[0]?.index.items[0]?.outbound_links, ["Beta", "Gamma"]);
    assert.match(artifacts[0]?.markdown ?? "", /> Generated 2026-07-13T12:00:00 — 1 notes\./);
    assert.match(artifacts[0]?.markdown ?? "", /\| \[\[Projects\/Alpha\.md\\\|Alpha\]\] \| active \| Work \| 1 \|/);
    assert.deepEqual(extractRelationships("# A\n\n## Other\n[[Nope]]\n", "Related"), {});
  });

  it("plans patch targets and frontmatter changes over plain documents", () => {
    const documents = [
      {
        path: "Notes/A.md",
        basename: "A",
        extension: "md",
        content: "",
        frontmatter: { type: "note", status: "draft", tags: ["topic/a"] },
        hasFrontmatter: true,
        stat: { ctime: Date.parse("2026-07-01"), mtime: Date.parse("2026-07-12") },
      },
      {
        path: "Notes/B.md",
        basename: "B",
        extension: "md",
        content: "",
        frontmatter: { type: "note", status: "active", tags: ["topic/a"] },
        hasFrontmatter: true,
        stat: { ctime: Date.parse("2026-07-02"), mtime: Date.parse("2026-07-12") },
      },
    ];

    assert.deepEqual(
      selectPatchTargetDocuments(documents, undefined, "Notes/*.md").map((document) => document.path),
      ["Notes/A.md", "Notes/B.md"]
    );

    const result = planPatchForDocuments({
      documents,
      settings: createForgeSettings({ frontmatterFieldOrder: ["type", "status", "tags"] }),
      patchFile: {
        meta: { description: "Dry run" },
        operations: [
          { op: "set_field", target: "Notes/A.md", field: "status", value: "active" },
          { op: "add_tag", target_pattern: "Notes/*.md", tag: "topic/b", scope: { field_equals: { status: "active" } } },
        ],
      },
      patchFilePath: "Forge/Patches/vault-patch.md",
      runId: "run-1",
      appliedAt: "2026-07-13T13:00:00",
      now: Date.parse("2026-07-13T13:00:00"),
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.description, "Dry run");
    assert.equal(result.results.length, 3);
    assert.equal(result.results[0]?.status, "changed");
    assert.equal(result.results[1]?.status, "skipped");
    assert.equal(result.results[2]?.status, "changed");
    assert.equal(result.operations.length, 2);
    assert.deepEqual(result.operations.map((operation) => operation.id), ["op-00001", "op-00002"]);
    assert.equal(result.operations[0]?.target.kind, "frontmatter_field");
    assert.equal(result.operations[1]?.target.kind, "frontmatter_tags");
  });

  it("applies patch operations to Markdown content without host APIs", () => {
    const documents = [
      createForgeDocument({
        path: "Notes/A.md",
        content: "---\ntype: note\nstatus: draft\ntags:\n  - topic/a\n---\n# A\n",
        parseYaml: () => ({ type: "note", status: "draft", tags: ["topic/a"] }),
      }),
    ];

    const result = applyPatchToDocuments({
      documents,
      settings: createForgeSettings({ frontmatterFieldOrder: ["type", "status", "tags"] }),
      stringifyYaml,
      patchFile: {
        meta: { description: "Apply" },
        operations: [
          { op: "set_field", target: "Notes/A.md", field: "status", value: "active" },
          { op: "add_tag", target: "Notes/A.md", tag: "topic/b" },
        ],
      },
      patchFilePath: "Forge/Patches/vault-patch.md",
      runId: "run-2",
      appliedAt: "2026-07-13T13:00:00",
    });

    assert.equal(result.run.dryRun, false);
    assert.equal(result.run.results.length, 2);
    assert.equal(result.run.results.every((item) => item.status === "changed"), true);
    assert.equal(result.documents.length, 1);
    assert.equal(
      result.documents[0]?.contentAfter,
      "---\ntype: note\nstatus: active\ntags:\n  - topic/a\n  - topic/b\n---\n# A\n"
    );
  });

  it("applies patch note moves and detects destination conflicts", () => {
    const moveDocuments = [
      createForgeDocument({
        path: "Inbox/A.md",
        content: "---\ntype: note\n---\n# A\n",
        parseYaml: () => ({ type: "note" }),
      }),
    ];

    const moved = applyPatchToDocuments({
      documents: moveDocuments,
      settings: createForgeSettings({ frontmatterFieldOrder: ["type"] }),
      stringifyYaml,
      patchFile: {
        meta: {},
        operations: [
          { op: "move_note", target: "Inbox/A.md", source_root: "Inbox", destination_folder: "Archive" },
        ],
      },
      patchFilePath: "Forge/Patches/vault-patch.md",
    });

    assert.equal(moved.run.results[0]?.status, "changed");
    assert.equal(moved.documents[0]?.pathBefore, "Inbox/A.md");
    assert.equal(moved.documents[0]?.pathAfter, "Archive/A.md");

    const conflictDocuments = [
      ...moveDocuments,
      createForgeDocument({
        path: "Archive/A.md",
        content: "---\ntype: note\n---\n# Existing\n",
        parseYaml: () => ({ type: "note" }),
      }),
    ];

    const conflict = applyPatchToDocuments({
      documents: conflictDocuments,
      settings: createForgeSettings({ frontmatterFieldOrder: ["type"] }),
      stringifyYaml,
      patchFile: {
        meta: {},
        operations: [
          { op: "move_note", target: "Inbox/A.md", source_root: "Inbox", destination_folder: "Archive" },
        ],
      },
      patchFilePath: "Forge/Patches/vault-patch.md",
    });

    assert.equal(conflict.run.results[0]?.status, "error");
    assert.match(conflict.run.results[0]?.detail ?? "", /Destination already exists/);
  });

  it("builds patch run artifacts without host APIs", () => {
    const settings = createForgeSettings({
      patchesFolder: "Forge/Patches",
      exportsFolder: "Forge/Exports",
      patchGenerateManifest: true,
    });
    const run = applyPatchToDocuments({
      documents: [
        createForgeDocument({
          path: "Notes/A.md",
          content: "---\ntype: note\nstatus: draft\n---\n# A\n",
          parseYaml: () => ({ type: "note", status: "draft" }),
        }),
      ],
      settings,
      stringifyYaml,
      patchFile: {
        meta: { description: "Artifacts", schema_version: "1.0.0" },
        operations: [
          { op: "set_field", target: "Notes/A.md", field: "status", value: "active" },
        ],
      },
      patchFilePath: "Forge/Patches/vault-patch.md",
      runId: "20260713_120000",
      appliedAt: "2026-07-13T12:00:00",
    }).run;

    assert.equal(shouldWritePatchRestoreManifest(settings, run), true);

    const manifest = buildPatchRestoreManifestArtifact(settings, run);
    assert.equal(manifest?.folder, "Forge/Patches/Reports");
    assert.equal(manifest?.path, "Forge/Patches/Reports/20260713_120000-patch-manifest.json");
    assert.equal(manifest?.data.manifest_version, 2);
    assert.equal(manifest?.data.operations?.length, 1);

    const archive = buildPatchArchiveArtifact(settings, run);
    assert.equal(archive?.folder, "Forge/Patches/Applied");
    assert.equal(archive?.path, "Forge/Patches/Applied/20260713_120000-vault-patch.md");

    const report = buildPatchReportArtifact(settings, run, { today: "2026-07-13" });
    assert.equal(report.folder, "Forge/Patches/Reports");
    assert.equal(report.path, "Forge/Patches/Reports/20260713_120000-patch-report-apply.md");
    assert.match(report.content, /changed_count:: 1/);
    assert.match(report.content, /## Changed/);
    assert.match(report.content, /- `Notes\/A\.md` — Set 'status': "draft" → "active"/);
  });

  it("builds dry-run patch reports under exports and skips restore manifest", () => {
    const settings = createForgeSettings({
      patchesFolder: "Forge/Patches",
      exportsFolder: "Forge/Exports",
      patchGenerateManifest: true,
    });
    const run = planPatchForDocuments({
      documents: [
        {
          path: "Notes/A.md",
          basename: "A",
          extension: "md",
          content: "",
          frontmatter: { type: "note", status: "draft" },
          hasFrontmatter: true,
        },
      ],
      settings,
      patchFile: {
        meta: { description: "Dry artifacts" },
        operations: [
          { op: "set_field", target: "Notes/A.md", field: "status", value: "active" },
        ],
      },
      patchFilePath: "Forge/Patches/vault-patch.yaml",
      runId: "dry-run-1",
      appliedAt: "2026-07-13T12:00:00",
    });

    assert.equal(shouldWritePatchRestoreManifest(settings, run), false);
    assert.equal(buildPatchRestoreManifestArtifact(settings, run), null);
    assert.equal(buildPatchArchiveArtifact(settings, run), null);

    const report = buildPatchReportArtifact(settings, run, { today: "2026-07-13" });
    assert.equal(report.folder, "Forge/Exports");
    assert.equal(report.path, "Forge/Exports/dry-run-1-patch-report-dry-run.md");
    assert.match(report.content, /patch_mode:: dry-run/);
  });

  it("evaluates and applies operation-level patch restore without host APIs", () => {
    const settings = createForgeSettings({ frontmatterFieldOrder: ["type", "status", "tags"] });
    const original = createForgeDocument({
      path: "Notes/A.md",
      content: "---\ntype: note\nstatus: draft\ntags:\n  - topic/a\n---\n# A\n",
      parseYaml: () => ({ type: "note", status: "draft", tags: ["topic/a"] }),
    });

    const applied = applyPatchToDocuments({
      documents: [original],
      settings,
      stringifyYaml,
      patchFile: {
        meta: { description: "Restore me", schema_version: "1.0.0" },
        operations: [
          { op: "set_field", target: "Notes/A.md", field: "status", value: "active" },
          { op: "add_tag", target: "Notes/A.md", tag: "topic/b" },
        ],
      },
      patchFilePath: "Forge/Patches/vault-patch.md",
      runId: "restore-run-1",
      appliedAt: "2026-07-13T12:00:00",
    });

    const manifest = buildPatchRestoreManifestArtifact(
      createForgeSettings({ patchesFolder: "Forge/Patches", patchGenerateManifest: true }),
      applied.run
    )?.data;
    assert.equal(isPatchRestoreManifest(manifest), true);

    const current = createForgeDocument({
      path: "Notes/A.md",
      content: applied.documents[0]?.contentAfter ?? "",
      parseYaml: () => ({ type: "note", status: "active", tags: ["topic/a", "topic/b"] }),
    });
    const candidates = evaluatePatchRestoreCandidates(manifest!, [current]);
    assert.deepEqual(candidates.map((candidate) => candidate.status), ["reversible", "reversible"]);

    const restored = applyPatchRestoreOperations({
      documents: [current],
      operations: candidates.map((candidate) => candidate.operation),
      settings,
      stringifyYaml,
    });

    assert.deepEqual(restored.results.map((result) => result.status), ["restored", "restored"]);
    assert.equal(restored.documents.length, 1);
    assert.equal(restored.documents[0]?.contentAfter, original.content);

    const report = buildPatchRestoreReportArtifact(
      createForgeSettings({ patchesFolder: "Forge/Patches" }),
      manifest!,
      restored.results,
      { today: "2026-07-13", restoredAt: "2026-07-13T13:00:00" }
    );
    assert.equal(report.path, "Forge/Patches/Reports/restore-run-1-patch-report-restore.md");
    assert.match(report.content, /patch_mode:: restore/);
    assert.match(report.content, /restored_count:: 2/);
  });

  it("reports legacy full-file restore counts without operation rows", () => {
    const manifest = {
      run_id: "legacy-run-1",
      patch_file: "Forge/Patches/vault-patch.md",
      description: "Legacy restore",
      applied_at: "2026-07-13T12:00:00",
      schema_version: "1.0.0",
      changes: [
        { file: "Notes/A.md", backup: "Forge/Patches/Backups/Notes_A.md.bak" },
        { file: "Notes/B.md", backup: "Forge/Patches/Backups/Notes_B.md.bak" },
      ],
    };

    const report = buildPatchRestoreReportArtifact(
      createForgeSettings({ patchesFolder: "Forge/Patches" }),
      manifest,
      [],
      {
        today: "2026-07-13",
        restoredAt: "2026-07-13T13:00:00",
        legacy: true,
        summary: { restored: 1, conflicted: 0, skipped: 0, errors: 1 },
      }
    );

    assert.match(report.content, /restore_legacy:: true/);
    assert.match(report.content, /restored_count:: 1/);
    assert.match(report.content, /error_count:: 1/);
    assert.match(report.content, /- Legacy full-file restore: yes/);
  });

  it("builds legacy patch restore candidates from archived patches and backups", () => {
    const manifest = {
      run_id: "legacy-run-2",
      patch_file: "Forge/Patches/vault-patch.md",
      description: "Legacy operation restore",
      applied_at: "2026-07-13T12:00:00",
      schema_version: "1.0.0",
      changes: [
        { file: "Notes/A.md", backup: "Forge/Patches/Backups/Notes_A.md.bak" },
      ],
    };
    const current = createForgeDocument({
      path: "Notes/A.md",
      content: "---\ntype: note\nstatus: active\ntags:\n  - topic/a\n  - topic/b\n---\nBody",
      parseYaml: () => ({ type: "note", status: "active", tags: ["topic/a", "topic/b"] }),
    });

    const candidates = buildLegacyPatchRestoreCandidates({
      patchFile: {
        meta: { description: "Legacy operation restore", schema_version: "1.0.0" },
        operations: [
          { op: "set_field", target: "Notes/A.md", field: "status", value: "active" },
          { op: "add_tag", target: "Notes/A.md", tag: "topic/b" },
        ],
      },
      manifest,
      currentDocuments: [current],
      backupDocuments: [
        { file: "Notes/A.md", frontmatter: { type: "note", status: "draft", tags: ["topic/a"] } },
      ],
    });

    assert.deepEqual(candidates.map((candidate) => candidate.status), ["reversible", "reversible"]);
    assert.deepEqual(candidates.map((candidate) => candidate.operation.op), ["set_field", "add_tag"]);
  });

  it("protects patch restore when current content diverged after apply", () => {
    const operation = {
      id: "op-00001",
      op_index: 0,
      op: "set_field",
      file_before: "Notes/A.md",
      file_after: "Notes/A.md",
      status: "changed" as const,
      label: "set_field status",
      target: { kind: "frontmatter_field" as const, field: "status" },
      before: { exists: true as const, value: "draft" },
      after: { exists: true as const, value: "active" },
      reverse: {
        kind: "set_field" as const,
        field: "status",
        value: "draft",
        delete_if_missing_before: false,
      },
    };
    const document = createForgeDocument({
      path: "Notes/A.md",
      content: "---\ntype: note\nstatus: blocked\n---\n# A\n",
      parseYaml: () => ({ type: "note", status: "blocked" }),
    });
    const manifest = {
      manifest_version: 2,
      run_id: "restore-run-2",
      patch_file: "Forge/Patches/vault-patch.md",
      description: "Conflict",
      applied_at: "2026-07-13T12:00:00",
      schema_version: "1.0.0",
      changes: [],
      operations: [operation],
    };

    const candidates = evaluatePatchRestoreCandidates(manifest, [document]);
    assert.equal(candidates[0]?.status, "conflicted");

    const restored = applyPatchRestoreOperations({
      documents: [document],
      operations: [operation],
      settings: createForgeSettings({ frontmatterFieldOrder: ["type", "status"] }),
      stringifyYaml,
    });

    assert.equal(restored.results[0]?.status, "conflicted");
    assert.equal(restored.documents.length, 0);
  });

  it("merges and normalizes effective settings without host APIs", () => {
    const settings = createForgeSettings({
      forgeFolder: "/Forge/",
      schemaNoteFolder: "\\Forge\\Registry\\",
      lintExcludeInboxFolder: true,
      inboxFolder: "Inbox/",
      shapeLintEnabled: true,
      shapeLintScope: "folder",
      shapeLintFolders: [" Work ", "/System/"],
      shapeTemplatesFolder: "Forge\\Templates",
    }, {
      schemaNoteFolder: "Custom/Registry",
      legacySetting: true,
    } as Partial<ForgeSettings> & Record<string, unknown>);

    assert.equal(settings.forgeFolder, "Forge");
    assert.equal(settings.schemaNoteFolder, "Custom/Registry");
    assert.equal(settings.lintExcludeInboxFolder, true);
    assert.equal(settings.inboxFolder, "Inbox");
    assert.equal(settings.shapeLintEnabled, true);
    assert.equal(settings.shapeLintAllowEmptySections, false);
    assert.equal(settings.shapeLintScope, "folder");
    assert.deepEqual(settings.shapeLintFolders, ["Work", "System"]);
    assert.equal(settings.shapeTemplatesFolder, "Forge/Templates");
    assert.equal(settings.dashboardFileInventoryEnabled, false);
    assert.equal(settings.dashboardRefreshExportsEnabled, false);
    assert.equal("legacySetting" in settings, false);
  });

  it("keeps frontmatter presence when YAML parsing fails", () => {
    const document = createForgeDocument({
      path: "Broken.md",
      content: "---\n: bad\n---\nBody\n",
      parseYaml: () => {
        throw new Error("bad yaml");
      },
    });

    assert.equal(document.hasFrontmatter, true);
    assert.deepEqual(document.frontmatter, {});
    assert.equal(document.basename, "Broken");
    assert.equal(document.extension, "md");
  });

  it("plans tag normalization without host APIs", () => {
    const plan = planNormalizeTags({
      type: "note",
      tags: ["topic:z", "domain/project", "Topic/A", "topic/a"],
    });

    assert.equal(plan.changed, true);
    assert.deepEqual(plan.frontmatter.tags, ["Topic/A", "topic/z"]);
    assert.deepEqual(plan.details, [
      "1 separator(s) fixed",
      "1 invalid tag(s) removed",
      "sorted/deduped",
    ]);
  });

  it("plans frontmatter normalization without mutating the source", () => {
    const source = {
      Type: "Project",
      tags: ["Topic/B"],
    };
    const plan = planNormalizeFrontmatter(source, ["type"]);

    assert.equal(plan.changed, true);
    assert.deepEqual(source, {
      Type: "Project",
      tags: ["Topic/B"],
    });
    assert.deepEqual(plan.frontmatter, {
      type: "project",
      tags: ["topic/b"],
    });
    assert.deepEqual(plan.details, [
      "1 field name(s) lowercased",
      "type value lowercased",
      "tags lowercased",
    ]);
  });

  it("parses a schema note through an injected YAML parser", () => {
    const schema = parseSchemaNote(
      [
        "---",
        "version: 1.0.0",
        "---",
        "version:: 1.0.0",
        "# Contract",
        "```yaml",
        "frontmatter:",
        "```",
      ].join("\n"),
      { parseYaml }
    );

    assert.equal(schema?.version, "1.0.0");
    assert.equal(schema?.frontmatter.required[0]?.name, "type");
  });

  it("parses unique frontmatter field declarations", () => {
    const schema = parseSchemaNote(
      [
        "---",
        "version: 1.0.0",
        "---",
        "version:: 1.0.0",
        "# Contract",
        "```yaml",
        "frontmatter:",
        "```",
      ].join("\n"),
      {
        parseYaml: (source) => source.includes("frontmatter:")
          ? {
            frontmatter: {
              required: [
                { name: "note_id", type: "string", severity: "error", unique: true },
              ],
              optional: [],
            },
          }
          : { version: "1.0.0" },
      }
    );

    assert.equal(schema?.frontmatter.required[0]?.name, "note_id");
    assert.equal(schema?.frontmatter.required[0]?.unique, true);
  });

  it("parses frontmatter field pattern declarations", () => {
    const schema = parseSchemaNote(
      [
        "---",
        "version: 1.0.0",
        "---",
        "version:: 1.0.0",
        "# Contract",
        "```yaml",
        "frontmatter:",
        "```",
      ].join("\n"),
      {
        parseYaml: (source) => source.includes("frontmatter:")
          ? {
            frontmatter: {
              required: [],
              optional: [
                {
                  name: "note_id",
                  type: "string",
                  severity: "error",
                  unique: true,
                  pattern: "^kac-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
                },
              ],
            },
          }
          : { version: "1.0.0" },
      }
    );

    assert.equal(schema?.frontmatter.optional[0]?.name, "note_id");
    assert.equal(schema?.frontmatter.optional[0]?.unique, true);
    assert.equal(
      schema?.frontmatter.optional[0]?.pattern,
      "^kac-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    );
  });

  it("only enables unique fields from a boolean schema value", () => {
    const schema = parseSchemaNote(
      [
        "---",
        "version: 1.0.0",
        "---",
        "version:: 1.0.0",
        "# Contract",
        "```yaml",
        "frontmatter:",
        "```",
      ].join("\n"),
      {
        parseYaml: (source) => source.includes("frontmatter:")
          ? {
            frontmatter: {
              required: [
                { name: "note_id", type: "string", severity: "error", unique: "true" },
              ],
              optional: [],
            },
          }
          : { version: "1.0.0" },
      }
    );

    assert.equal(schema?.frontmatter.required[0]?.unique, undefined);
  });

  it("requires unique schema declarations to be boolean", () => {
    const issues = validateSchemaNote(
      [
        "---",
        "version: 1.0.0",
        "---",
        "version:: 1.0.0",
        "# Contract",
        "```yaml",
        "frontmatter:",
        "```",
      ].join("\n"),
      {
        parseYaml: () => ({
          frontmatter: {
            required: [
              { name: "note_id", type: "string", severity: "error", unique: "true" },
            ],
            optional: [],
          },
          inline: { allowed: [] },
          ontology: { relationships: {} },
          tag_rules: {
            require_namespace: true,
            unknown_tags: "warning",
            severity: "warning",
            allowed_namespaces: [],
          },
          exempt_paths: [],
        }),
      }
    );

    assert.deepEqual(
      issues.filter((issue) => issue.message.includes("unique")).map((issue) => issue.message),
      ["frontmatter.required[0] ('note_id') unique must be true or false"]
    );
  });

  it("requires pattern schema declarations to be valid regular expression strings", () => {
    const issues = validateSchemaNote(
      [
        "---",
        "version: 1.0.0",
        "---",
        "version:: 1.0.0",
        "# Contract",
        "```yaml",
        "frontmatter:",
        "```",
      ].join("\n"),
      {
        parseYaml: () => ({
          frontmatter: {
            required: [
              { name: "note_id", type: "string", severity: "error", pattern: 42 },
              { name: "external_id", type: "string", severity: "warning", pattern: "[" },
            ],
            optional: [],
          },
          inline: { allowed: [] },
          ontology: { relationships: {} },
          tag_rules: {
            require_namespace: true,
            unknown_tags: "warning",
            severity: "warning",
            allowed_namespaces: [],
          },
          exempt_paths: [],
        }),
      }
    );

    assert.deepEqual(
      issues.filter((issue) => issue.message.includes("pattern")).map((issue) => issue.message),
      [
        "frontmatter.required[0] ('note_id') pattern must be a string",
        "frontmatter.required[1] ('external_id') pattern must be a valid regular expression",
      ]
    );
  });

  it("returns null for unparseable schema contracts", () => {
    const schema = parseSchemaNote(
      [
        "---",
        "version: 1.0.0",
        "---",
        "version:: 1.0.0",
        "# Contract",
        "```yaml",
        "frontmatter:",
        "```",
      ].join("\n"),
      {
        parseYaml: () => {
          throw new Error("bad schema yaml");
        },
      }
    );

    assert.equal(schema, null);
  });

  it("runs lint rules over plain documents", () => {
    const schema = parseSchemaNote(
      [
        "---",
        "version: 1.0.0",
        "---",
        "version:: 1.0.0",
        "# Contract",
        "```yaml",
        "frontmatter:",
        "```",
      ].join("\n"),
      { parseYaml }
    ) as VaultSchema;

    const result = runLintForDocuments({
      schema,
      settings: DEFAULT_SETTINGS,
      documents: [
        {
          path: "Projects/Example.md",
          basename: "Example",
          extension: "md",
          content: "---\ntype: note\ntags:\n  - badtag\n---\nstatus:: active\n",
          hasFrontmatter: true,
          frontmatter: {
            type: "note",
            tags: ["badtag"],
          },
          stat: { mtime: Date.now() },
        },
      ],
    });

    assert.equal(result.envelope.notes_scanned, 1);
    assert.deepEqual(result.results.map((item) => item.rule), [
      "required_field",
      "enum_value",
      "tag_namespace",
      "inline_is_schema_field",
    ]);
    assert.deepEqual(result.results.find((item) => item.rule === "enum_value")?.range, {
      start: { line: 1, character: 0 },
      end: { line: 1, character: 10 },
    });
    assert.deepEqual(result.results.find((item) => item.rule === "inline_is_schema_field")?.range, {
      start: { line: 5, character: 0 },
      end: { line: 5, character: 6 },
    });
  });

  it("ignores non-markdown documents during lint scans", () => {
    const schema = parseSchemaNote(
      [
        "---",
        "version: 1.0.0",
        "---",
        "version:: 1.0.0",
        "# Contract",
        "```yaml",
        "frontmatter:",
        "```",
      ].join("\n"),
      { parseYaml }
    ) as VaultSchema;

    const result = runLintForDocuments({
      schema,
      settings: DEFAULT_SETTINGS,
      documents: [
        createForgeDocument({
          path: "Assets/Broken.pdf",
          content: "",
          parseYaml,
        }),
        createForgeDocument({
          path: "Assets/Broken.json",
          content: "---\ntype: wrong\ntags:\n  - badtag\n---\nstatus:: active\n",
          parseYaml,
        }),
      ],
    });

    assert.equal(result.envelope.notes_scanned, 0);
    assert.deepEqual(result.results, []);
  });

  it("reports duplicate frontmatter values only when schema marks the field unique", () => {
    const documents = [
      createForgeDocument({
        path: "Notes/A.md",
        content: "---\nnote_id: Alpha\n---\n# A\n",
        parseYaml: () => ({ note_id: "Alpha" }),
      }),
      createForgeDocument({
        path: "Notes/B.md",
        content: "---\nnote_id: alpha \n---\n# B\n",
        parseYaml: () => ({ note_id: "alpha " }),
      }),
    ];
    const schema: VaultSchema = {
      version: "1.0.0",
      frontmatter: {
        required: [
          { name: "note_id", type: "string", severity: "error" },
        ],
        optional: [],
      },
      inline: { allowed: [] },
      ontology: { relationships: {} },
      tag_rules: {
        require_namespace: false,
        unknown_tags: "off",
        severity: "warning",
        allowed_namespaces: [],
        forbidden_namespaces: [],
      },
      exempt_paths: [],
    };

    const withoutUnique = runLintForDocuments({
      schema,
      settings: DEFAULT_SETTINGS,
      documents,
    });
    assert.equal(withoutUnique.results.some((issue) => issue.rule === "unique_field"), false);

    const withUnique = runLintForDocuments({
      schema: {
        ...schema,
        frontmatter: {
          ...schema.frontmatter,
          required: [{ ...schema.frontmatter.required[0], unique: true }],
        },
      },
      settings: DEFAULT_SETTINGS,
      documents,
    });

    const duplicateIssues = withUnique.results.filter((issue) => issue.rule === "unique_field");
    assert.equal(duplicateIssues.length, 2);
    assert.deepEqual(duplicateIssues.map((issue) => issue.file).sort(), ["Notes/A.md", "Notes/B.md"]);
    assert.match(duplicateIssues[0]?.message ?? "", /Field 'note_id' value 'Alpha' must be unique/);
  });

  it("reports frontmatter values that do not match schema patterns", () => {
    const schema: VaultSchema = {
      version: "1.0.0",
      frontmatter: {
        required: [
          { name: "type", type: "string", severity: "error" },
        ],
        optional: [
          {
            name: "note_id",
            type: "string",
            severity: "error",
            pattern: "^kac-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
          },
        ],
      },
      inline: { allowed: [] },
      ontology: { relationships: {} },
      tag_rules: {
        require_namespace: false,
        unknown_tags: "off",
        severity: "warning",
        allowed_namespaces: [],
        forbidden_namespaces: [],
      },
      exempt_paths: [],
    };

    const result = runLintForDocuments({
      schema,
      settings: DEFAULT_SETTINGS,
      documents: [
        createForgeDocument({
          path: "Notes/Valid.md",
          content: "---\ntype: note\nnote_id: kac-11111111-1111-4111-8111-111111111111\n---\n# Valid\n",
          parseYaml: () => ({ type: "note", note_id: "kac-11111111-1111-4111-8111-111111111111" }),
        }),
        createForgeDocument({
          path: "Notes/MissingOptional.md",
          content: "---\ntype: note\n---\n# Missing Optional\n",
          parseYaml: () => ({ type: "note" }),
        }),
        createForgeDocument({
          path: "Notes/Invalid.md",
          content: "---\ntype: note\nnote_id: wrong-11111111-1111-4111-8111-111111111111\n---\n# Invalid\n",
          parseYaml: () => ({ type: "note", note_id: "wrong-11111111-1111-4111-8111-111111111111" }),
        }),
      ],
    });

    const patternIssues = result.results.filter((issue) => issue.rule === "pattern_mismatch");
    assert.equal(patternIssues.length, 1);
    assert.equal(patternIssues[0]?.file, "Notes/Invalid.md");
    assert.match(patternIssues[0]?.message ?? "", /Field 'note_id' value 'wrong-/);
  });

  it("exempts generated control-plane notes from lint scans", () => {
    const schema: VaultSchema = {
      version: "1.0.0",
      frontmatter: {
        required: [
          { name: "type", type: "enum", values: ["note"], severity: "error" },
        ],
        optional: [],
      },
      inline: { allowed: [] },
      ontology: { relationships: {} },
      tag_rules: {
        require_namespace: false,
        unknown_tags: "off",
        severity: "warning",
        allowed_namespaces: [],
        forbidden_namespaces: [],
      },
      exempt_paths: [],
    };
    const settings = createForgeSettings({
      forgeFolder: "Forge",
      exportsFolder: "System/Exports",
      lintRunsFolder: "System/LintRuns",
      shapeRepairRunsFolder: "System/Exports/ShapeRepairRuns",
      patchesFolder: "Ops/Patches",
      patchBackupFolder: "Ops/Backups",
    });

    const result = runLintForDocuments({
      schema,
      settings,
      documents: [
        createForgeDocument({
          path: "Work/Note.md",
          content: "---\ntype: note\n---\n# Note\n",
          parseYaml: () => ({ type: "note" }),
        }),
        createForgeDocument({
          path: "System/Exports/ShapeRepairRuns/shape-repair-2026-07-13.md",
          content: "# Generated run note\n",
          parseYaml: () => ({}),
        }),
        createForgeDocument({
          path: "Ops/Patches/vault-patch.md",
          content: "# Patch scratch\n",
          parseYaml: () => ({}),
        }),
      ],
    });

    assert.equal(result.envelope.notes_scanned, 1);
    assert.deepEqual(result.results, []);
  });

  it("discovers valid shapes from documents during lint", () => {
    const schema: VaultSchema = {
      version: "1.0.0",
      frontmatter: {
        required: [
          { name: "type", type: "enum", values: ["project", "shape"], severity: "error" },
        ],
        optional: [
          { name: "shapes", type: "list", severity: "warning" },
        ],
      },
      inline: { allowed: [] },
      ontology: { relationships: {} },
      tag_rules: {
        require_namespace: false,
        unknown_tags: "off",
        severity: "warning",
        allowed_namespaces: [],
        forbidden_namespaces: [],
      },
      exempt_paths: [],
    };

    const result = runLintForDocuments({
      schema,
      settings: {
        ...DEFAULT_SETTINGS,
        shapesFolder: "Forge/Shapes",
      },
      documents: [
        {
          path: "Work/Example.md",
          basename: "Example",
          extension: "md",
          content: "---\ntype: project\nshapes:\n  - project\n  - missing\n---\n",
          hasFrontmatter: true,
          frontmatter: {
            type: "project",
            shapes: ["project", "missing"],
          },
        },
        {
          path: "Forge/Shapes/project.md",
          basename: "project",
          extension: "md",
          content: "---\ntype: shape\n---\n",
          hasFrontmatter: true,
          frontmatter: {
            type: "shape",
          },
        },
      ],
    });

    assert.deepEqual(result.results.map((item) => item.rule), ["invalid_shape_ref"]);
    assert.equal(
      result.results[0]?.message,
      "Field 'shapes' contains 'missing', which is not a valid shape in Forge/Shapes/"
    );
  });

  it("generates vault documentation notes with metadata and placeholders", () => {
    const docs = buildForgeDocumentation(
      createForgeSettings({
        forgeFolder: "Forge",
        patchesFolder: "Forge/Patches",
        patchDefaultFile: "Forge/Patches/vault-patch.md",
        schemaNoteFolder: "Forge/Registry",
        schemaNoteFile: "schema.md",
        exportsFolder: "Forge/Exports",
        inboxFolder: "Inbox",
        shapesFolder: "Forge/Shapes",
      }),
      {
        docs: {
          "1. Start Here": "Patch file: {{patchFile}}\nUnknown: {{missing}}",
        },
        examples: {
          "patches/1. Basic Patch Example": "Schema: {{schemaFile}}",
        },
      },
      { today: "2026-07-13" }
    );

    assert.deepEqual(docs.map((doc) => doc.path), [
      "Forge/Docs/1. Start Here.md",
      "Forge/Examples/patches/1. Basic Patch Example.md",
    ]);
    assert.match(docs[0]?.content ?? "", /type: reference/);
    assert.match(docs[0]?.content ?? "", /created: 2026-07-13/);
    assert.match(docs[0]?.content ?? "", / {2}- tool\/forge/);
    assert.match(docs[0]?.content ?? "", / {2}- topic\/onboarding/);
    assert.match(docs[0]?.content ?? "", /Patch file: Forge\/Patches\/vault-patch.md/);
    assert.match(docs[0]?.content ?? "", /Unknown: \{\{missing\}\}/);
    assert.match(docs[1]?.content ?? "", /type: procedure/);
    assert.match(docs[1]?.content ?? "", /Schema: Forge\/Registry\/schema.md/);
  });
});
