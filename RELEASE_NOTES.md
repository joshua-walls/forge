# Forge 1.5.4

Forge 1.5.4 adds a selectable inbox retention action so stale inbox notes can either be deleted during maintenance or surfaced as Vault Lint warnings.

## What changed

- Maintenance settings now include an `Inbox retention action` selector.
- You can choose `Delete in maintenance` to keep the previous cleanup behavior.
- You can choose `Warn in Vault Lint` to keep stale inbox notes and report them through lint instead.

## Compatibility

- Existing inbox retention day settings remain supported.
- The default inbox retention action is `Delete in maintenance`, so current behavior is preserved until changed.
- No user migration is required.
