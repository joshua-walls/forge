# Forge 1.5.0

Forge 1.5.0 adds dashboard auto-refresh so Vault Health can stay current while the dashboard is open.

## What changed

- Added an Auto-refresh control at the top of the Vault Health dashboard.
- Auto-refresh can be enabled or disabled directly from the dashboard.
- Users can choose a refresh interval of 1, 3, 5, 15, or 30 minutes.
- Auto-refresh uses the existing background dashboard refresh path and updates the dashboard cache silently.
- Manual refresh remains available and keeps its existing user-visible error notices.
- Auto-refresh settings persist across dashboard reopen and plugin reload.

## Compatibility

- Auto-refresh is disabled by default.
- Existing dashboard refresh, cache, command palette, lint, schema, ontology, shape lint, and patch history behavior is preserved.
- No user migration is required.
