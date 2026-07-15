import { getVaultPaths, normalisePath, todayString } from "./paths.js";
import type { ForgeSettings } from "./settings.js";

export interface ForgeDocumentationRawSources {
  docs: Record<string, string>;
  examples: Record<string, string>;
}

export interface ForgeDocumentationContext {
  today: string;
  forge: string;
  docsFolder: string;
  examplesFolder: string;
  patchesFolder: string;
  patchFile: string;
  schemaFile: string;
  exportsFolder: string;
  inboxFolder: string;
  shapesFolder: string;
}

export interface ForgeDocumentationNote {
  path: string;
  content: string;
}

export interface BuildForgeDocumentationOptions {
  today?: string;
}

export function buildForgeDocumentation(
  settings: ForgeSettings,
  sources: ForgeDocumentationRawSources,
  options: BuildForgeDocumentationOptions = {}
): ForgeDocumentationNote[] {
  const context = buildForgeDocumentationContext(settings, options);
  const docs: Array<{ relativePath: string; raw: string; type: string; tags: string[] }> = [
    ...Object.entries(sources.docs).map(([key, raw]) => ({
      relativePath: `Docs/${key}.md`,
      raw,
      type: "reference",
      tags: inferDocumentationTags(key),
    })),
    ...Object.entries(sources.examples).map(([key, raw]) => ({
      relativePath: `Examples/${key}.md`,
      raw,
      type: inferDocumentationType(key),
      tags: inferDocumentationTags(key),
    })),
  ];

  return docs.map(({ relativePath, raw, type, tags }) => {
    const body = interpolateDocumentation(raw, context);
    const frontmatter = [
      "---",
      `type: ${type}`,
      "status: active",
      "tags:",
      ...tags.map((tag) => `  - ${tag}`),
      `created: ${context.today}`,
      `updated: ${context.today}`,
      "ai_private: false",
      "review_cycle: never",
      "---",
      "",
    ].join("\n");

    return {
      path: normalisePath(`${context.forge}/${relativePath}`),
      content: `${frontmatter}${body.trim()}\n`,
    };
  });
}

export function buildForgeDocumentationContext(
  settings: ForgeSettings,
  options: BuildForgeDocumentationOptions = {}
): ForgeDocumentationContext {
  const paths = getVaultPaths(settings);
  const today = options.today ?? todayString();

  return {
    today,
    forge: paths.forge,
    docsFolder: `${paths.forge}/Docs`,
    examplesFolder: `${paths.forge}/Examples`,
    patchesFolder: paths.patches,
    patchFile: paths.patchFile,
    schemaFile: paths.schemaMd,
    exportsFolder: paths.exports,
    inboxFolder: paths.inbox,
    shapesFolder: paths.shapes,
  };
}

export function interpolateDocumentation(template: string, context: ForgeDocumentationContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (key in context) {
      return context[key as keyof ForgeDocumentationContext];
    }
    return `{{${key}}}`;
  });
}

export function inferDocumentationTags(key: string): string[] {
  const tags = ["tool/forge"];
  const lower = key.toLowerCase();

  if (lower.includes("install") || lower.includes("start")) {
    tags.push("topic/onboarding");
  } else if (lower.includes("schema") || lower.includes("lint") || lower.includes("structure")) {
    tags.push("topic/schema");
  } else if (lower.includes("patch") || lower.includes("trouble") || lower.includes("repair")) {
    tags.push("topic/procedure");
  } else {
    tags.push("topic/reference");
  }

  return tags;
}

export function inferDocumentationType(key: string): string {
  const lower = key.toLowerCase();
  if (lower.includes("patch") || lower.includes("example")) return "procedure";
  return "reference";
}
