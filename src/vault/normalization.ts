import {
  convertTagSeparator,
  getTags,
  isInvalidTag,
  normalizeTags,
  setTags,
} from "../utils/tags.js";

export interface FrontmatterNormalizationPlan {
  changed: boolean;
  frontmatter: Record<string, unknown>;
  details: string[];
}

export function planNormalizeTags(
  frontmatter: Record<string, unknown>
): FrontmatterNormalizationPlan {
  const originalTags = getTags(frontmatter);
  const converted = originalTags
    .map(convertTagSeparator)
    .filter((tag) => !isInvalidTag(tag));
  const normalized = normalizeTags(converted);

  const originalStr = originalTags.join("|");
  const normalizedStr = normalized.join("|");

  if (originalStr === normalizedStr) {
    return {
      changed: false,
      frontmatter: { ...frontmatter },
      details: [],
    };
  }

  const removedCount = originalTags.length - converted.length;
  const convertedCount = originalTags.filter((tag) => convertTagSeparator(tag) !== tag).length;
  const details: string[] = [];

  if (convertedCount > 0) details.push(`${convertedCount} separator(s) fixed`);
  if (removedCount > 0) details.push(`${removedCount} invalid tag(s) removed`);
  details.push("sorted/deduped");

  const normalizedFrontmatter = { ...frontmatter };
  setTags(normalizedFrontmatter, normalized);

  return {
    changed: true,
    frontmatter: normalizedFrontmatter,
    details,
  };
}

export function planNormalizeFrontmatter(
  frontmatter: Record<string, unknown>,
  lowercaseFields: Iterable<string>
): FrontmatterNormalizationPlan {
  const normalizedFrontmatter = { ...frontmatter };
  let changed = false;
  const details: string[] = [];

  const upperKeys = Object.keys(normalizedFrontmatter).filter((key) => key !== key.toLowerCase());
  if (upperKeys.length > 0) {
    for (const key of upperKeys) {
      const lower = key.toLowerCase();
      normalizedFrontmatter[lower] = normalizedFrontmatter[key];
      delete normalizedFrontmatter[key];
    }
    changed = true;
    details.push(`${upperKeys.length} field name(s) lowercased`);
  }

  for (const field of lowercaseFields) {
    if (!(field in normalizedFrontmatter)) continue;

    const original = normalizedFrontmatter[field];
    if (typeof original !== "string") continue;

    const lower = original.toLowerCase();
    if (original !== lower) {
      normalizedFrontmatter[field] = lower;
      changed = true;
      details.push(`${field} value lowercased`);
    }
  }

  const tags = getTags(normalizedFrontmatter);
  const loweredTags = tags.map((tag) => tag.toLowerCase());
  if (tags.join("|") !== loweredTags.join("|")) {
    setTags(normalizedFrontmatter, loweredTags);
    changed = true;
    details.push("tags lowercased");
  }

  return {
    changed,
    frontmatter: normalizedFrontmatter,
    details,
  };
}
