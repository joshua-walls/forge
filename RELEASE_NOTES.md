# Forge 1.6.4

Forge 1.6.4 makes Dataview Expansion auto-update safer in synced vaults by keeping the auto-update mode local to the current session and narrowing which file changes can trigger automatic refresh.

## What changed

- Dataview Expansion auto-update mode is now current-session only and is not written to synced plugin settings.
- Automatic Dataview Expansion refresh now follows only the note you are actively editing or just left, instead of reacting to any synced Markdown file change in the vault.

## Compatibility

- Existing Dataview Expansion settings remain supported.
- Older synced auto-update mode values are ignored automatically.
- No migration is required.