# Forge 1.10.2

Forge 1.10.2 tightens Vault Health dashboard signal so the summary shows fewer empty or unavailable metrics and Shape Lint issues get their own issue box.

## What changed

- Invalid frontmatter is hidden from the Health Summary when the count is `0`.
- Normalization candidates are hidden until Forge has a real recorded count.
- Shape Lint issues appear in the Health Summary only when Shape Lint is enabled.
- Shape Lint issues now render in a dedicated Shape Lint Issues section.
- Shape Lint issues now affect overall Vault Health warning state.

## Compatibility

- `minAppVersion` remains `1.7.2`.
- No manual migration is required.
