// src/docs.ts
// Bundled Vault Forge documentation installer.
// Writes vault-native onboarding notes into the configured Vault Forge folder.

import { App, Notice, TFile, normalizePath } from "obsidian";
import type { VaultForgeSettings } from "./settings";
import { getVaultPaths } from "./vault-paths";
import { ensureFolder, todayString } from "./utils/files";

interface GeneratedDoc {
  path: string;
  content: string;
}

interface DocContext {
  today: string;
  vaultForge: string;
  docsFolder: string;
  examplesFolder: string;
  patchesFolder: string;
  patchFile: string;
  schemaFile: string;
  exportsFolder: string;
  inboxFolder: string;
  patternsFolder: string;
}

export async function installVaultForgeDocumentation(
  app: App,
  settings: VaultForgeSettings
): Promise<void> {
  const paths = getVaultPaths(settings);
  const today = todayString();
  const ctx: DocContext = {
    today,
    vaultForge: paths.vaultForge,
    docsFolder: `${paths.vaultForge}/Docs`,
    examplesFolder: `${paths.vaultForge}/Examples`,
    patchesFolder: paths.patches,
    patchFile: paths.patchFile,
    schemaFile: paths.schemaMd,
    exportsFolder: paths.exports,
    inboxFolder: paths.inbox,
    patternsFolder: paths.patterns,
  };

  await ensureFolder(app, ctx.docsFolder);
  await ensureFolder(app, ctx.examplesFolder);

  const docs = buildDocumentation(ctx);
  let written = 0;
  let skipped = 0;

  for (const doc of docs) {
    const path = normalizePath(doc.path);
    const existing = app.vault.getAbstractFileByPath(path);

    if (existing instanceof TFile) {
      skipped += 1;
      continue;
    }

    const folder = path.includes("/")
      ? path.substring(0, path.lastIndexOf("/"))
      : "";

    if (folder) await ensureFolder(app, folder);

    await app.vault.create(path, doc.content);
    written += 1;
  }

  new Notice(
    `Vault Forge docs installed: ${written} written, ${skipped} skipped.`,
    6000
  );
}

function buildDocumentation(ctx: DocContext): GeneratedDoc[] {
  return [
    doc(ctx, "Docs/START-HERE.md", "Start Here", "reference", "active", ["tool/vault-forge", "topic/onboarding"], startHere(ctx)),
    doc(ctx, "Docs/INSTALLATION.md", "Installation", "reference", "active", ["tool/vault-forge", "topic/onboarding"], installation(ctx)),
    doc(ctx, "Docs/VAULT-STRUCTURE.md", "Vault Structure", "reference", "active", ["tool/vault-forge", "topic/schema"], vaultStructure(ctx)),
    doc(ctx, "Docs/SCHEMA.md", "Schema", "reference", "active", ["tool/vault-forge", "topic/schema"], schemaDoc(ctx)),
    doc(ctx, "Docs/LINTING.md", "Linting", "reference", "active", ["tool/vault-forge", "topic/schema"], linting(ctx)),
    doc(ctx, "Docs/PATCHES.md", "Patches", "reference", "active", ["tool/vault-forge", "topic/procedure"], patches(ctx)),
    doc(ctx, "Docs/COMMANDS.md", "Commands", "reference", "active", ["tool/vault-forge", "topic/reference"], commands(ctx)),
    doc(ctx, "Docs/SETTINGS.md", "Settings", "reference", "active", ["tool/vault-forge", "topic/reference"], settingsDoc(ctx)),
    doc(ctx, "Docs/TROUBLESHOOTING.md", "Troubleshooting", "reference", "active", ["tool/vault-forge", "topic/procedure"], troubleshooting(ctx)),
    doc(ctx, "Examples/schema.md", "Example Schema", "reference", "active", ["tool/vault-forge", "topic/schema"], exampleSchema(ctx)),
    doc(ctx, "Examples/vault-patch.md", "Example Vault Patch", "procedure", "draft", ["tool/vault-forge", "topic/procedure"], examplePatch(ctx)),
  ];
}

function doc(
  ctx: DocContext,
  relativePath: string,
  title: string,
  type: string,
  status: string,
  tags: string[],
  body: string
): GeneratedDoc {
  return {
    path: `${ctx.vaultForge}/${relativePath}`,
    content: [
      "---",
      `type: ${type}`,
      `status: ${status}`,
      "tags:",
      ...tags.map((tag) => `  - ${tag}`),
      `created: ${ctx.today}`,
      `updated: ${ctx.today}`,
      "ai_private: false",
      "review_cycle: never",
      "---",
      "",
      `# ${title}`,
      "",
      body.trim(),
      "",
    ].join("\n"),
  };
}

function startHere(ctx: DocContext): string {
  return `Vault Forge is a schema-driven governance plugin for Obsidian.

It helps keep a vault structurally healthy through linting, patch operations, tag normalization, frontmatter normalization, repair workflows, and maintenance routines.

## Who this is for

Vault Forge is for people who treat their Obsidian vault as a long-lived knowledge system rather than a loose pile of notes.

It is useful when you want:

- consistent frontmatter
- predictable tags
- schema validation
- safe bulk edits
- patch history
- repeatable maintenance

## What Vault Forge is not

Vault Forge is not an AI assistant, template engine, or note-taking methodology.

It does not decide what your vault means. It enforces the structure you define.

## First setup checklist

1. Confirm your Vault Forge folder in settings.
2. Create or choose a schema note.
3. Click **Load from Schema** in Vault Forge settings.
4. Run **Vault Forge: Validate Schema**.
5. Run **Vault Forge: Run Vault Lint**.
6. Create a patch note at your configured patch path.
7. Run **Vault Forge: Apply Vault Patch**.

## Current configured locations

| Purpose | Path |
|---|---|
| Vault Forge folder | \`${ctx.vaultForge}\` |
| Docs | \`${ctx.docsFolder}\` |
| Examples | \`${ctx.examplesFolder}\` |
| Schema note | \`${ctx.schemaFile}\` |
| Patch note | \`${ctx.patchFile}\` |
| Patches folder | \`${ctx.patchesFolder}\` |
| Exports folder | \`${ctx.exportsFolder}\` |

## Recommended reading order

1. [[INSTALLATION]]
2. [[VAULT-STRUCTURE]]
3. [[SCHEMA]]
4. [[LINTING]]
5. [[PATCHES]]
6. [[COMMANDS]]
7. [[SETTINGS]]
8. [[TROUBLESHOOTING]]`;
}

function installation(ctx: DocContext): string {
  return `## Install manually

Copy the release assets into your Obsidian plugin folder:

\`\`\`text
.obsidian/plugins/vault-forge/
├── main.js
├── manifest.json
└── styles.css
\`\`\`

Then enable **Vault Forge** in Obsidian settings.

## Updating

Recommended update process:

1. Disable Vault Forge in Obsidian.
2. Replace \`main.js\`, \`manifest.json\`, and \`styles.css\`.
3. Re-enable Vault Forge.

Disabling the plugin first avoids stale loaded code during file replacement.

## iOS notes

On iOS, the \`.obsidian\` folder may be hidden by the Files app.

The most reliable approach is to install or update the plugin on desktop and let Obsidian Sync or iCloud move the files to iOS.

## Verify installation

Open the command palette and search for:

\`\`\`text
Vault Forge
\`\`\`

You should see commands such as:

- Vault Forge: Run Vault Lint
- Vault Forge: Apply Vault Patch
- Vault Forge: Validate Schema
- Vault Forge: Install Documentation

## Documentation location

This documentation was installed into:

\`\`\`text
${ctx.docsFolder}
\`\`\`

Examples were installed into:

\`\`\`text
${ctx.examplesFolder}
\`\`\``;
}

function vaultStructure(ctx: DocContext): string {
  return `Vault Forge works best when system files live in a predictable place.

It does not require the folder to be named \`System/VaultForge\`. It uses the Vault Forge folder configured in settings.

## Current configured structure

\`\`\`text
${ctx.vaultForge}/
├── config.md
├── Docs/
├── Examples/
├── Indexes/
└── Patches/
    ├── vault-patch.md
    ├── Applied/
    ├── Backups/
    └── Reports/
\`\`\`

## Folder meanings

| Folder | Purpose |
|---|---|
| \`${ctx.docsFolder}\` | Vault-native documentation |
| \`${ctx.examplesFolder}\` | Starter schema and patch examples |
| \`${ctx.patchesFolder}\` | Active patch note and patch history |
| \`${ctx.patchesFolder}/Applied\` | Archived applied patch notes |
| \`${ctx.patchesFolder}/Backups\` | File backups created before patch changes |
| \`${ctx.patchesFolder}/Reports\` | Patch reports and restore manifests |
| \`${ctx.exportsFolder}\` | Lint reports and export outputs |

## Why this structure exists

Vault Forge treats vault operations as first-class notes and files.

Patch notes, reports, examples, and docs stay inside the vault so they are searchable, linkable, syncable, and reviewable.`;
}

function schemaDoc(ctx: DocContext): string {
  return `Vault Forge validates notes against a schema note.

Current configured schema path:

\`\`\`text
${ctx.schemaFile}
\`\`\`

## Schema format

A schema is a markdown note with normal frontmatter and a fenced YAML block.

The YAML block describes fields, allowed values, tag rules, lint output, and patch engine rules.

## Required fields

Required fields define the frontmatter every normal note should have.

Example:

\`\`\`yaml
required_fields:
  - name: type
    type: enum
    values: [reference, procedure, project]
    severity: error

  - name: status
    type: enum
    values: [draft, active, complete, archived]
    severity: error
\`\`\`

## Supported field types

Vault Forge commonly uses:

- \`enum\`
- \`list\`
- \`date\`
- \`boolean\`

## Severity

Severity controls how lint results are reported.

| Severity | Meaning |
|---|---|
| \`error\` | Must be fixed |
| \`warning\` | Should be reviewed |
| \`info\` | Informational |

## Loading schema fields into settings

After creating or updating the schema:

1. Open Vault Forge settings.
2. Confirm the schema note path.
3. Click **Load from Schema**.

Vault Forge uses schema fields for linting. Enum fields can also appear in the Field Identity settings.

## Example

See:

\`\`\`text
${ctx.examplesFolder}/schema.md
\`\`\``;
}

function linting(ctx: DocContext): string {
  return `Linting checks vault notes against the configured schema.

Run it from the command palette:

\`\`\`text
Vault Forge: Run Vault Lint
\`\`\`

## What lint checks

Vault Forge can validate:

- required frontmatter fields
- field types
- enum values
- date formats
- required tags
- tag namespace rules
- exempt paths

## Reports

Lint reports are written under:

\`\`\`text
${ctx.exportsFolder}
\`\`\`

Common outputs include:

- \`lint-report.json\`
- \`lint-history.json\`
- lint run notes

## Strict mode

Strict mode treats warnings as errors.

Use strict mode when your schema is mature. Leave it off while designing a new schema.

## Repair workflow

The repair workflow is command-driven:

1. Run **Vault Forge: Run Vault Lint**.
2. Run **Vault Forge: Vault Repair**.
3. Review the generated patch.
4. Apply the patch.
5. Run lint again.

This keeps fixes explicit instead of silently changing your vault.`;
}

function patches(ctx: DocContext): string {
  return `Patches are explicit vault operations stored as markdown notes.

Current configured patch note:

\`\`\`text
${ctx.patchFile}
\`\`\`

## Patch note format

A patch note is a valid vault note with a fenced YAML block.

\`\`\`md
---
type: procedure
status: draft
tags:
  - tool/vault-forge
created: ${ctx.today}
updated: ${ctx.today}
ai_private: false
review_cycle: never
---

# Vault Patch

## Patch

\`\`\`yaml
operations:
  - op: set_field
    target: "Home.md"
    field: status
    value: active
\`\`\`
\`\`\`

## Patch lifecycle

1. Edit the active patch note.
2. Run **Vault Forge: Apply Vault Patch**.
3. Review the dry-run confirmation.
4. Confirm apply.
5. Vault Forge writes backups, reports, and archive copies.

## Patch folders

| Folder | Purpose |
|---|---|
| \`${ctx.patchesFolder}\` | Active patch note |
| \`${ctx.patchesFolder}/Applied\` | Archived applied patch notes |
| \`${ctx.patchesFolder}/Backups\` | Backups before changes |
| \`${ctx.patchesFolder}/Reports\` | Reports and manifests |

## Supported operations

### set_field

\`\`\`yaml
operations:
  - op: set_field
    target: "Home.md"
    field: status
    value: active
\`\`\`

### remove_field

\`\`\`yaml
operations:
  - op: remove_field
    target: "Home.md"
    field: old_field
\`\`\`

### add_tag

\`\`\`yaml
operations:
  - op: add_tag
    target: "Home.md"
    tag: topic/home
\`\`\`

### remove_tag

\`\`\`yaml
operations:
  - op: remove_tag
    target: "Home.md"
    tag: topic/old
\`\`\`

### replace_tag

\`\`\`yaml
operations:
  - op: replace_tag
    target_pattern: "Projects/**/*.md"
    old_tag: topic/old
    new_tag: topic/new
\`\`\`

### normalize_tags

\`\`\`yaml
operations:
  - op: normalize_tags
    target_pattern: "Projects/**/*.md"
\`\`\`

### sort_frontmatter

\`\`\`yaml
operations:
  - op: sort_frontmatter
    target_pattern: "Notes/**/*.md"
\`\`\`

### move_note

\`\`\`yaml
operations:
  - op: move_note
    target: "Inbox/Example.md"
    source_root: "Inbox"
    destination_folder: "Notes"
\`\`\`

## Safety

Keep backups enabled unless you have a specific reason to disable them.`;
}

function commands(ctx: DocContext): string {
  return `## Apply Vault Patch

Loads the configured patch note, performs a dry run, asks for confirmation, then applies changes.

Configured patch note:

\`\`\`text
${ctx.patchFile}
\`\`\`

## Run Vault Lint

Validates vault notes against the configured schema.

## Validate Schema

Parses and validates the schema note itself.

## Normalize Tags

Sorts and deduplicates tag lists.

## Normalize Frontmatter

Reorders frontmatter fields into the plugin's canonical order.

## Vault Maintenance

Applies retention cleanup for backups, inbox files, lint history, and patch reports.

## Vault Repair

Builds a repair patch from lint results so fixes can be reviewed and applied explicitly.

## Restore Patch Run

Uses a restore manifest to restore files from backups created during a patch run.

## Rename Dataview Folder

Updates Dataview folder references after a folder rename.

## Install Documentation

Installs this documentation into the configured Vault Forge folder.`;
}

function settingsDoc(ctx: DocContext): string {
  return `Vault Forge settings are stored in the plugin data file and mirrored to a generated config note.

Generated config note:

\`\`\`text
${ctx.vaultForge}/config.md
\`\`\`

Do not hand-edit the generated config note. Change settings in Obsidian instead.

## Field Identity

Field Identity tells Vault Forge which frontmatter fields carry semantic meaning.

Examples:

- type
- status
- tags
- created
- updated

Use **Load from Schema** to populate these from your schema.

## System Paths

System paths control where Vault Forge looks for schema, patches, exports, inbox notes, and pattern notes.

Important current paths:

| Setting | Current path |
|---|---|
| Vault Forge folder | \`${ctx.vaultForge}\` |
| Schema note | \`${ctx.schemaFile}\` |
| Exports folder | \`${ctx.exportsFolder}\` |
| Patches folder | \`${ctx.patchesFolder}\` |
| Inbox folder | \`${ctx.inboxFolder}\` |
| Patterns folder | \`${ctx.patternsFolder}\` |

## Patch Settings

Patch settings control backups, restore manifests, default patch note, auto-lint, and auto-maintenance.

Recommended defaults:

- backups enabled
- restore manifest enabled
- auto-lint after patch enabled
- auto-maintenance after patch disabled

## Lint Settings

Lint settings control strict mode and lint run retention.

## Maintenance Settings

Maintenance settings control how long generated operational files are retained.`;
}

function troubleshooting(ctx: DocContext): string {
  return `## Patch file not found

Check Vault Forge settings and confirm the default patch file points to an existing note.

Recommended patch path:

\`\`\`text
${ctx.patchFile}
\`\`\`

If the note does not exist, running **Apply Vault Patch** can create a starter patch note.

## Patch note has no YAML block

Patch notes must contain a fenced YAML block:

\`\`\`md
## Patch

\`\`\`yaml
operations: []
\`\`\`
\`\`\`

## Schema not loading

Check:

- the schema note exists
- the schema setting points to the right note
- the schema has a fenced YAML block
- the YAML is valid

Configured schema path:

\`\`\`text
${ctx.schemaFile}
\`\`\`

## Plugin update did not take effect

Disable Vault Forge before replacing plugin files, then re-enable it.

Files to replace:

\`\`\`text
main.js
manifest.json
styles.css
\`\`\`

## Reports not generated

Check that the reports folder exists or can be created:

\`\`\`text
${ctx.patchesFolder}/Reports
\`\`\`

## Backups not generated

Check that backups are enabled in settings.

Backups are written to:

\`\`\`text
${ctx.patchesFolder}/Backups
\`\`\``;
}

function exampleSchema(ctx: DocContext): string {
  return `This is a small example schema. Copy the YAML block into your real schema note if you want a starter contract.

Configured schema location:

\`\`\`text
${ctx.schemaFile}
\`\`\`

## Schema

\`\`\`yaml
meta:
  author: vault
  schemaRef: "${ctx.schemaFile}"

required_fields:
  - name: type
    type: enum
    values:
      - reference
      - procedure
      - project
      - concept
    severity: error

  - name: status
    type: enum
    values: [draft, active, complete, archived]
    severity: error

  - name: tags
    type: list
    min_items: 1
    severity: error

  - name: created
    type: date
    format: "yyyy-MM-dd"
    severity: error
    strict_parse: true

  - name: updated
    type: date
    format: "yyyy-MM-dd"
    severity: warning
    strict_parse: true

  - name: ai_private
    type: boolean
    severity: warning

  - name: review_cycle
    type: enum
    values: [1, 3, 6, 12, never]
    severity: error

optional_fields: []

inline_fields:
  - source
  - version
  - schema_version
  - errors
  - warnings

tag_rules:
  require_namespace: true
  unknown_tags: warning
  severity: warning
  allowed_namespaces:
    - meta
    - skill
    - tool
    - topic

exempt_paths: []

lint_output:
  report_json: "${ctx.exportsFolder}/lint-report.json"
  history_json: "${ctx.exportsFolder}/lint-history.json"
  include_run_envelope: true
  severities: [error, warning, info]
  pre_commit_block_on: [error]
  history_retention_days: 14
  history_max_entries: 20
  backup_retention_days: 14
  inbox_retention_days: 14

patch_engine:
  operations:
    allowed:
      - set_field
      - add_tag
      - remove_tag
      - replace_tag
      - import_note
      - compute_field
      - normalize_tags
      - move_note
      - sort_frontmatter
\`\`\``;
}

function examplePatch(ctx: DocContext): string {
  return `This is an example patch note.

Copy this structure to:

\`\`\`text
${ctx.patchFile}
\`\`\`

## Patch

\`\`\`yaml
meta:
  description: Activate Home note

operations:
  - op: set_field
    target: "Home.md"
    field: status
    value: active
\`\`\`

## Notes

Vault Forge reads only the fenced YAML block for operations. The rest of this note is for humans.`;
}
