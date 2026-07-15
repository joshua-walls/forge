# Forge 2.0.2

Forge 2.0.2 fixes the source-review lint failure after the Obsidian-only refactor.

## Fixed

- Broad ESLint/source-review scans now ignore generated test output, test files, and build-support scripts that are outside the Obsidian plugin runtime.
- `lint:obsidian` now runs the same broad ESLint entry point, so local validation catches this class of source-review configuration issue.

## Compatibility

- `minAppVersion` remains `1.7.2`.
- No manual migration is required.
- No user-facing behavior changed.
