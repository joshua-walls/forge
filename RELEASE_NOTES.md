# Forge 2.0.3

Forge 2.0.3 addresses additional Obsidian source-review type-safety warnings.

## Fixed

- Removed unsafe `any`/`error`-typed value patterns from dashboard inventory categorization, workspace normalization summaries, repair operation planning, and active-file lint cache pruning.
- Removed an unnecessary type assertion in active-file lint pruning without changing runtime behavior.

## Compatibility

- `minAppVersion` remains `1.7.2`.
- No manual migration is required.
- No user-facing behavior changed.
