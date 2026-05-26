# Forge 1.1.0

Forge 1.1.0 adds the Vault Health Dashboard, a read-only operational view for Forge vault governance. It brings lint status, schema health, ontology metrics, patch history, and maintenance visibility into one native Obsidian surface.

---

## What changed

### Vault Health Dashboard

Forge now includes a custom Obsidian view for vault health. The dashboard opens in the workspace like a native panel and is designed for fast operational review instead of generated markdown output.

The dashboard includes:

- Health summary
- Dedicated schema health section
- Active lint issues
- Ontology metrics
- Maintenance history
- Section-level health indicators
- Manual refresh controls
- Direct action buttons for lint and schema validation

The dashboard is read-only. It does not repair files, normalize metadata, apply patches, or modify vault notes.

### Schema health

Schema validation now has its own dashboard section because schema health determines whether the rest of Forge can be trusted.

The Schema Health section shows:

- Valid, warning, invalid, or not-yet-validated state
- Last validation timestamp
- Error and warning counts
- Schema path
- **Validate Schema** button
- **Open schema.md** button

Schema validation issues are no longer mixed into Active Issues. Active Issues is focused on lint findings, while schema problems are surfaced in the Schema Health section.

### Service-backed health data

Forge now has reusable service layers for the systems the dashboard reads:

- Lint service
- Schema validation service
- Ontology metrics service
- Patch history service
- Dashboard composition service

These services return structured data instead of relying on command UI side effects. Existing commands remain the user-facing entry points, while the dashboard consumes service results.

### Dashboard cache

The latest dashboard-visible results are cached at:

```text
System/Forge/health-dashboard.json
```

The cache stores the latest known results for lint, schema validation, ontology metrics, patch history, and the composed dashboard snapshot. This lets the dashboard open quickly and display the most recent available state before a manual refresh is run.

### Manual refresh and command-driven updates

Forge 1.1.0 does not add background watchers, scheduled scans, file-system daemons, or continuous validation.

The dashboard can be refreshed manually with:

```text
Forge: Refresh Vault Health Dashboard
```

Individual Forge commands also update their dashboard sections when they run:

- **Forge: Run Vault Lint** updates Health Summary and Active Issues
- **Forge: Validate Schema** updates Schema Health
- **Forge: Export Ontology Index** updates Ontology Metrics
- **Forge: Apply Vault Patch** updates Maintenance History

If the dashboard is open, it refreshes from the latest cached state after these commands complete.

### New commands

Forge 1.1.0 adds two dashboard commands:

- **Forge: Open Vault Health Dashboard**
- **Forge: Refresh Vault Health Dashboard**

The dashboard also includes in-view buttons for common actions:

- **Run Vault Lint**
- **Validate Schema**
- **Open schema.md**

### Existing command integration

Dashboard integration is additive. Existing command modals, notices, reports, generated files, and command behavior remain intact.

Forge commands now publish structured results that the dashboard can read, but the dashboard does not replace the existing command workflows.