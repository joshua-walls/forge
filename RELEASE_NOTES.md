# Forge 2.0.0

Forge 2.0.0 is the shared-core and Vault Health release. It reorganizes the Obsidian dashboard around daily use, adds a desktop status bar affordance, and moves Forge's lint, repair, patch, dashboard, export, schema, settings, and shape logic into shared core modules used by the plugin build.

## Highlights

- New desktop-only Forge status bar item with current health, dashboard open, and quick actions.
- Vault Health is now split into `Overview`, `Note`, `Issues`, and `Tools`.
- Dashboard refresh now runs in dependency order so one refresh produces complete output.
- Shape Health now uses the same issue format as Active Issues.
- Schema Health owns its contextual `Validate schema` action.
- Dashboard actions are grouped into Checks, Cleanup, and Outputs.
- Dashboard inventory and dashboard-triggered exports are optional and off by default.
- Empty headings can now be allowed for intentionally structural notes.
- Mobile and narrow-sidebar layouts have been tightened across tabs, action buttons, issue rows, and Open buttons.

## Dashboard

`Overview` now focuses on Health Summary, Recommendations, optional Vault Inventory, and Ontology.

`Note` focuses on the active note's Lint, Shape, and Needs Review state.

`Issues` contains active lint issues, Shape Health, and Needs Review using one consistent issue-list pattern.

`Tools` contains grouped actions, Schema Health, Lockblock, and Maintenance History.

## Performance And Defaults

Dashboard inventory is now opt-in. Forge does not count non-note assets unless Dashboard inventory is enabled.

Dashboard-triggered exports are now opt-in. Forge still supports exports, but a normal dashboard refresh will not regenerate them unless Dashboard refresh exports is enabled.

Refresh metrics updates ontology metrics and, when inventory is enabled, file inventory. It does not require exports.

The status bar uses the latest dashboard snapshot when available and does not run scans just to update itself.

## Compatibility

- `minAppVersion` remains `1.7.2`.
- No manual migration is required.
- If you relied on dashboard refresh regenerating exports, enable Dashboard refresh exports in Forge settings.
