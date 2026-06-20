# Forge 1.7.0

Forge 1.7.0 adds basic Lockblock controls to the Forge health dashboard.

## What changed

- When Lockblock is installed and enabled, the dashboard now shows a Lockblock section.
- The section exposes basic vault actions: `Unlock vault`, `Lock vault`, and `Change password`.
- Forge calls Lockblock's exact command IDs so unlock, lock, and password-change actions stay separate.
- The section appears or disappears automatically when Lockblock is enabled or disabled.
- Dataview Expansion dashboard controls also appear or disappear automatically when Dataview is enabled or disabled.

## Compatibility

- No migration is required.
- `minAppVersion` remains `1.7.2`.
