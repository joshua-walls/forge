# Forge 1.10.1

Forge 1.10.1 separates review backlog from lint failures. Stale review-cycle notes and stale inbox notes are still detected by Vault Lint, but they now appear as Needs Review items instead of lint warnings.

## What changed

- Vault Lint now classifies `stale_note` and `stale_inbox_note` findings as review items, not lint warnings.
- Vault Health now shows review backlog count in the header pill and renders a dedicated Needs Review section.
- Current Note now shows a Needs Review flag and details inside the existing current-note panel.
- Settings and bundled docs now describe stale inbox handling as Needs Review.
- The legacy inbox retention action value `warning` is migrated to canonical `review` on settings load.

## Compatibility

- `minAppVersion` remains `1.7.2`.
- Existing inbox retention settings are preserved.
- Legacy `warning` settings are treated as `review` and saved forward automatically.
- No manual migration is required.
