import { splitFrontmatter } from "./frontmatter.js";
import type { ForgeDocument } from "./lint.js";
import { normalisePath } from "./paths.js";
import type { ForgeYamlParser } from "./schema.js";

export interface CreateForgeDocumentOptions {
  path: string;
  content: string;
  parseYaml: ForgeYamlParser;
  stat?: ForgeDocument["stat"];
}

export function createForgeDocument(options: CreateForgeDocumentOptions): ForgeDocument {
  const path = normalisePath(options.path);
  const split = splitFrontmatter(options.content);
  const { basename, extension } = parsePathParts(path);
  let frontmatter: Record<string, unknown> = {};

  if (split) {
    try {
      const parsed = options.parseYaml(split.yaml);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        frontmatter = parsed as Record<string, unknown>;
      }
    } catch {
      frontmatter = {};
    }
  }

  const document: ForgeDocument = {
    path,
    basename,
    extension,
    content: options.content,
    frontmatter,
    hasFrontmatter: split != null,
  };

  if (options.stat) document.stat = options.stat;
  return document;
}

function parsePathParts(path: string): { basename: string; extension: string } {
  const filename = path.split("/").pop() ?? path;
  const lastDot = filename.lastIndexOf(".");

  if (lastDot <= 0 || lastDot === filename.length - 1) {
    return {
      basename: filename,
      extension: "",
    };
  }

  return {
    basename: filename.slice(0, lastDot),
    extension: filename.slice(lastDot + 1).toLowerCase(),
  };
}
