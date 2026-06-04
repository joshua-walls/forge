# Forge 1.6.3

Forge 1.6.3 adds whole-vault Dataview Expansion refresh so the same workflow is available at note, folder, and vault scope.

## What changed

- New `Forge: Refresh Dataview Expansion in Whole Vault` command.
- New `Refresh Vault Expansion` action in the Forge Health side panel under `Ontology`.
- Dataview Expansion refresh is now available for the active note, current folder, and whole vault.

## Compatibility

- Existing Dataview Expansion settings remain supported.
- Dataview Expansion still supports fenced `dataview` blocks and does not include `dataviewjs`.
- No migration is required.

---

# Forge 1.6.2

Forge 1.6.2 refines Dataview Expansion auto-refresh so it behaves more like note-taking and less like a per-keystroke file watcher.

## What changed

- Dataview Expansion auto-update is now a mode setting: `Off` or `Edit idle`.
- `Edit idle` waits 5 seconds after typing stops before refreshing.
- Leaving the current note also refreshes Dataview Expansion when auto-update is enabled.

## Compatibility

- Existing Dataview Expansion settings remain supported.
- Older saved `auto-update on save` values migrate automatically to the new mode.
- No migration is required.
