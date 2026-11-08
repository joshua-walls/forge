# Forge 3.1.1

Forge 3.1.1 makes mobile Vault Repair easier to navigate and improves missing
creation-date suggestions.

## Fixed

- Compact field rows and collapsible issue details reduce scrolling on mobile. File actions remain outside the scrolling review area; long forms may still need scrolling.
- Interactive Vault Repair suggests the file creation date reported by Obsidian when `created` is missing. You can edit the suggestion, and the patch preserves your final entry.
- Existing valid `created` dates are protected even when the lint report or metadata cache is outdated.
- Unavailable creation metadata leaves the input blank. If a note cannot be read or its frontmatter cannot be parsed, Forge skips its `created` repair and displays guidance.

## Compatibility

- Forge requires Obsidian `1.10.0` or newer.
- No settings or note migration is required.
- `updated` and `review_by` defaults are unchanged.
- File creation timestamps can change when files are copied or synced. Review the suggestion before writing a patch.

## After updating

1. Disable and re-enable Forge in Community plugins to load the update.
2. Run **Forge: Run Vault Lint**, then **Forge: Vault Repair**.
3. Review the suggested fields and generated patch before applying changes.

## Verification

- Automated tests cover metadata suggestions, manual overrides, unavailable metadata, existing dates, and stale-cache behavior.
- Desktop Obsidian testing confirmed that a generated patch preserves an edited creation date.
- Small-screen desktop emulation and a user-reported phone test passed. The original Android editing flicker remains unconfirmed; this release does not claim to resolve it.

---

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
