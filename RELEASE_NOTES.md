# Forge 2.0.5

Forge 2.0.5 adopts Obsidian's declarative settings API while preserving compatibility with older Obsidian versions.

## Fixed

- Added declarative settings definitions so Forge settings can appear in Obsidian 1.13+ settings search while keeping the legacy settings renderer for older Obsidian versions.

## Compatibility

- `minAppVersion` remains `1.7.2`.
- No manual migration is required.
- Users on Obsidian versions before `1.13.0` continue to use the existing settings tab renderer.
