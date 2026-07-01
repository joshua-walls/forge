# Forge 1.9.0

Forge 1.9.0 adds a patch picker command so you can apply any patch note from the configured patches folder without changing the default patch file setting.

## What changed

- Added `Apply patch from patches folder`.
- Patch picker lists Markdown patch notes under the configured patches folder.
- Generated patch operation folders are excluded from the picker: `Applied`, `Backups`, and `Reports`.
- Selected patch notes reuse the existing dry-run, confirmation, apply, report, archive, manifest, and auto-lint flow.
- Picker-launched patch runs now surface async errors with a Forge notice instead of failing silently.

## Compatibility

- No migration is required.
- `minAppVersion` remains `1.7.2`.
