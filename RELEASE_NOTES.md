# Forge 1.8.5

Forge 1.8.5 gives Vault Health dashboard section titles stable status hooks for theme authors.

## What changed

- Section title elements now carry `data-status` with the same good, warning, critical, or muted state as their section.
- Existing section, section header, and status badge status hooks still work.
- Theme CSS can now color headings like `Health Summary`, `Schema Health`, `Active Issues`, and `Ontology` by DOM state instead of hard-coding section names or parsing visible text.

## Compatibility

- No migration is required.
- `minAppVersion` remains `1.7.2`.
