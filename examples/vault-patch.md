This is an example patch note.

Copy this structure to:

```text
{{patchFile}}
```

# Patch

```yaml
meta:
  description: Activate Home note

operations:
  - op: set_field
    target: "Home.md"
    field: status
    value: active
```

# Notes

Vault Forge reads only the fenced YAML block for operations. The rest of this note is for humans.
