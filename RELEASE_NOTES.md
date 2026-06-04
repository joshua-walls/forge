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