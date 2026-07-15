# Forge 2.0.4

Forge 2.0.4 addresses the remaining repair-model source-review type-safety warnings reported by Obsidian.

## Fixed

- Reworked repair issue collection to avoid unsafe `any`/`error`-typed value warnings during Obsidian source review.

## Compatibility

- `minAppVersion` remains `1.7.2`.
- No manual migration is required.
- No user-facing behavior changed.
