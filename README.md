# Vault Forge

Vault Forge is a schema-driven vault governance plugin for Obsidian.

It helps maintain vault health by validating notes against a canonical schema, normalizing frontmatter and tags, applying vault patches, and running maintenance operations.

## Features

- Apply Vault Patch
- Run Vault Lint
- Validate Schema
- Normalize Tags
- Normalize Frontmatter
- Vault Maintenance
- Vault Repair
- Remove Legacy Blocks
- Rename Dataview Folder

## Development

```bash
npm install
npm run build
```

Copy the built files into:

```text
.vscode/plugins/vault-forge/
```

Then enable the plugin inside Obsidian.

## License

MIT
