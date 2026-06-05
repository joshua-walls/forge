# Forge 1.6.8

Forge 1.6.8 is a small workflow release focused on faster note-by-note linting during editing, plus the remaining Community Plugins UI-linter cleanup tied to that work.

## What changed

- Added an active-file auto-lint path so Forge can lint just the note you are editing instead of requiring a full-vault pass for every small check.
- Added a simple Settings toggle for turning active-file auto-lint on or off.
- Added active-file lint triggers for note open, edit idle, leaving the note, switching that same note into reading view, and fast relint after current-note frontmatter or properties edits from reading view.
- Set the new active-file idle lint delay to 10 seconds by default.
- Added a Dataview Expansion auto-update delay setting in seconds, instead of keeping that edit-idle delay fixed at 5 seconds.
- Added a small auto-lint failure notice that names the note and summarizes only errors and warnings.
- Fixed the remaining Obsidian Community Plugins sentence-case lint issue introduced by the new setting copy.

## Compatibility

- No migration is required.
- `minAppVersion` remains `1.7.2`.
