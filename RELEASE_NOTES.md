# Forge 1.8.1

Forge 1.8.1 finishes the dashboard theme cleanup and removes a deprecated settings slider API call flagged by Obsidian review.

## What changed

- Removed deprecated `setDynamicTooltip()` calls from settings sliders.
- Added more consistent spacing below the Shape Health no-issues message on mobile.
- Remaining health issue severity styling now uses semantic `data-severity` attributes instead of Forge-specific severity classes.
- Severity colors still render through Obsidian semantic variables, not fixed Forge colors.

## Compatibility

- No migration is required.
- `minAppVersion` remains `1.7.2`.
