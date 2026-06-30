# Forge 1.8.3

Forge 1.8.3 removes unsafe TypeScript patterns flagged by Obsidian source review after the dashboard layout release.

## What changed

- Added typed YAML serialization helpers so frontmatter/template writes avoid unsafe `any` call and assignment warnings.
- Replaced direct `trimEnd()` use in review-flagged code paths with typed trimming helpers.
- Replaced `Object.fromEntries()` ontology sorting with an explicit typed record build to avoid unsafe return warnings.

## Compatibility

- No migration is required.
- `minAppVersion` remains `1.7.2`.
