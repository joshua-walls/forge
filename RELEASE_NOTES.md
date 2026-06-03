# Forge 1.5.5

Forge 1.5.5 adds a synced-settings reload banner to the Forge Health side panel so cross-device plugin setting changes can be applied without refreshing Community Plugins.

## What changed

- Forge now watches synced changes to its plugin `data.json` file.
- When settings change on another device, Forge Health shows a passive `Reload` banner in the side panel.
- Reload applies the synced settings to the live plugin state and refreshes dependent dashboard behavior without opening Settings.

## Compatibility

- Existing settings files remain supported.
- The reload banner only appears when synced settings differ from the current in-memory state.
- No user migration is required.
