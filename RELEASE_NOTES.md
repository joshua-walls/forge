# Forge 1.6.1

Forge 1.6.1 is a documentation connectivity patch that fixes stale internal links and makes the bundled docs/examples easier to navigate once installed into the vault.

## What changed

- Repaired outdated wiki-links in the export and Shapes documentation.
- Updated onboarding notes to link directly to the installed starter schema and high-value example notes instead of only showing plain paths.
- Added related-note navigation across bundled examples so practical notes lead back into the relevant reference docs and adjacent examples.

## Compatibility

- Existing settings, commands, and data formats remain unchanged.
- No migration is required.
- Users who want the refreshed bundled notes can reinstall any missing docs/examples without affecting the rest of the plugin.

---

# Forge 1.6.0

Forge 1.6.0 adds Dataview Expansion, which can collect note links from all fenced `dataview` blocks in a page and write one collapsed compatibility block at the bottom of the note.

## What changed

- New Dataview Expansion setting group on the General tab.
- Optional auto-update on save for Markdown notes.
- Configurable block title and link cap.
- New refresh actions for the active note and current folder.
- Dataview Expansion now follows Obsidian's current internal-link format preferences when rebuilding links.
- Dataview Expansion controls appear in the Forge Health side panel under `Ontology`.
- The dashboard now responds live to feature enable/disable changes instead of requiring a plugin reload.

## Compatibility

- Existing settings files remain supported.
- Dataview Expansion is opt-in and disabled by default.
- This release supports fenced `dataview` blocks. `dataviewjs` is not included.
- No user migration is required.
