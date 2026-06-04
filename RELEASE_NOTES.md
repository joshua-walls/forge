# Forge 1.5.6

Forge 1.5.6 makes dashboard auto-refresh a runtime-only control so it never syncs across devices and always starts off on load.

## What changed

- Dashboard auto-refresh is no longer saved into plugin `data.json`.
- Auto-refresh and its interval now live only in the current running dashboard session.
- Every plugin load starts auto-refresh off by default, regardless of any older saved value.

## Compatibility

- Existing settings files remain supported.
- Older saved auto-refresh keys are ignored automatically.
- No user migration is required.
