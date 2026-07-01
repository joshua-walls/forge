# Forge 1.8.4

Forge 1.8.4 refines the Vault Health dashboard heading structure and keeps its status-aware title styling aligned with the rest of Forge.

## What changed

- The Vault Health dashboard title is now an `h1`.
- Dashboard section titles are now `h2`.
- Vault Health naming now uses Title Case across the dashboard title, commands, notices, and settings copy.
- The dashboard header now explicitly carries the health `data-status` attribute so title coloring follows the same status context as the health pill and sections.
- Forge linting now allows the project's Title Case UI convention while keeping the other Obsidian lint checks.

## Compatibility

- No migration is required.
- `minAppVersion` remains `1.7.2`.
