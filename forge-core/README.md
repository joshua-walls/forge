# Forge Core

Host-independent Forge logic shared by the Obsidian plugin and VS Code extension.

This package accepts plain TypeScript data and returns plain TypeScript data. It must not import `obsidian`, `vscode`, host UI APIs, or host filesystem objects.

## Current Public API

- Settings, path, tag, preview, frontmatter, schema, lint, and dashboard models
- Tag normalization helpers
- Frontmatter field ordering and field access helpers
- Repairable lint filtering, schema-driven default repair operations, repair candidate planning, tag repair matching, and repair patch note content generation
- Shape repair planning, Markdown heading repair, history JSON, and run-note artifact builders
- Vault overview export and ontology index artifact builders
- Vault documentation and examples note builder
- Shared patch note template generation, patch models, patch file parsing, dry-run planning, host-neutral Markdown patch application, operation-level patch restore, and patch run artifact builders
- Schema note parsing and validation with caller-provided YAML parsing
- Lint execution over plain `ForgeDocument` inputs
- `buildDashboardSummary(input)`
- `sortDashboardIssuesBySeverity(issues)`
- `createWorkspaceHealthResult(summary)`

## Local Development

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

Consumers may use a local dependency while this package is not published:

```json
{
  "dependencies": {
    "@forge/core": "file:../forge-core"
  }
}
```

Obsidian and VS Code builds must bundle this package into their extension output. End users should never install `@forge/core` separately.
