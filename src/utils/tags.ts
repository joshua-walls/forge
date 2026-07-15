// src/utils/tags.ts
// Tag read, write, and normalization utilities.
//
// Port of:
//   Shared/IO/Get-TagList.ps1
//   Invoke-VaultPatch.ps1 → Normalize-TagArray, Set-TagList
//   Invoke-NormalizeTags.ps1 → Convert-TagToken, Should-RemoveTagToken

// ── Read ─────────────────────────────────────────────────────────────────────

/**
 * Extracts the tags array from frontmatter as normalized strings.
 * Returns an empty array if tags field is absent or empty.
 *
 * Port of Get-TagList from Shared/IO/Get-TagList.ps1.
 * Note: unlike the PowerShell version, this does NOT sort/dedupe —
 * that's the job of normalizeTags(). Callers that want sorted output
 * should pipe through normalizeTags().
 */
export function getTags(frontmatter: Record<string, unknown>): string[] {
  const raw = frontmatter["tags"];
  if (raw === null || raw === undefined) return [];

  const list = Array.isArray(raw) ? raw : [raw];

  return list
    .filter((v) => v !== null && v !== undefined)
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0);
}

// ── Write ────────────────────────────────────────────────────────────────────

/**
 * Sets the tags field on a frontmatter object.
 * Always stores tags as an array, never a string.
 *
 * Port of Set-TagList from Invoke-VaultPatch.ps1.
 */
export function setTags(
  frontmatter: Record<string, unknown>,
  tags: string[]
): void {
  frontmatter["tags"] = normalizeTags(tags);
}

// ── Normalize ────────────────────────────────────────────────────────────────

/**
 * Sorts, deduplicates, and trims a tag array.
 * Case-insensitive deduplication — preserves the first occurrence's casing.
 *
 * Port of Normalize-TagArray from Invoke-VaultPatch.ps1.
 */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const tag of tags) {
    const trimmed = tag.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(trimmed);
    }
  }

  return result.sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );
}

// ── Mutation ─────────────────────────────────────────────────────────────────

/**
 * Adds a tag to a tag array if not already present (case-insensitive).
 * Returns a new array — does not mutate the input.
 *
 * Port of Invoke-AddTag from Invoke-VaultPatch.ps1.
 */
export function addTag(tags: string[], tag: string): string[] {
  const trimmed = tag.trim();
  const lower = trimmed.toLowerCase();
  if (tags.some((t) => t.toLowerCase() === lower)) {
    return tags; // already present — no change
  }
  return [...tags, trimmed];
}

/**
 * Removes a tag from a tag array (case-insensitive).
 * Returns a new array — does not mutate the input.
 * Returns the same array reference if the tag was not present.
 *
 * Port of Invoke-RemoveTag from Invoke-VaultPatch.ps1.
 */
export function removeTag(tags: string[], tag: string): string[] {
  const lower = tag.trim().toLowerCase();
  const filtered = tags.filter((t) => t.toLowerCase() !== lower);
  return filtered.length === tags.length ? tags : filtered;
}

/**
 * Replaces one tag with another (case-insensitive match on old tag).
 * If old tag is not present, returns the array unchanged.
 * If new tag is already present, old tag is removed but new tag is not duplicated.
 * Returns a new array — does not mutate the input.
 *
 * Port of Invoke-ReplaceTag from Invoke-VaultPatch.ps1.
 */
export function replaceTag(
  tags: string[],
  oldTag: string,
  newTag: string
): string[] {
  const oldLower = oldTag.trim().toLowerCase();
  const newLower = newTag.trim().toLowerCase();
  const newTrimmed = newTag.trim();

  const hasOld = tags.some((t) => t.toLowerCase() === oldLower);
  if (!hasOld) return tags; // old tag not present — no change

  const hasNew = tags.some((t) => t.toLowerCase() === newLower);

  return tags.reduce<string[]>((acc, t) => {
    if (t.toLowerCase() === oldLower) {
      // Replace old with new — but only if new isn't already in the result
      if (!hasNew) {
        acc.push(newTrimmed);
      }
    } else {
      acc.push(t);
    }
    return acc;
  }, []);
}

// ── Conversion ───────────────────────────────────────────────────────────────

/**
 * Converts legacy colon-separated namespace:tag to namespace/tag format.
 * e.g. "topic:identity" → "topic/identity"
 * Leaves already-correct tags unchanged.
 *
 * Port of Convert-TagToken from Invoke-NormalizeTags.ps1.
 */
export function convertTagSeparator(tag: string): string {
  const trimmed = tag.trim();
  // Match namespace:value (not namespace/value or bare tag)
  if (/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(trimmed)) {
    return trimmed.replace(":", "/");
  }
  return trimmed;
}

/**
 * Returns true if a tag should be removed during normalization.
 * Removes legacy namespace tags that were used incorrectly:
 *   domain, domain/*, status, status/*, type, type/*
 *
 * Port of Should-RemoveTagToken from Invoke-NormalizeTags.ps1.
 */
export function isInvalidTag(tag: string): boolean {
  const lower = tag.trim().toLowerCase();
  return /^(domain|status|type)(\/.*)?$/.test(lower);
}

// ── Tag validation ────────────────────────────────────────────────────────────

/**
 * Returns the namespace portion of a namespaced tag (everything before the first /).
 * Returns null if the tag has no namespace.
 */
export function getTagNamespace(tag: string): string | null {
  const slash = tag.indexOf("/");
  if (slash < 0) return null;
  return tag.substring(0, slash);
}

/**
 * Returns true if a tag is properly namespaced (contains at least one /).
 */
export function isNamespacedTag(tag: string): boolean {
  return tag.includes("/");
}
