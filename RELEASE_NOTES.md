# Forge 3.1.0

Forge 3.1.0 improves Vault Repair for large vaults and mobile screens.

## Added

- Vault Repair preflight screen with repairable issue and file counts.
- Bounded repair runs: review the first N findings or all findings.
- Compact mobile repair layout.

## Changed

- Only selected findings enter the repair review and generated patch.
- Mobile repair forms hide redundant `Valid:` and `Format:` descriptions.

## Compatibility

- Forge requires Obsidian `1.10.0` or newer.
- No settings or note migration is required.
- Reload the Forge plugin after updating.

## Test

1. Run **Forge: Run Vault Lint**.
2. Run **Forge: Vault Repair**.
3. Review a bounded finding count.
4. Confirm selected files and findings only enter the repair flow.
5. Review the patch before applying it.

---

# Forge 3.0.2

Forge 3.0.2 is a source-compatibility patch for dynamic Shape heading matching.

## Fixed

- Replaced `String.matchAll()` with an ES2018-compatible, fully typed regular-expression loop.
- Removed unsafe TypeScript source-review warnings from dynamic heading placeholder matching.

## Compatibility

- Forge requires Obsidian `1.10.0` or newer.
- Dynamic heading matching behavior is unchanged from Forge 3.0.1.
- No note or settings migration is required.

## After updating

1. Run **Reload plugins** from the command palette.
