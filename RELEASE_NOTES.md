# Forge 1.10.3

Forge 1.10.3 polishes the Vault Health dashboard, Forge settings, and lint result flows so long-running actions feel calmer, results are easier to scan, and vault-mutating actions are visually distinct.

## What changed

- Vault Health preserves scroll position during refreshes, exports, lint runs, and other dashboard actions.
- Vault Health uses clearer primary, secondary, and destructive action styling.
- Destructive dashboard action colors can be overridden by themes through `--forge-health-action-destructive-*` CSS variables.
- Shape Health is consolidated into one dashboard section, with current-note shape details kept in Current Note.
- Vault Lint and Shape Lint results now open richer modals with summary cards, severity filters, grouped findings, report links, and per-file open actions.
- Forge settings refresh dependent sub-settings immediately while preserving scroll position.
- Forge settings now show compact tab and section summaries for the active configuration.

## Compatibility

- `minAppVersion` remains `1.7.2`.
- No manual migration is required.
