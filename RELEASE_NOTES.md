# Forge 1.5.3

Forge 1.5.3 makes Shape Lint treat populated child sections as satisfying a parent section.

## What changed

- Shape Lint no longer flags a parent heading as empty when meaningful content exists in descendant sections.
- This makes flexible container headings like `# Details` work without forcing fixed child headings into the template.

## Compatibility

- Existing shapes and templates remain supported.
- No user migration is required.