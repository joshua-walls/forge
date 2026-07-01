# Forge 1.8.6

Forge 1.8.6 improves Vault Health Lockblock controls when Lockblock exposes its lock state.

## What changed

- The Lockblock section now uses Lockblock's public `getVaultLockState()` API when available.
- Forge now shows the relevant Lockblock action for the current state: `Set up`, `Unlock vault`, or `Lock vault`.
- The Lockblock status badge can now show `Not set up`, `Locked`, or `Unlocked`.

## Compatibility

- No migration is required.
- `minAppVersion` remains `1.7.2`.
- Lockblock state-aware controls require a Lockblock build with `getVaultLockState()`; Forge falls back gracefully if the API is unavailable.
