# Forge 1.0.0

Forge 1.0.0 is a milestone release that establishes schema as the single authoritative source for all vault ontology contracts. This release contains breaking changes to the schema contract structure. Migration is required before upgrading.

---

## What changed

### Schema is now the single source of truth

In previous versions, some ontology contracts — relationship definitions, field type metadata, day counts for stale review — lived inside Forge internals rather than in schema. In 1.0.0 this inversion is corrected. Schema owns all contracts. Forge consumes them.

The schema contract has been restructured into five explicit top-level sections:

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

Each section has a clear ownership and purpose. Consumers other than Forge can read this file and reconstruct the full ontology without referencing plugin internals.

### Inline fields are now structured

The flat `inline_fields` list is replaced by `inline.allowed` — a list of objects. Each entry carries at minimum `name`. Entries can also carry `required_when` and `severity` to express conditional requirements scoped to specific note types:

```yaml
inline:
  allowed:
    - name: workout_name
      required_when:
        field: type
        values:
          - workout
      severity: warning
```

### Stale review day counts live in schema

The day count for each `review_cycle` value is now declared in schema via `values_meta`. Adding `biweekly` or `semiannual` to your enum and providing a `days` value is all that's needed — Forge picks it up automatically:

```yaml
- name: review_cycle
  type: enum
  values:
    - weekly
    - biweekly
  values_meta:
    weekly:   { days: 7 }
    biweekly: { days: 14 }
```

### Forbidden tag namespaces

`tag_rules` now supports `forbidden_namespaces` — strings that are explicitly reserved and must not be used as tag namespaces. Violations are always `error` severity:

```yaml
tag_rules:
  forbidden_namespaces:
    - type
    - status
    - domain
```

### Relationship headings in templates

Template refinement can now inject relationship headings from schema into generated templates. Enable in Settings → Shapes → Template Refinement. For each relationship where the shape type participates as a source or flexible member, Forge adds a heading and the relationship description:

```markdown
## Related

### Informs

Shapes understanding, interpretation, reasoning, or decision-making.

### Enables

Makes another capability, method, procedure, project, or outcome possible.
```

### Repair improvements

Vault Repair now shows a Write & Open Patch button so you can review the patch before deciding to apply it. A new settings flag — Repair prompt threshold — controls whether the repair button appears after warnings as well as errors.

---

## Migration guide

1. Open your `schema.md` note
2. Replace the contract YAML block with the 1.0.0 structure — see the Schema Reference documentation for the complete template
3. Move `required_fields` entries to `frontmatter.required`
4. Move `optional_fields` entries to `frontmatter.optional`
5. Move `inline_fields` entries to `inline.allowed` — each entry must be an object with at minimum `name`
6. Move relationship definitions to `ontology.relationships` — structure is unchanged from the previous `ontology.relationships` block if you had one
7. Remove the `meta` top-level key if present — Forge no longer reads it, but leaving it in place is harmless
8. Run **Forge: Validate Schema** — fix any reported issues before running lint

The schema structure is validated on every Validate Schema run. Forge will report clearly which required sections are missing or malformed.

---

## Settings changes

Two new settings appear in Settings → Lint:

- **Version field location** — inline or frontmatter; defaults to inline
- **Version field** — which field holds the version; schema-driven dropdown; defaults to `version`
- **Repair prompt threshold** — errors only or errors and warnings

Three new settings appear in Settings → Shapes → Template Refinement when refinement is enabled:

- **Inject relationship headings from schema** — toggle
- **Relationship parent heading** — heading name; default `Related`
- **Relationship heading level** — H1, H2, or H3; default H1
- **Relationship injection position** — Append or Inject

### Upgrade notice

Users upgrading from a previous installation will see a one-time migration notice on first load. The notice summarises the schema changes and links to the upgrade guide. It does not appear on fresh installs and will not appear again after it is dismissed.