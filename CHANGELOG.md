# 0.9.0

## Added

- **Recursive documentation and examples install support** — bundled `docs/` and `examples/` content can now be organized into subfolders and installed into the matching vault structure under the configured Forge folders
- **Complete vault-installed documentation set** — added a redesigned documentation tree covering getting started, folder layout, commands, schema reference, vault lint, patch engine, docs installer, maintenance, settings, troubleshooting, exports, ontology indexes, normalization, vault repair, Shapes, Shape lint, Shape repair, and Shape versioning roadmap guidance
- **Complete examples structure** — added organized example packs for starter schemas, lint cleanup, patch workflows, repair workflows, exports, Shapes, and maintenance routines
- **Screenshot asset set** — added a canonical documentation/wiki screenshot set under `assets/screenshots/` with stable raw GitHub embed filenames
- **Relationship index documentation** — expanded ontology/export documentation with user-facing explanations of how relationship indexes help navigation, dashboards, AI workflows, Dataview, and Bases
- **Docs installer reference** — added documentation for install targets, placeholder substitution, subfolder preservation, no-overwrite behavior, and generated frontmatter handling
- **Shape workflow documentation** — added dedicated guides for Shapes overview, template refinement, Shape lint, Shape repair, and practical Shape versioning conventions

## Changed

- Reworked README positioning from infrastructure-heavy “vault governance” language toward broader vault consistency, reliability, Dataview/Bases support, and approachable long-term maintenance
- Restructured bundled docs and examples from flat files into ordered subfolders with `1.`, `2.`, etc. filename prefixes where reading order matters
- Updated docs to avoid top-level H1 title duplication where Obsidian already displays the note title; section headings now start at `#` inside those notes
- Replaced deprecated screenshot references with the finalized asset filenames, including `frontmatter-repair-modal.png`, `installed-docs-tree.png`, `patch-dry-run-results.png`, `shape-lint-results.png`, and `ontology-index-export.png`
- Reframed ontology documentation as practical relationship indexes so the feature is understandable to non-specialist Obsidian users
- Reframed strict/lint language in user docs to avoid overstating unsupported per-rule strictness behavior
- Updated manual installation guidance to tell users to click **Reload plugins** after install or update so Obsidian registers the latest plugin files

## Removed

- Removed references to obsolete flat documentation files such as `0.START-HERE.md`, `1.Installation.md`, `2.Vault-Structure.md`, and other pre-restructure doc names
- Removed or replaced deprecated screenshot names such as `screenshot-main.png`, `screenshot-lint.png`, `screenshot-patch.png`, `screenshot-export.png`, `forge-export-settings.png`, `forge-vault-repair-modal.png`, and `forge-installed-docs-tree.png`
- Removed documentation references to screenshot assets that are no longer part of the approved repo asset set

----

# 0.7.0

## Added

- **Shape heading validation** — new toggle under **Settings → Shapes → Shape Lint**; when enabled, lint runs validate note heading structure against the corresponding shape template
- `shape_heading_missing` — heading required by the template is absent from the note; non-strict: `warning`, strict: `error`
- `shape_heading_order` — template headings are present but in the wrong relative order; always `error`
- `shape_heading_extra` — heading in the note not found in the template; H1: always `error`, H2+: non-strict: `info`, strict: `warning`
- `shape_section_empty` — a required section exists but has no content; non-strict: `warning`, strict: `error`
- `src/commands/shape-lint.ts` — new module; heading extraction, template cache, and all shape lint rule implementations

## Changed

- `lint-engine.ts` — builds a shape heading cache once per lint run before the file loop; passes it into per-file lint; shape rules are only evaluated when `shapeLintEnabled` is true and a matching template exists
- Shape lint severity follows the existing **Settings → Lint → Strict mode** toggle; no separate strictness setting

----

# 0.6.1

## Added

- **Created field** — configurable date field stamped when a template is first created; dropdown populated from `type: date` fields in schema; set to none to skip; defaults to `created`
- **Updated field** — configurable date field stamped on every template write; same dropdown; defaults to `updated`

## Changed

- Created and updated fields are now excluded from the template field configurator automatically alongside the type target field; the runtime note at the bottom of the configurator reflects whichever fields are currently configured
- Type target field dropdown now triggers a full tab re-render on change so the configurator grid immediately reflects the exclusion

## Fixed

- Type target field was not excluded from the template field configurator when changed; the grid now updates immediately on selection change

----

# 0.6.0

## Added

- **Vault Shape Engine** — new **Settings → Shapes** tab; enable shape note processing and template refinement
- **Shape notes** — markdown notes in the configured shapes folder with `type: shape` and a `# Structure` section; the structure body becomes the generated template body
- **Template refinement** — new command **Refine Shape Templates**; reads each shape note, builds template frontmatter from configured field values, and writes or updates the corresponding template note in the templates folder
- **Templates folder** — configurable per-vault under Settings → Shapes; defaults to `System/Templates`
- **Type target field** — configurable schema field that receives the shape name at generation time (e.g. `type`, `kind`, or any schema field)
- **Template field configurator** — per-field include toggle and explicit value picker for every schema field; enum fields get a dropdown of valid values, boolean fields get a true/false picker, list fields get a CSV input, all others get a text input; fields are ordered by the frontmatter field order setting
- `created` is preserved on existing templates; `updated` is always stamped at runtime; neither is configurable
- **Refine Shape Templates** registered as a vault command; also runnable via the Run button in Settings → Shapes

## Changed

- `vault-paths.ts` `templates` path now driven by `shapeTemplatesFolder` setting instead of being hardcoded to `System/Templates`; all existing callers pick this up automatically

## Fixed

- Template body extraction now correctly captures the full `# Structure` section including all subsections and trailing content; previous regex used `\z` (a Perl anchor invalid in JavaScript) causing silent truncation

----

# 0.5.6

## Added

- **Frontmatter field order** — new setting under **Settings → General**; drag to reorder fields, × to remove, type to add custom fields; controls the canonical sort order applied whenever Forge writes a note
- **Prefill from schema** button — replaces the field order list with `required_fields` + `optional_fields` from `schema.md` in declaration order; one click to align your sort order with your schema structure
- `frontmatterFieldOrder` persisted in `data.json`; default matches the previous hardcoded order so existing installs see no behaviour change on upgrade

## Changed

- `sortFrontmatterFields()` and `writeNote()` now accept an optional `fieldOrder` parameter; falls back to the built-in constant when omitted, so external callers remain unaffected
- All patch engine operations (`set_field`, `remove_field`, `add_tag`, `remove_tag`, `replace_tag`, `normalize_tags`, `compute_field`, `sort_frontmatter`, `move_note`) now use the settings-driven field order
- Normalize commands (`Normalize Tags`, `Normalize Frontmatter`) now use the settings-driven field order

----

# 0.5.5

## Added

- **Lint inline metadata toggle** — new setting under **Settings → Lint**; when disabled, all inline metadata rules are skipped (`inline_is_schema_field`, `inline_fuzzy_schema`, `inline_fuzzy_inline`, `inline_undocumented`); default on; existing behaviour unchanged
- `4.Linting.md` updated with inline metadata rule descriptions and toggle guidance

----

# 0.5.4

## Added

- `when` condition on `set_field` patch operation — skip the operation unless a specified field equals a specified value; enables conditional field updates without separate patch passes

```yaml
- op: set_field
  target_pattern: "**/*.md"
  field: review_cycle
  value: monthly
  when:
    field: review_cycle
    equals: "1"
```

---

# 0.5.3

## Added

- **Stale note review** — fully wired into the lint engine; flags notes whose review cycle has elapsed as `warning` with rule `stale_note`
- Review cycle field now uses named enum values: `daily`, `weekly`, `monthly`, `quarterly`, `yearly`, `never` — no more ambiguous numbers; `never` is always skipped
- Day mapping: `daily` = 1, `weekly` = 7, `monthly` = 30, `quarterly` = 90, `yearly` = 365
- Notes missing the cycle field, last updated field, or with unknown cycle values are skipped silently

## Changed

- `examples/schema.md` updated — `review_cycle` enum values changed from `[1, 3, 6, 12, never]` to `[daily, weekly, monthly, quarterly, yearly, never]`
- Settings description for review cycle field updated to communicate required enum values
- `4.Linting.md` updated with cycle value semantics and day mappings

---

# 0.5.2

## Changed

- Updated vault-native documentation to reflect 0.5.0 export architecture — commands, settings, and export docs revised; examples unchanged

---

# 0.5.0

## Added

- **Type field** and **Status field** settings — choose which schema field represents note type and lifecycle status in exports; defaults to `type` and `status` if left blank; field names used as JSON keys in `vault-meta.json` and as column headings in markdown notes
- **Dashboard note** — created once on first overview export run, never overwritten; contains Dataview blocks for vault overview, ontology index summary (`node_type` as first column), and optional private note breakdown; filename is configurable (default: `vault-dashboard`)
- **Dashboard name setting** — text field to set the dashboard note filename; blank defaults to `vault-dashboard`
- `total_private_notes::` inline field added to all ontology index notes; always present (0 when private notes is disabled)
- `total_notes::` and `total_private_notes::` always present in `vault-export.md`

## Changed

- `vault-overview.md` renamed to `vault-export.md`
- `node_count::` renamed to `total_notes::` in ontology index notes for consistency
- `vault-meta.json` keys now reflect configured field names (`note_counts_by_{fieldName}`) rather than hardcoded `type`/`status`/`domain`
- Ontology index node table column headings use configured domain and status field names
- Machine-readable data reference moved to top of `vault-export.md` for quicker access
- All section headings in `vault-export.md` and dashboard at `#` level — no H1s in either note
- Overview options settings descriptions rewritten to be more user-friendly

---

# 0.4.11

## Added

- **Domain field setting** — choose which frontmatter field represents a note's domain in overview and meta exports; falls back to parent folder if left blank
- **Private notes setting** — optional toggle + field selector to identify private notes; any truthy value in the chosen field marks the note as private; when enabled, `vault-meta.json` excludes private notes from its counts and `vault-export.md` adds a separate private notes section (by domain, type, status)
- `total_notes::` and `total_private_notes::` inline fields in `vault-export.md`; `total_private_notes::` is always 0 when private notes is disabled
- **Exclude folders** — multi-select persisted list of folders to skip during ontology export; applies at any depth

## Changed

- Private note sections in `vault-export.md` only appear when private notes is enabled and count > 0
- No H1 headings in export notes; all section headings at `#` level
- Overview now includes notes by status in the all-notes block (previously only domain and type)

---

# 0.4.10

## Changed

- `Export Vault Inventory` and `Export Vault Meta` merged into a single `Export Vault Overview` command — produces `vault-inventory.json`, `vault-meta.json`, and `vault-export.md` in one pass
- All timestamps changed from UTC ISO format to local machine time with no timezone suffix — Obsidian renders timestamps as local time so UTC offsets were displaying incorrectly
- `localTimestamp()` helper added to `utils/files.ts`; used across all commands that write user-visible timestamps
- `safeTimestamp()` and `todayString()` updated to use local time

## Removed

- `export-inventory.ts` and `export-meta.ts` consolidated into `export-overview.ts`
- Separate `vault-inventory.md` and `vault-meta.md` notes replaced by single `vault-export.md`

---

# 0.4.9

## Fixed

- Multi-select component CSS now scoped inside the settings container — previously injected into `document.head` where Obsidian's modal didn't pick it up, causing unstyled rendering
- Stale note review in-scope filter now uses the same field→values pattern as the export filter — user picks any schema field, then selects enum values from it; removes hardcoded dependency on a `status` field

## Added

- `staleReviewFilterField` setting — which schema field determines in-scope notes for stale review (defaults to `status` for existing users)

---

# 0.4.8

## Changed

- Multi-select controls (stale review statuses, export filter values) replaced with dropdown + chip component — scales cleanly to any number of values, avoids Obsidian CSS override issues with checkbox inputs

---

# 0.4.7

## Added

- **Export module** — three new commands and a dedicated Export tab in settings
  - `Export Vault Inventory` — builds a flat structural index of all non-exempt vault notes; schema is optional
  - `Export Vault Meta` — exports aggregate counts by domain, status, and type; honors `ai_private: true`
  - `Export Ontology Index` — builds per-type relationship graphs from a user-configured heading; auto-runs inventory if none exists on disk
- All exports produce both a machine-readable JSON file and a human-readable Obsidian markdown note with frontmatter and summary tables
- **Settings tabs** — settings pane is now tabbed: General | Lint | Patch | Maintenance | Export | Shapes
- **Export tab** — enabled toggle, exports folder picker, reload from schema, dynamic field + value filter (schema-driven, no hardcoded types), relationship heading input, and run buttons for all three exports
- **Stale Note Review** — new feature under the Lint tab (enabled toggle); configures which frontmatter field holds the review cycle, which holds the last-updated date, and which statuses are in scope for stale flagging
- **Lint Reports folder** — lint run notes now write to a dedicated configurable folder (default `System/Exports/LintReports`) separate from the main exports folder
- **Patch backup folder** — backup destination is now configurable in the Patch tab; `vault-paths.ts` and `apply-patch.ts` both honour the setting
- **Shapes tab** — placeholder tab with enabled toggle; reserved for Vault Shape Engine

## Changed

- Schema note picker moved from General to Lint tab (lint is its primary consumer)
- Exports folder moved from General/System Paths to Export tab
- Shapes folder moved from General/System Paths to Shapes tab
- All folder pickers now show folder-tree only — no files listed
- `patchBackups` path in `vault-paths.ts` now resolves from `patchBackupFolder` setting with fallback to `patchesFolder/Backups`

## Removed

- Inbox retention slider removed from settings UI (inbox retention logic preserved in maintenance for compatibility; stale note reporting planned for a future release)

---

# 0.4.6

## Added

- `move_note` frontmatter merge support
- `move_note` frontmatter stripping support

## Improved

- Patch operation documentation
- `move_note` workflow flexibility
- Inbox-to-workflow note staging support
- Centralized exempt path handling through `buildExemptList()`

## Changed

- Removed `import_note` patch operation
- `move_note` now operates on any vault path, including `System/`
- `move_note` now supports optional frontmatter mutation during move operations
- Commands now use shared exempt path resolution instead of manually merging schema and internal exclusions

## Removed

- `import_note` patch operation documentation

---

# 0.4.5

## Added

- Vault-native operational documentation
- Schema validation workflows
- Patch reports and restore manifests
- Lint run reporting
- Import note patch operation
- Normalize frontmatter command

## Improved

- Community plugin readiness
- README and onboarding documentation
- Patch operation documentation
- Lint output formatting
- Settings organization
- Screenshot coverage

## Changed

- Renamed `LintRuns` to `LintReports`
- Removed generated `config.md`
- Improved patch workflow visibility
