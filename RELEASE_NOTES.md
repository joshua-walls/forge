# Forge 1.10.5

Forge 1.10.5 tightens schema-backed lint behavior and makes schema setting changes take effect immediately in the side panel and Lint settings tab.

## What changed

- Enum validation now accepts YAML list values when every item is in the field's allowed enum values.
- `exempt_paths` now supports glob patterns such as `**/_*.md` and `**/*.excalidraw.md` for recurring filename exclusions across folders.
- Changing the schema note or version settings now reloads schema-backed settings immediately and updates the dashboard schema path without switching tabs or running validation first.
- The Lint tab now shows the full schema note path directly so same-named schema files do not look unchanged after save.
- Added a Reload schema action on the Lint settings tab.

## Compatibility

- `minAppVersion` remains `1.7.2`.
- No manual migration is required.
