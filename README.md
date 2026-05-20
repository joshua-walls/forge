# Forge

Schema-driven vault governance for Obsidian.

Forge helps you lint, validate, normalize, repair, and maintain long-lived Obsidian vaults using structured operations and repeatable workflows.

Designed for users who treat their vault like durable infrastructure.

---

![Forge Screenshot](assets/screenshot-main.png)

Forge treats vault maintenance as an explicit operational workflow.

---

## What Forge Does

Forge provides operational tooling for Obsidian vault maintenance:

- Schema validation
- Vault linting
- Frontmatter normalization
- Tag normalization
- Patch operations
- Repair workflows
- Maintenance routines
- Dataview-safe folder operations
- Vault-native documentation installation
- Structured vault exports (inventory, meta, ontology indexes)
- Dataview dashboard generation

Think of it as:

> ESLint + migrations + maintenance tooling for your Obsidian vault.

---

## Best Fit

Forge is especially useful for:

- Large or long-lived vaults
- Structured PKM systems
- PARA-style organizations
- Dataview-heavy workflows
- Research repositories
- Shared/team vaults
- Knowledge engineering workflows
- Metadata-driven note systems

---

# Installation

## Community Plugins

**Not yet available**

---

## Manual Installation

Copy the following files into:

```text
.obsidian/plugins/forge/
```

Files:

```text
manifest.json
main.js
styles.css
```

Then reload Obsidian and enable the plugin.

---

# Quick Start

After enabling the plugin, run:

```text
Forge: Install Documentation
```

Forge installs vault-native documentation and examples into your configured Forge folder.

Typical structure:

```text
System/Forge/
├── Docs/
├── Examples/
├── Patches/
```

## Recommended reading order

1. [Start Here](docs/0.START-HERE.md)
2. [Installation](docs/1.Installation.md)
3. [Vault Structure](docs/2.Vault-Structure.md)
4. [Schema](docs/3.Schema.md)
5. [Linting](docs/4.Linting.md)
6. [Patches](docs/5.Patches.md)
7. [Commands](docs/6.Commands.md)
8. [Settings](docs/7.Settings.md)
9. [Troubleshooting](docs/8.Troubleshooting.md)
10. [Export](docs/9.Export.md)

---

# Commands

| Command | Purpose |
|---|---|
| `Forge: Apply Vault Patch` | Apply structured vault operations from the configured patch note |
| `Forge: Run Vault Lint` | Validate vault structure against the configured schema |
| `Forge: Validate Schema` | Validate schema structure and configuration |
| `Forge: Normalize Tags` | Sort and deduplicate frontmatter tags |
| `Forge: Normalize Frontmatter` | Reorder frontmatter fields into canonical order |
| `Forge: Vault Maintenance` | Run maintenance routines for operational files |
| `Forge: Vault Repair` | Generate repair patches from lint results |
| `Forge: Restore Patch Run` | Restore files from a previous patch backup manifest |
| `Forge: Rename Dataview Folder` | Update Dataview folder references after folder changes |
| `Forge: Install Documentation` | Install vault-native docs and examples |
| `Forge: Export Vault Overview` | Build vault inventory, meta, and export note in one pass |
| `Forge: Export Ontology Index` | Build per-type relationship graphs from configured note headings |

---

# Core Concepts

## Schema Validation

Forge validates notes against a configurable schema.

Schemas define:

- required metadata
- allowed values
- tag rules
- lint severity
- operational expectations

Example:

```yaml
required_fields:
  - name: status
    type: enum
    values:
      - draft
      - active
      - archived
```

Schemas provide the structural foundation for linting, repair workflows, normalization, and patch operations.

---

## Vault Linting

Linting validates notes against the configured schema.

Forge can detect:

- missing frontmatter
- invalid enum values
- malformed metadata
- inconsistent tags
- schema violations
- metadata drift
- stale notes past their configured review cycle

Linting helps maintain long-term structural consistency across the vault.

---

## Normalization

Normalization standardizes metadata formatting.

Examples include:

- sorting tags
- deduplicating tags
- reordering frontmatter
- standardizing field values

This improves Dataview consistency and reduces structural drift over time.

---

## Vault Patches

Patches are explicit vault operations stored as markdown notes.

Forge uses patches for:

- metadata repair
- tag normalization
- vault migrations
- note movement
- repeatable maintenance workflows

Example:

````md
# Patch

```yaml
operations:
  - op: set_field
    target: "Home.md"
    field: status
    value: active
```
````

Patch operations remain reviewable, auditable, and restorable.

---

## Vault Exports

Forge can export structured data about your vault for use in AI sessions, dashboards, and external tooling.

Export commands produce both machine-readable JSON and human-readable Obsidian markdown notes.

`Export Vault Overview` generates three files in one pass:

- `vault-inventory.json` — flat structural index of all notes
- `vault-meta.json` — aggregate counts by domain, type, and status
- `vault-export.md` — human-readable summary with inline Dataview fields

`Export Ontology Index` builds per-type relationship graphs by walking a configured heading (e.g. `# Related`) in matched notes. One JSON and one markdown note per selected type.

A Dataview dashboard note is created on the first export run and never overwritten.

---

# Documentation

Forge installs vault-native operational documentation and examples directly into your vault.

Documentation includes:

- onboarding notes
- schema documentation
- linting workflows
- patch workflows
- export workflows
- troubleshooting guidance
- operational examples

Documentation intentionally lives inside the vault so it remains:

- searchable
- linkable
- syncable
- reviewable

---

# Safety Philosophy

Forge is designed for long-term vault maintenance.

The plugin emphasizes:

- Predictable operations
- Structured workflows
- Explicit reviewable changes
- Repairability
- Operational visibility
- Repeatability

You remain in control of vault modifications.

Recommended practices:

- Use Git for large vaults
- Backup before major patch operations
- Test schemas incrementally
- Run linting before patching

---

# Screenshots

## Vault Lint

Detect schema violations, metadata drift, invalid tags, and structural inconsistencies.

![Lint Results](assets/screenshot-lint.png)

---

## Schema Validation

Define explicit metadata contracts and validate vault structure against a canonical schema.

![Schema Validation](assets/screenshot-schema.png)

---

## Patch Operations

Apply reviewable vault operations with backups, reports, and restore manifests.

![Patch Operations](assets/screenshot-patch.png)

---

## Settings

Configure system paths, lint behavior, patch operations, maintenance retention, and export settings across tabbed sections.

![Settings](assets/screenshot-settings.png)

---

## Export

Build structured vault exports and Dataview dashboards from schema-driven configuration.

![Export](assets/screenshot-export.png)

---

# Development

```bash
npm install
npm run build
```

Release builds are generated from the plugin root and packaged as release assets.

---

# Philosophy

Knowledge systems decay over time.

Forge exists to help long-lived Obsidian vaults remain:

- Structured
- Queryable
- Repairable
- Consistent
- Maintainable

Treat your vault like durable infrastructure instead of disposable notes.

---

# License

MIT