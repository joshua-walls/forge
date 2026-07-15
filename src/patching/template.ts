import { todayString } from "../vault/paths.js";

export interface PatchTemplateOptions {
  date?: string;
  description?: string;
}

export function createPatchTemplateContent(options: PatchTemplateOptions = {}): string {
  const today = options.date ?? todayString();
  const description = options.description ?? "Manual vault patch";

  return [
    "---",
    "type: procedure",
    "status: draft",
    "tags:",
    "  - tool/forge",
    `created: ${today}`,
    `updated: ${today}`,
    "ai_private: false",
    "review_cycle: never",
    "---",
    "",
    "# Vault Patch",
    "",
    "Patch file for Forge.",
    "",
    "## Patch",
    "",
    "```yaml",
    "meta:",
    `  description: ${description}`,
    "",
    "operations: []",
    "```",
    "",
  ].join("\n");
}
