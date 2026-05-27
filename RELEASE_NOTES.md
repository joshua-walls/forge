# Forge 1.4.0

Forge 1.4.0 turns the Vault Health Dashboard into a more complete operational surface for day-to-day Forge work.

## What changed

- The Forge Health dashboard now preloads into the right sidebar as a side-panel tab, so it is available without first running the open-dashboard command.
- Dashboard action buttons now cover the main operational workflows: lint, maintenance, normalization, schema validation, vault repair, ontology refresh, snapshot export, shape lint, template refinement, patch restore, patch history, and last-run review.
- A Settings button was added beside Refresh for fast access to Forge settings from the dashboard.
- Dashboard action buttons now use a responsive grid that is friendlier on mobile and narrow side panes.
- Forge now records recent operational runs for maintenance, normalization, template refinement, and shape repair.
- Patch history now surfaces recent repair and normalization activity when available.
- Template refinement now supports a dry-run mode for future preview workflows while preserving the existing command behavior.
- A shared preview type contract was added as the foundation for future preview/apply workflows.

## Compatibility

- Existing command palette workflows remain available.
- Existing patch, restore, lint, schema, export, repair, and normalization behavior is preserved.
- Dashboard cache schema was bumped internally and migrates gracefully; no user action is required.

## Notes

The preview/apply foundation is included in this release, but the full selected-apply modal workflow is intentionally not exposed yet.