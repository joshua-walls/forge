# Forge 1.10.0

Forge 1.10.0 adds scoped patch targets so bulk operations can be narrowed by dates, fields, tags, paths, and safety limits before they run.

## What changed

- Added `scope` support to all patch operations, including tag, field, frontmatter, compute, and move operations.
- Added date scopes such as `updated_since`, `updated_before`, `created_since`, and filesystem modified/created date filters.
- Added field, tag, path, `type`, `status`, and `limit` scope predicates for safer patch runs.
- Applied patch notes are now copied into `Applied` instead of moved, so reusable patch notes can stay available.
- Updated bundled Patch Engine docs and examples with generic scoped-target guidance.

## Compatibility

- No migration is required.
- Existing patches continue to work without changes.
- `minAppVersion` remains `1.7.2`.
