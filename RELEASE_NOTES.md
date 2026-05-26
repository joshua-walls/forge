# Forge 1.2.0

Forge 1.2.0 adds operation-level Patch Restore. Restore now works from structured patch operation data instead of relying only on full-file `.bak` replacement.

---

## What changed

### Operation-level restore manifests

Confirmed patch runs now write `manifest_version: 2` restore manifests. New manifests include an `operations` array with:

- operation id
- operation index
- operation type
- file path before and after
- restore target
- before value
- after value
- reverse action

This gives Forge enough data to reverse individual patch operations.

### Selective Patch Restore

`Forge: Restore Patch Run` now distinguishes between newer operation manifests and legacy backup-only manifests.

For operation manifests, Forge shows each reversible operation with its file, label, status, and before/after summary. Users can select which reversible operations to restore.

### Conflict-aware safety

Before restoring an operation, Forge checks the current vault state. Restore proceeds only when the current value still matches the value written by the original patch.

If a user edited that field, tag list, frontmatter order, or moved path after the patch ran, Forge marks the operation as conflicted and skips it by default.

### Legacy fallback

Older manifests still restore through the existing full-file backup path. Forge now labels these as legacy full-file restores and shows a stronger overwrite warning.

New patch applies no longer create full-file `.bak` backups. Operation-level manifests are the restore source going forward.

### Restore reports

Operation-level restores write a patch restore report with restored, conflicted, skipped, and error counts.

---

## Scope notes

Plain note moves are reversible. Move operations that also rewrite or strip frontmatter are not marked as operation-restorable in this version because reversing only the path would not fully reverse the operation.

Existing backups remain useful as legacy recovery artifacts, but new normal restore behavior is operation-level and conflict-aware.
