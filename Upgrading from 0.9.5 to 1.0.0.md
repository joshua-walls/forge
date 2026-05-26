This guide covers upgrading Forge from 0.9.5 to 1.0.0.

Forge 1.0.0 is a milestone release. It introduces a breaking change to the schema contract. Existing `schema.md` files must be migrated to the new structure, and the plugin files must be replaced. Both steps are required — the order does not matter.

---

# Before You Start

Back up your vault before proceeding.

Good backup systems include:

- Git
- Obsidian Sync
- Time Machine
- OneDrive version history
- Dropbox version history

If you use Git, commit your current vault state now so you have a clean rollback point.

---

# Migrate schema.md

## Why the Schema Structure Changed

In earlier versions, some of what Forge knew about your vault — relationship definitions, inline field rules, stale review day counts — lived inside the plugin itself rather than in your schema. That meant Forge held information you could not see, edit, or reason about without reading plugin internals.

The 1.0.0 schema contract corrects that. Everything Forge needs to understand your vault's structure is now declared in `schema.md`. The plugin reads it; it does not hold it.

This matters for two reasons.

First, it makes onboarding easier. A new user can open `schema.md` and read a complete picture of the vault's metadata rules, relationships, and tag conventions without knowing anything about how Forge works internally. The schema is self-describing.

Second, it makes the plugin easier to extend. Because Forge consumes contracts rather than encoding them, new capabilities can be added by expanding the schema structure rather than changing plugin logic. Features like conditional inline field requirements and schema-driven review cycles are only possible because the contract is explicit and owned by the user.

---

## What Changed

The previous schema used flat top-level keys for field lists. The 1.0.0 schema restructures those into five explicit sections:

```yaml
frontmatter:
  required:
  optional:

inline:
  allowed:

ontology:
  relationships:

tag_rules:

exempt_paths:
```

Each section has a clear purpose. Consumers other than Forge — Dataview queries, external scripts, AI workflows — can read this file and reconstruct the full structure of the vault without referencing plugin internals.

---

## Key Mapping

The following top-level keys have been removed:

- `required_fields`
- `optional_fields`
- `inline_fields`
- `meta`
- `domain_model`

The following replacements apply:

| Removed key | Replacement |
|---|---|
| `required_fields` | `frontmatter.required` |
| `optional_fields` | `frontmatter.optional` |
| `inline_fields` | `inline.allowed` |
| `meta` | Removed — delete this block |
| `domain_model` | Removed — delete this block |

The structure of individual field entries under `frontmatter.required` and `frontmatter.optional` is unchanged.

---

## Inline Fields

The `inline_fields` key accepted a flat list of strings. The `inline.allowed` replacement accepts a list of objects. Each entry must have at minimum a `name` key.

Before:

```yaml
inline_fields:
  - source
  - version
```

After:

```yaml
inline:
  allowed:
    - name: source
    - name: version
```

Because entries are now objects, they can carry additional rules. Entries may include `required_when` and `severity` to express conditional requirements scoped to specific note types:

```yaml
inline:
  allowed:
    - name: version
      required_when:
        field: type
        values:
          - capability
      severity: warning
```

This was not expressible in the previous flat list. The structured format is what makes it possible.

---

## Stale Review Day Counts

The internal hardcoded day map for `review_cycle` has been removed. Day counts are now declared in schema via `values_meta` on the `review_cycle` field.

If you use stale review, add `values_meta` to your `review_cycle` field definition:

```yaml
- name: review_cycle
  type: enum
  severity: error
  values:
    - weekly
    - monthly
    - quarterly
    - yearly
    - never
  values_meta:
    weekly:    { days: 7 }
    monthly:   { days: 30 }
    quarterly: { days: 90 }
    yearly:    { days: 365 }
    never:     { days: null }
```

Forge reads day counts directly from `values_meta`. Adding or removing cycle values in schema automatically updates stale review behavior — no plugin changes required.

If you do not use stale review, `values_meta` is optional and can be added later.

---

## Forbidden Tag Namespaces

`tag_rules` now supports a `forbidden_namespaces` list. Namespaces listed here are explicitly reserved and must not be used as tag prefixes. Violations are always `error` severity.

```yaml
tag_rules:
  forbidden_namespaces:
    - type
    - status
    - domain
```

This key is optional. Add it if you want to enforce namespace reservations.

---

## Validate the Schema

After editing `schema.md`, run:

```text
Forge: Validate Schema
```

If you have already replaced the plugin files, this runs the full 1.0.0 validation — each section and subsection is checked against the expected contract shape. Fix any reported issues before running lint.

If you are still on 0.9.5, this confirms the YAML is parseable. It will not validate the new structure fully, but it will surface syntax errors before you replace the plugin.

---

# Replace the Plugin Files

---

## Community Plugins

If Forge is installed through Obsidian's Community Plugins browser, update it the same way as any other plugin:

```text
Settings → Community Plugins → Check for updates
```

Enable auto-update or click **Update** next to Forge. Obsidian handles the file replacement. Reload the plugin after updating.

---

## Manual Installation

If you installed Forge manually, replace the three plugin files:

```text
.obsidian/plugins/forge/main.js
.obsidian/plugins/forge/manifest.json
.obsidian/plugins/forge/styles.css
```

Then in Obsidian, go to Settings → Community Plugins and click **Reload plugins**, or disable and re-enable Forge.

---

## New Settings

These settings are new in 1.0.0. Forge populates them automatically from defaults on first load. No manual action is required unless you want to change the defaults.

| Setting | Default | Purpose |
|---|---|---|
| Version field location | Inline | Where the schema version field lives |
| Version field | `version` | Which field holds the schema version |
| Repair prompt threshold | Errors only | When the Vault Repair button appears after lint |
| Cycle field location | Frontmatter | Location picker for stale review cycle field |
| Updated field location | Frontmatter | Location picker for stale review updated field |
| Filter field location | Frontmatter | Location picker for stale review filter field |
| Inject relationship headings | Off | Injects relationship headings into templates |
| Relationship parent heading | `Related` | Parent heading name for injected relationships |
| Relationship heading level | H2 | Heading level for the parent heading |
| Relationship injection position | Append | Append section at end or inject under existing heading |

---

# After Upgrading

Run these commands once both steps are complete.

---

## Validate Schema

Run:

```text
Forge: Validate Schema
```

Forge performs recursive structural validation in 1.0.0 — each section and subsection is checked against the expected contract shape. If you validated while still on 0.9.5, run this again now to confirm against the full 1.0.0 rules.

Fix any reported issues before running lint.

---

## Run Vault Lint

Run:

```text
Forge: Run Vault Lint
```

Verify the results match your expectations before continuing with normal workflows.

If you use stale review, confirm the cycle field behaviour matches what you configured in `values_meta`.

---

# Upgrade Checklist

Both steps are required. Complete them in whichever order suits your workflow.

```text
Schema migration
  [ ] Edit schema.md  →  restructure to 1.0.0 contract
  [ ] Validate Schema  →  check for errors

Plugin replacement
  [ ] Build 1.0.0 plugin  →  npm install && npm run build
  [ ] Copy main.js / manifest.json / styles.css  →  .obsidian/plugins/forge/
  [ ] Reload Obsidian plugins

Once both are done
  [ ] Validate Schema in 1.0.0  →  full validation gate
  [ ] Back up vault
  [ ] Run Vault Lint  →  confirm baseline
```

---

# Related Notes

- [[reference/1. Schema Reference|Schema Reference]]
- [[reference/2. Vault Lint|Vault Lint]]
- [[reference/6. Settings Reference|Settings Reference]]
- [[workflows/1. Vault Repair|Vault Repair]]
