# 1.7.0

## Added

- Added a Lockblock section to the Forge health dashboard when Lockblock is installed and enabled.
- Added basic Lockblock actions for unlocking the vault, locking the vault, and changing the unlock password.
- The Lockblock dashboard section now appears or disappears automatically when Lockblock is enabled or disabled.
- Dataview Expansion dashboard controls now appear or disappear automatically when Dataview is enabled or disabled.

## Changed

- Forge now calls Lockblock's exact command IDs for those actions so unlock, lock, and password changes remain distinct.

## Compatibility

- `minAppVersion` remains `1.7.2`.
- No migration is required.

---

# 1.6.10

## Changed

- Current Note now shows `Exempt` in a muted status pill when note-level lint skips the file because it matches Forge exempt paths.
- Exempt current notes no longer appear as `Clear` or show the no-issues message in the dashboard.

## Compatibility

- `minAppVersion` remains `1.7.2`.
- No migration is required.

---

# 1.6.9

## Changed

- Differentiate auto-lint popups between lint, shape lint, and combined failures.
- Keep Current Note context while interacting with the Forge dashboard.
- Make dashboard sections collapsible.
- Remove the redundant Current Note summary metric.
- Add a seconds-based Dataview Expansion auto-update delay setting.
- Improve current-note relint behavior for read-view frontmatter or Properties edits and source-to-read-view transitions.

## Compatibility

- `minAppVersion` remains `1.7.2`.
- No migration is required.

---

# 1.6.8

## Added

- Active-file auto-lint mode for note-level linting during editing.
- Settings toggle for turning active-file auto-lint on or off.
- Active-file lint triggers for note open, edit idle, leaving the note, switching the same note into reading view, and fast relint after current-note frontmatter or properties edits from reading view.

## Changed

- Active-file auto-lint waits 10 seconds after typing stops by default.
- Dataview Expansion auto-update delay is now configurable in seconds instead of being fixed at 5 seconds.
- Auto-lint now shows a small failure notice with the note name and error or warning counts when the current note fails lint.
- Single-file linting now reuses the existing lint engine without replacing full-vault lint for dashboard and report workflows.
- Fixed the remaining Obsidian Community Plugins sentence-case lint issue in the new active-file lint settings copy.

---

# 1.6.6 & 1.6.7

## Changed

- Fixed the remaining local Community Plugins review-linter findings across commands, settings, dashboard views, and utility code.
- Standardized command names, modal titles, button labels, and notices to sentence case for Community Plugins UI consistency.
- Tightened async callback handling and improved TypeScript safety around JSON parsing, unknown values, and string conversion.

## Compatibility

- No migration is required.

---

# 1.6.5

## Changed

- Raised `minAppVersion` to `1.7.2` to match the side-panel workspace APIs Forge now uses.
- Reworked the flagged settings headings to use Obsidian `Setting(...).setHeading()` for Community Plugins UI consistency.
- Replaced the inline tag-repair visibility style toggle with a CSS class-based approach.

## Compatibility

- Forge now requires Obsidian `1.7.2` or newer.
- No data migration is required.

---

# 1.6.4

## Changed

- Dataview Expansion auto-update mode is now runtime-only and is no longer written to synced plugin settings.
- Dataview Expansion auto-refresh now only follows the note you are actively editing or just left, which reduces sync-loop risk from remote vault writes.

## Compatibility

- Existing Dataview Expansion settings remain supported.
- Older synced auto-update mode values are ignored automatically.
- No user migration is required.

---

# 1.6.3

## Added

- New `Forge: Refresh Dataview Expansion in Whole Vault` command for rebuilding Dataview Expansion blocks across the entire vault.
- New `Refresh Vault Expansion` action in the Forge Health side panel under `Ontology`.

## Compatibility

- Existing Dataview Expansion settings and workflows remain supported.
- Dataview Expansion still targets fenced `dataview` blocks only; `dataviewjs` is not included.
- No user migration is required.

---

# 1.6.2

## Changed

- Dataview Expansion auto-update now uses `Off` or `Edit idle` mode instead of the earlier save-based toggle.
- `Edit idle` waits 5 seconds after typing stops and also refreshes when you leave the note, avoiding refresh-on-every-write behavior in live editing.

## Compatibility

- Existing Dataview Expansion settings remain supported.
- Older saved `auto-update on save` values migrate automatically to the new auto-update mode.
- No user migration is required.

---

# 1.6.1

## Fixed

- Repaired stale internal wiki-links in the bundled docs, including outdated export and Shapes note references.
- Fixed docs-to-examples handoffs so key onboarding pages link directly to the installed starter schema and practical example notes.

## Changed

- Added related-note navigation across bundled examples so schema, patch, export, workflow, and shape examples connect back to the relevant Forge docs and neighboring examples.

## Compatibility

- No command, settings, or data-format changes are included in this release.
- Existing installed docs remain supported; users can reinstall missing notes if they want the updated bundled copies.
- No user migration is required.

---

# 1.6.0

## Added

- Dataview Expansion can collect link results from all `dataview` blocks in a note and write one collapsed compatibility block at the bottom.
- New General settings for enabling Dataview Expansion, auto-updating on save, setting the block title, and capping the number of written links.
- New `Forge: Refresh Dataview Expansion` command for manually rebuilding the active note.
- New `Forge: Refresh Dataview Expansion in Current Folder` command for recursive folder refreshes.
- New Dataview Expansion actions in the Forge Health side panel under `Ontology`.

## Changed

- Forge can now refresh Dataview Expansion blocks automatically after note saves without rewriting the original query blocks.
- Dataview Expansion now follows Obsidian's current link preferences for path style and markdown-vs-wikilink output.
- Forge Health now updates live when feature toggles change, and feature-driven sections/actions hide when their corresponding settings are disabled.
- `Ontology Metrics` in the dashboard has been renamed to `Ontology`.

## Compatibility

- Existing notes and settings remain supported.
- Dataview Expansion is opt-in and stays off until enabled.
- Dataview Expansion currently supports fenced `dataview` blocks. `dataviewjs` is not included in this release.
- No user migration is required.

---

# 1.5.6

## Changed

- Dashboard auto-refresh is now runtime-only and is never written to synced plugin settings.
- Auto-refresh always starts off on plugin load, even if an older `data.json` contained a saved value.

## Compatibility

- Existing synced settings files remain supported.
- Legacy saved auto-refresh keys are ignored and are removed on the next settings save.
- No user migration is required.

---

# 1.5.5

## Added

- Sync-aware settings reload banner in the Forge Health side panel.
- Live settings reload path for externally changed plugin settings.

## Changed

- Forge now watches synced `data.json` changes and offers an in-panel reload instead of requiring a Community Plugins refresh.
- Reloading synced settings updates the live in-memory settings and refreshes dependent dashboard services without opening Settings.

## Compatibility

- Existing settings files remain supported.
- The reload prompt appears only when synced settings differ from the current in-memory state.
- No user migration is required.

---

# 1.5.4

## Added

- Maintenance setting for inbox retention action.

## Changed

- Inbox retention can now either delete stale inbox notes during maintenance or report them as Vault Lint warnings.

## Compatibility

- Existing inbox retention day settings are preserved.
- The default inbox retention action is delete during maintenance, so existing behavior is unchanged until the setting is updated.
- No user migration is required.

---

# 1.5.3

## Changed

- Shape Lint now treats non-empty descendant sections as satisfying a parent section, so flexible container headings do not trigger empty-section findings.

## Compatibility

- Existing shapes and templates are preserved.
- No user migration is required.

---

# 1.5.2

## Added

- Optional inbox-folder exclusion for Vault Lint.
- Optional inbox-folder exclusion for Shape Lint.
- Maintenance setting to auto-run silently during dashboard refresh.

## Changed

- Vault Health Dashboard refresh now writes fresh lint and shape lint artifacts.
- Vault Health Dashboard refresh now silently rebuilds vault overview and ontology exports when export is enabled before refreshing ontology metrics.

## Compatibility

- Inbox exclusion defaults to off for both lint workflows.
- Existing dashboard commands and export settings are preserved.
- No user migration is required.

---

# 1.5.1

## Added

- Maintenance cleanup for Shape Lint run notes.
- Maintenance cleanup for Shape Repair history and run notes.
- Maintenance setting for Shape Lint run retention.

## Changed

- Shape Repair maintenance now enforces retention even when no new repair run has been appended.

## Compatibility

- Shape Lint still keeps the latest `shape-lint-report.json`; maintenance trims accumulated run notes.
- Existing Shape Repair retention settings are reused for both repair history and repair run notes.

---

# 1.5.0

## Added

- Vault Health dashboard auto-refresh control.
- Auto-refresh interval options for 1, 3, 5, 15, and 30 minutes.
- Persistent dashboard auto-refresh settings.

## Changed

- Scheduled dashboard refreshes use the existing background refresh service silently, without success or failure notices.
- Manual dashboard refresh behavior remains unchanged.

## Compatibility

- Auto-refresh is disabled by default.
- Existing dashboard cache and command workflows are preserved.
- No user migration is required.

---

# 1.4.0

## Added

- Forge Health dashboard now preloads into the right sidebar as a side-panel tab.
- Dashboard Settings button for direct access to Forge settings.
- Dashboard actions for maintenance, normalization, repair, ontology refresh, snapshot export, template refinement, patch history, and last-run review.
- Operational history tracking for maintenance, normalization, template refinement, and shape repair.
- Shared preview type contract for future preview/apply workflows.
- Dry-run support in template refinement for future preview workflows.

## Changed

- Dashboard action layout now uses a responsive grid for better desktop, side-pane, and mobile behavior.
- Patch history can now surface recent repair and normalization activity when available.
- Dashboard cache schema was bumped with graceful fallback for existing cache files.

## Compatibility

- Existing command palette workflows and command IDs remain supported.
- Existing patch, restore, lint, schema, export, repair, and normalization behavior is preserved.
- The preview/apply foundation is present, but the full selected-apply modal workflow is not exposed in this release.

---

# 1.3.3

## Fixed

- Vault Health Dashboard relationship type counts now come from `schema.md` `ontology.relationships` instead of exported ontology records.

---

# 1.3.2

## Changed

- Refined Vault Health Dashboard responsive layout for narrow and wide Obsidian panes.
- Restored compact metric card wrapping on mobile and small dashboard widths.

---

# 1.3.1

## Changed

- Refined Vault Health Dashboard responsive layout for freely resized Obsidian panes.
- Dashboard cards, section badges, issue groups, and maintenance history rows now wrap more safely at narrow widths.

---

# 1.3.0

## Added

- Dedicated Shape Lint service and `Forge: Run Shape Lint` command.
- Separate Shape Lint exports at `System/Exports/shape-lint-report.json` and `System/Exports/ShapeLintReports/`.
- Vault Health Dashboard Shape Health section with structural issue counts and issue rows.
- Dashboard cache support for `latest_shape_lint_result`.

## Changed

- Vault Lint and Shape Lint are now separate workflows. Active Issues reports general Vault Lint findings, while Shape Health reports shape/template heading issues.
- Dashboard refresh runs Shape Lint only when Shape lint is enabled.

---

# 1.2.0

## Added

- Operation-level Patch Restore for new patch manifests. Forge now records changed patch operations with target, before value, after value, and reverse action data.
- Selective restore workflow for patch runs with operation manifests, including per-operation status, conflict detection, and checkbox selection.
- Patch restore reports for operation-level restores.

## Changed

- Patch manifests now write `manifest_version: 2` and preserve legacy `changes` backup entries while adding an `operations` array.
- New patch applies no longer create full-file `.bak` backups for operation-manifest restore.
- Restore Patch Run keeps legacy full-file restore fallback for old manifests, but labels it clearly as full-file backup restore.
- Patch history can surface changed operation counts from v2 manifests.

## Safety

- Operation-level restore only reverses an operation when the current value still matches the value written by the original patch.
- Conflicted operations are skipped by default to preserve unrelated edits made after patch apply.

---

# 1.1.0

## Added

- Vault Health Dashboard custom Obsidian view with manual refresh, cached results, summary metrics, schema health, active lint issue listing, ontology metrics, maintenance history, and section-level health indicators.
- Dashboard service/cache layer backed by `System/Forge/health-dashboard.json`.
- Reusable lint, schema, ontology, patch-history, and dashboard composition services for dashboard consumption and future workflow orchestration.
- Commands: Open Vault Health Dashboard and Refresh Vault Health Dashboard.
- In-dashboard actions for Run Vault Lint, Validate Schema, and Open schema.md.

## Changed

- Vault Lint, Validate Schema, Export Ontology Index, and Apply Vault Patch now update dashboard-visible service cache state as part of their normal command flow.
- Open dashboard views now refresh from the latest cached state after supported Forge commands complete.

---

# 1.0.0

## Breaking Changes

Schema structure has changed completely in this release. Existing `schema.md` files using the previous contract will not be read by Forge. Migration is required before upgrading.

See the Schema Reference documentation for the complete 1.0.0 contract structure.

### Schema contract restructured

The following top-level keys have been removed:

- `required_fields`
- `optional_fields`
- `inline_fields`
- `meta`

The following top-level keys are now required:

- `frontmatter` — with `required` and `optional` sublists
- `inline` — with an `allowed` list
- `ontology` — with a `relationships` map
- `tag_rules`
- `exempt_paths`

### `inline_fields` replaced by `inline.allowed`

The flat `inline_fields` list is replaced by `inline.allowed`. Each entry is now an object with at minimum `name`. Entries may also carry `required_when` and `severity` for conditional validation.

### `required_fields` / `optional_fields` replaced by `frontmatter`

Field contracts now live under `frontmatter.required` and `frontmatter.optional`. The structure of each field entry is unchanged.

### `meta` block removed

The `meta` block is no longer read by Forge. Version is now read from an inline field or frontmatter field configured in Settings → Lint. The block may remain in your schema note — Forge does not validate or reject extra keys.

---

## Added

### Schema

- `inline.allowed` entries support `required_when` — conditional inline field requirements scoped to specific note types via `field` and `values` keys
- `tag_rules.forbidden_namespaces` — explicitly reserved strings that must not be used as tag namespaces; violations are always `error` severity regardless of strict mode
- `review_cycle` field supports `values_meta` — each enum value can carry a `days` count that Forge uses for stale review calculations; replaces the internal hardcoded day map
- `biweekly` (14 days) and `semiannual` (182 days) added to the recommended `review_cycle` enum values
- `ontology.relationships` is the canonical source for all relationship definitions — `description`, `direction`, `allowed_between` / `sources` / `targets`, and `template_heading` per relationship

### Settings — Lint tab

- **Version field location** — choose whether the schema version lives in inline metadata or frontmatter
- **Version field** — schema-driven dropdown populated from the chosen location; defaults to `version` inline
- **Repair prompt threshold** — choose when the Open Vault Repair button appears after lint: errors only (default) or errors and warnings

### Settings — Shapes tab

- **Inject relationship headings from schema** — when enabled, template refinement injects relationship headings into generated templates based on `ontology.relationships`
- **Relationship parent heading** — configurable parent heading name; defaults to `Related`
- **Relationship heading level** — H1, H2, or H3 for the parent heading; subheadings are always one level below; defaults to H1
- **Relationship injection position** — Append (add section at end) or Inject (add missing headings under existing parent, falls back to append)

### Lint engine

- `forbidden_namespace` — new lint rule; fires when a tag uses a namespace in `tag_rules.forbidden_namespaces`; always `error` severity
- `required_when` — inline field conditional requirement rule; fires when a frontmatter field matches a configured value and the inline field is absent
- Stale review day counts now read from `review_cycle.values_meta` in schema instead of a hardcoded internal map; adding or removing cycle values in schema automatically updates stale review behavior

### Vault Repair

- **Write & Open Patch** button — writes the repair patch and immediately opens it in the editor
- Repair now includes warning-severity results when threshold is set to errors and warnings; repairable warning rules: `required_field`, `type_mismatch`, `enum_value`, `date_format`, `required_when`, `no_frontmatter`, `tag_namespace`, `unknown_tag_namespace`, `forbidden_namespace`, `stale_date`

### Template Refinement

- Relationship headings injected from schema include the relationship `description` as body text under each subheading

### Upgrade notice

- Users upgrading from a previous installation see a one-time migration notice on first load summarising the schema contract changes; fresh installs are unaffected

---

## Changed

- Validate Schema now performs recursive structural validation — each section and subsection is checked against the expected contract shape; ontology relationship entries are only validated when `shapeLintEnabled` or `exportEnabled` is on
- Validate Schema is now settings-aware — passes active settings to structural validation so feature-gated sections are only checked when the relevant feature is enabled
- Schema cache helpers updated to use new schema structure: `getFrontmatterFieldNames`, `getEnumFieldNames`, `getEnumValues`, `getFieldType`, `getInlineFieldNames`, `getFieldNamesByLocation`
- `inline_undocumented` lint message updated to reference `inline.allowed` instead of `inline_fields`
- All field pointer settings in the settings tab render as schema-driven dropdowns rather than free-text inputs
- Export commands read `schema.version` directly rather than `schema.meta.version`

---

## Removed

- Hardcoded `CYCLE_DAYS` constant in lint engine — replaced by `review_cycle.values_meta` traversal
- `lint_output` and `patch_engine` keys removed from `VaultSchema` TypeScript interface — these were unused and not present in schema
- `SchemaMeta` interface removed
- Legacy schema key detection removed — Forge does not attempt to read or migrate the previous schema structure

---

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

- Reworked README positioning from infrastructure-heavy "vault governance" language toward broader vault consistency, reliability, Dataview/Bases support, and approachable long-term maintenance
- Restructured bundled docs and examples from flat files into ordered subfolders with `1.`, `2.`, etc. filename prefixes where reading order matters
- Updated docs to avoid top-level H1 title duplication where Obsidian already displays the note title; section headings now start at `#` inside those notes
- Replaced deprecated screenshot references with the finalized asset filenames
- Reframed ontology documentation as practical relationship indexes so the feature is understandable to non-specialist Obsidian users
- Updated manual installation guidance to tell users to click **Reload plugins** after install or update

## Removed

- Removed references to obsolete flat documentation files
- Removed or replaced deprecated screenshot names
