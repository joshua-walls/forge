# Forge 1.5.2

Forge 1.5.2 expands dashboard refresh workflows and adds optional inbox exclusions for lint passes.

## What changed

- Vault Lint can now exclude the configured inbox folder from scans.
- Shape Lint can now exclude the configured inbox folder from scans.
- Dashboard refresh now updates lint and shape lint report artifacts, not just dashboard cache state.
- When export is enabled, dashboard refresh now silently rebuilds the vault overview and ontology index before refreshing ontology metrics.
- Added a Maintenance setting to auto-run Vault Maintenance silently on dashboard refresh.

## Compatibility

- Inbox exclusion is off by default for both Vault Lint and Shape Lint.
- Existing dashboard refresh commands and settings remain supported.
- No user migration is required.