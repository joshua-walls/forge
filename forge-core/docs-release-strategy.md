# Forge Core Release Strategy

`@forge/core` is the only shared contract between host repositories.

## Git Model

- Keep `forge-core` as an independent repository.
- Release core with semver.
- Hosts consume core through one of:
  - local `file:../forge-core` during sibling development,
  - npm package,
  - private registry package,
  - Git dependency,
  - CI-packaged artifact.

## Build Contract

`dist/` is the package contract. Host builds must consume the package exports, not source files.

Required validation:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

## Host Rule

Core returns plain data. Hosts handle file access, UI, diagnostics, commands, settings screens, and packaging.
