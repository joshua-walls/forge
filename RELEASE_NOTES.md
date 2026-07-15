# Forge 2.0.1

Forge 2.0.1 completes the Obsidian-only refactor.

Sorry for pushing 2.0.0 before this refactor was actually finished. This release removes the old host-independent core boundary from active plugin wiring and leaves Forge as a normal Obsidian plugin codebase.

## Highlights

- Removed the old local `forge-core` package from active architecture and package wiring.
- Reorganized former core logic into responsibility-based Obsidian plugin modules.
- Kept `src/` structured by plugin responsibility instead of flattening everything into one directory.
- Rebuilt imports, tests, and build configuration around local plugin modules instead of `@forge/core`.
- Preserved existing settings compatibility and user-facing behavior.
- Updated desktop and mobile test vault installs with the 2.0.1 release assets.

## Architecture

Linting, schema parsing, vault document handling, dashboard models, patching, repairs, shape linting, exports, docs install, ontology services, settings, and app UI now live under normal plugin modules.

The old `forge-core` package and `@forge/core` dependency are no longer consumed by the plugin build.

## Compatibility

- `minAppVersion` remains `1.7.2`.
- No manual migration is required.
- Existing Forge settings remain compatible.
