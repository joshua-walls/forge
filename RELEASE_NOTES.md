# Forge 1.8.0

Forge 1.8.0 makes the Forge health dashboard theme-adaptable without requiring theme-specific Forge CSS overrides.

## What changed

- Dashboard status colors now use semantic `data-status` attributes and standard Obsidian theme variables.
- Good, warning, critical, and muted states now render through `--text-success`, `--text-warning`, `--text-error`, and `--text-muted`.
- The dashboard no longer depends on fixed Forge color tokens such as `--color-yellow`.
- Dashboard cards, metrics, issue groups, chips, tables, toggles, and buttons now use generic Obsidian background, border, hover, and interactive variables.
- Mobile dashboard spacing, table readability, and button wrapping have been tightened for narrow panes and floating navigation.

## Compatibility

- No migration is required.
- `minAppVersion` remains `1.7.2`.
