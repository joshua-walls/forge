export interface ParsedMarkdownDocument {
  path: string;
  content: string;
  frontmatter: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
}

const PREFERRED_FIELD_ORDER = [
  "type",
  "kind",
  "domain",
  "status",
  "shapes",
  "tags",
  "created",
  "updated",
  "review_by",
  "ai_private",
  "ai_open_questions",
  "source",
  "supersedes",
  "superseded_by",
  "version",
  "review_cycle",
];

export function splitFrontmatter(raw: string): { yaml: string; body: string } | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  return {
    yaml: match[1] ?? "",
    body: match[2] ?? "",
  };
}

export function sortFrontmatterFields(
  frontmatter: Record<string, unknown>,
  fieldOrder?: string[]
): Record<string, unknown> {
  const order = fieldOrder ?? PREFERRED_FIELD_ORDER;
  const result: Record<string, unknown> = {};

  for (const field of order) {
    if (Object.prototype.hasOwnProperty.call(frontmatter, field)) {
      result[field] = frontmatter[field];
    }
  }

  const remaining = Object.keys(frontmatter)
    .filter((key) => !order.includes(key))
    .sort();

  for (const key of remaining) {
    result[key] = frontmatter[key];
  }

  return result;
}

export function isFieldPresent(
  frontmatter: Record<string, unknown>,
  fieldName: string
): boolean {
  if (!Object.prototype.hasOwnProperty.call(frontmatter, fieldName)) {
    return false;
  }

  const value = frontmatter[fieldName];
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function getFmString(
  frontmatter: Record<string, unknown>,
  fieldName: string
): string {
  const value = frontmatter[fieldName];
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string | number | boolean => (
        typeof item === "string" || typeof item === "number" || typeof item === "boolean"
      ))
      .map((item) => String(item))
      .join("; ");
  }
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}
