import { App, Notice, TAbstractFile, TFile, normalizePath } from "obsidian";
import type ForgePlugin from "./main";
import type { ForgeSettings } from "./settings";
import { getMarkdownFiles } from "./utils/files";

const START_MARKER = "<!-- FORGE-DV-EXPANSION:START -->";
const END_MARKER = "<!-- FORGE-DV-EXPANSION:END -->";
const DEFAULT_DEBOUNCE_MS = 600;

type DataviewApiResult<T> = {
  successful: boolean;
  value: T;
  error?: string;
};

type DataviewQueryResult =
  | { type: "list"; values: unknown[] }
  | { type: "table"; values: unknown[][] }
  | { type: "task"; values: unknown }
  | { type: "calendar"; values: unknown };

type DataviewPluginApi = {
  query(source: string, originFile?: string): Promise<DataviewApiResult<DataviewQueryResult>>;
};

type DataviewLink = {
  path: string;
  subpath?: string;
  display?: string;
  embed?: boolean;
  type?: string;
};

type LinkGenerationPreferences = {
  newLinkFormat: "shortest" | "relative" | "absolute";
  useMarkdownLinks: boolean;
};

type RefreshResult = {
  changed: boolean;
  removed: boolean;
  links: number;
  queries: number;
};

export class DataviewExpansionService {
  private settings: ForgeSettings;
  private pendingTimers = new Map<string, number>();
  private ignoredModifyCounts = new Map<string, number>();
  private inFlight = new Set<string>();
  private lastOpenedFilePath: string | null = null;

  constructor(private app: App, private plugin: ForgePlugin, settings: ForgeSettings) {
    this.settings = settings;
  }

  updateSettings(settings: ForgeSettings): void {
    this.settings = settings;
  }

  isDataviewAvailable(): boolean {
    return this.getDataviewApi() != null;
  }

  onFileModified(file: TAbstractFile): void {
    if (!(file instanceof TFile) || file.extension !== "md") return;
    if (!this.settings.dataviewExpansionEnabled || this.settings.dataviewExpansionAutoUpdateMode === "off") return;

    const ignored = this.ignoredModifyCounts.get(file.path) ?? 0;
    if (ignored > 0) {
      if (ignored === 1) this.ignoredModifyCounts.delete(file.path);
      else this.ignoredModifyCounts.set(file.path, ignored - 1);
      return;
    }

    this.scheduleRefresh(file, 5_000);
  }

  onFileOpened(file: TFile | null): void {
    if (!this.settings.dataviewExpansionEnabled || this.settings.dataviewExpansionAutoUpdateMode === "off") {
      this.lastOpenedFilePath = file?.path ?? null;
      return;
    }

    const previousPath = this.lastOpenedFilePath;
    this.lastOpenedFilePath = file?.path ?? null;

    if (!previousPath || previousPath === this.lastOpenedFilePath) return;

    const previous = this.app.vault.getAbstractFileByPath(previousPath);
    if (previous instanceof TFile && previous.extension === "md") {
      this.scheduleRefresh(previous, 0);
    }
  }

  scheduleRefresh(file: TFile, delayMs = DEFAULT_DEBOUNCE_MS): void {
    if (!this.settings.dataviewExpansionEnabled) return;

    const existing = this.pendingTimers.get(file.path);
    if (existing != null) window.clearTimeout(existing);

    const timer = window.setTimeout(() => {
      this.pendingTimers.delete(file.path);
      void this.refreshFile(file).catch((error: unknown) => {
        console.error("[Forge] dataview expansion refresh error:", error);
      });
    }, delayMs);

    this.pendingTimers.set(file.path, timer);
  }

  async refreshActiveFile(showNotice = true): Promise<void> {
    if (!this.isDataviewAvailable()) {
      if (showNotice) new Notice("Forge: Dataview must be installed and enabled to use Dataview Expansion.", 5000);
      return;
    }

    const file = this.getContextFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      if (showNotice) new Notice("Forge: Open a Markdown note first.", 4000);
      return;
    }

    const result = await this.refreshFile(file);
    if (!showNotice) return;

    if (result.removed) {
      new Notice("Forge: Removed Dataview Expansion block.", 4000);
      return;
    }

    if (result.changed) {
      new Notice(
        `Forge: Dataview Expansion refreshed from ${result.queries} quer${result.queries === 1 ? "y" : "ies"} with ${result.links} link${result.links === 1 ? "" : "s"}.`,
        5000
      );
      return;
    }

    new Notice("Forge: Dataview Expansion already up to date.", 4000);
  }

  async refreshCurrentFolder(showNotice = true): Promise<void> {
    if (!this.isDataviewAvailable()) {
      if (showNotice) new Notice("Forge: Dataview must be installed and enabled to use Dataview Expansion.", 5000);
      return;
    }

    const file = this.getContextFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      if (showNotice) new Notice("Forge: Open a Markdown note first.", 4000);
      return;
    }

    const folderPath = normalizeFolderPath(file.parent?.path);
    const candidates = getMarkdownFiles(this.app, folderPath).filter((candidate) => candidate.extension === "md");
    const startedAt = Date.now();

    let scanned = 0;
    let changed = 0;
    let removed = 0;
    let skippedWithoutQueries = 0;
    let totalLinks = 0;

    for (const candidate of candidates) {
      scanned++;
      const result = await this.refreshFile(candidate);
      totalLinks += result.links;
      if (result.changed) changed++;
      if (result.removed) removed++;
      if (result.queries === 0) skippedWithoutQueries++;
    }

    if (!showNotice) return;

    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    const folderLabel = folderPath || "vault root";
    new Notice(
      `Forge: Dataview Expansion refreshed in ${folderLabel} — scanned ${scanned} note(s), updated ${changed}, removed ${removed}, skipped ${skippedWithoutQueries} without queries, in ${elapsedSeconds}s.`,
      8000
    );
  }

  private async refreshFile(file: TFile): Promise<RefreshResult> {
    if (this.inFlight.has(file.path)) {
      return { changed: false, removed: false, links: 0, queries: 0 };
    }

    this.inFlight.add(file.path);
    try {
      const raw = await this.app.vault.read(file);
      const queries = extractDataviewQueries(raw);
      const hadBlock = hasExistingExpansionBlock(raw);

      if (queries.length === 0) {
        if (!hadBlock) return { changed: false, removed: false, links: 0, queries: 0 };
        const stripped = stripExistingExpansionBlock(raw);
        if (stripped === raw) return { changed: false, removed: false, links: 0, queries: 0 };
        await this.writeExpandedContent(file, stripped);
        return { changed: true, removed: true, links: 0, queries: 0 };
      }

      const api = this.getDataviewApi();
      if (!api) return { changed: false, removed: false, links: 0, queries: queries.length };

      const linkPreferences = await this.loadLinkGenerationPreferences();
      const targets = new Map<string, string>();
      for (const query of queries) {
        const result = await api.query(query, file.path);
        if (!result.successful) continue;
        collectLinksFromQueryResult(this.app, file, result.value, targets, linkPreferences);
      }

      const limit = Math.max(0, Math.floor(this.settings.dataviewExpansionMaxLinks));
      const links = Array.from(targets.values()).sort((a, b) => a.localeCompare(b));
      const limitedLinks = limit > 0 ? links.slice(0, limit) : links;
      const updated = rewriteWithExpansionBlock(raw, this.settings.dataviewExpansionTitle, limitedLinks);

      if (updated === raw) {
        return { changed: false, removed: false, links: limitedLinks.length, queries: queries.length };
      }

      await this.writeExpandedContent(file, updated);
      return { changed: true, removed: false, links: limitedLinks.length, queries: queries.length };
    } finally {
      this.inFlight.delete(file.path);
    }
  }

  private async writeExpandedContent(file: TFile, content: string): Promise<void> {
    this.ignoredModifyCounts.set(file.path, (this.ignoredModifyCounts.get(file.path) ?? 0) + 1);
    await this.app.vault.modify(file, content);
  }

  private getDataviewApi(): DataviewPluginApi | null {
    const plugins = (this.app as App & { plugins?: { plugins?: Record<string, { api?: unknown }> } }).plugins;
    const api = plugins?.plugins?.dataview?.api;
    if (!api || typeof (api as DataviewPluginApi).query !== "function") return null;
    return api as DataviewPluginApi;
  }

  private async loadLinkGenerationPreferences(): Promise<LinkGenerationPreferences> {
    const defaults: LinkGenerationPreferences = {
      newLinkFormat: "shortest",
      useMarkdownLinks: false,
    };

    try {
      const raw = await this.app.vault.adapter.read(normalizePath(`${this.app.vault.configDir}/app.json`));
      const parsed = JSON.parse(raw) as Partial<LinkGenerationPreferences>;
      const newLinkFormat = parsed.newLinkFormat;
      const useMarkdownLinks = parsed.useMarkdownLinks;

      return {
        newLinkFormat:
          newLinkFormat === "relative" || newLinkFormat === "absolute" || newLinkFormat === "shortest"
            ? newLinkFormat
            : defaults.newLinkFormat,
        useMarkdownLinks: typeof useMarkdownLinks === "boolean" ? useMarkdownLinks : defaults.useMarkdownLinks,
      };
    } catch {
      return defaults;
    }
  }

  private getContextFile(): TFile | null {
    const editorFile = this.app.workspace.activeEditor?.file;
    if (editorFile instanceof TFile && editorFile.extension === "md") {
      return editorFile;
    }

    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile instanceof TFile && activeFile.extension === "md") {
      return activeFile;
    }

    const recentLeaf = this.app.workspace.getMostRecentLeaf();
    const recentFile = (recentLeaf?.view as { file?: TFile | null } | undefined)?.file;
    return recentFile instanceof TFile && recentFile.extension === "md" ? recentFile : null;
  }
}

function extractDataviewQueries(content: string): string[] {
  const lines = content.split("\n");
  const queries: string[] = [];
  let active:
    | { fence: string; quotePrefix: string; body: string[] }
    | null = null;

  for (const line of lines) {
    if (!active) {
      const startMatch = /^(\s*(?:>\s*)*)(`{3,}|~{3,})dataview\s*$/i.exec(line);
      if (!startMatch) continue;

      active = {
        quotePrefix: startMatch[1] ?? "",
        fence: startMatch[2],
        body: [],
      };
      continue;
    }

    const closingPattern = new RegExp(`^${escapeRegExp(active.quotePrefix)}${escapeRegExp(active.fence)}\\s*$`);
    if (closingPattern.test(line)) {
      const query = active.body.join("\n").trim();
      if (query) queries.push(query);
      active = null;
      continue;
    }

    active.body.push(stripQuotePrefix(line, active.quotePrefix));
  }

  return queries;
}

function stripQuotePrefix(line: string, prefix: string): string {
  if (!prefix) return line;
  if (line.startsWith(prefix)) return line.slice(prefix.length);

  const trimmedPrefix = prefix.trimEnd();
  if (trimmedPrefix && line === trimmedPrefix) return "";
  return line;
}

function collectLinksFromQueryResult(
  app: App,
  originFile: TFile,
  result: DataviewQueryResult,
  targets: Map<string, string>,
  linkPreferences: LinkGenerationPreferences
): void {
  switch (result.type) {
    case "list":
      for (const item of result.values) collectLinksFromValue(app, originFile, item, targets, linkPreferences, new Set<object>());
      break;
    case "table":
      for (const row of result.values) {
        for (const cell of row) collectLinksFromValue(app, originFile, cell, targets, linkPreferences, new Set<object>());
      }
      break;
    case "task":
    case "calendar":
      collectLinksFromValue(app, originFile, result.values, targets, linkPreferences, new Set<object>());
      break;
  }
}

function collectLinksFromValue(
  app: App,
  originFile: TFile,
  value: unknown,
  targets: Map<string, string>,
  linkPreferences: LinkGenerationPreferences,
  seen: Set<object>
): void {
  if (value == null) return;

  if (Array.isArray(value)) {
    for (const item of value) collectLinksFromValue(app, originFile, item, targets, linkPreferences, seen);
    return;
  }

  if (typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (looksLikeDataviewLink(value)) {
    addResolvedLink(app, originFile, value, targets, linkPreferences);
    return;
  }

  if (looksLikeDataviewFile(value)) {
    addResolvedPath(app, originFile, value.path, undefined, targets, linkPreferences);
  }

  for (const nested of Object.values(value)) {
    collectLinksFromValue(app, originFile, nested, targets, linkPreferences, seen);
  }
}

function looksLikeDataviewLink(value: object): value is DataviewLink {
  const candidate = value as Partial<DataviewLink>;
  if (typeof candidate.path !== "string" || candidate.path.length === 0) return false;
  return typeof candidate.embed === "boolean"
    || typeof candidate.display === "string"
    || typeof candidate.subpath === "string"
    || typeof candidate.type === "string";
}

function looksLikeDataviewFile(value: object): value is { path: string; name: string; folder: string; ext: string } {
  const candidate = value as Partial<{ path: string; name: string; folder: string; ext: string }>;
  return typeof candidate.path === "string"
    && typeof candidate.name === "string"
    && typeof candidate.folder === "string"
    && typeof candidate.ext === "string";
}

function addResolvedLink(
  app: App,
  originFile: TFile,
  link: DataviewLink,
  targets: Map<string, string>,
  linkPreferences: LinkGenerationPreferences
): void {
  addResolvedPath(app, originFile, link.path, normalizeSubpath(link.subpath), targets, linkPreferences);
}

function addResolvedPath(
  app: App,
  originFile: TFile,
  rawPath: string,
  subpath: string | undefined,
  targets: Map<string, string>,
  linkPreferences: LinkGenerationPreferences
): void {
  const file = app.metadataCache.getFirstLinkpathDest(rawPath, originFile.path)
    ?? resolveMarkdownFile(app, rawPath);

  if (!(file instanceof TFile) || file.extension !== "md") return;
  if (file.path === originFile.path) return;

  const linkText = buildPreferredNoteLink(app, originFile, file, subpath, linkPreferences);
  const key = `${file.path}::${subpath ?? ""}`;
  targets.set(key, linkText);
}

function resolveMarkdownFile(app: App, path: string): TFile | null {
  const exact = app.vault.getAbstractFileByPath(path);
  if (exact instanceof TFile && exact.extension === "md") return exact;

  const withExtension = path.endsWith(".md") ? path : `${path}.md`;
  const appended = app.vault.getAbstractFileByPath(withExtension);
  return appended instanceof TFile && appended.extension === "md" ? appended : null;
}

function normalizeSubpath(subpath: string | undefined): string | undefined {
  if (!subpath) return undefined;
  if (subpath.startsWith("#") || subpath.startsWith("^")) return subpath;
  return `#${subpath}`;
}

function buildPreferredNoteLink(
  app: App,
  originFile: TFile,
  targetFile: TFile,
  subpath: string | undefined,
  preferences: LinkGenerationPreferences
): string {
  const linktext = buildPreferredLinktext(app, originFile, targetFile, subpath, preferences);
  if (!preferences.useMarkdownLinks) {
    return `[[${linktext}]]`;
  }

  const destination = buildMarkdownDestination(app, originFile, targetFile, subpath, preferences);
  return `[${targetFile.basename}](${wrapMarkdownDestination(destination)})`;
}

function buildPreferredLinktext(
  app: App,
  originFile: TFile,
  targetFile: TFile,
  subpath: string | undefined,
  preferences: LinkGenerationPreferences
): string {
  const base = (() => {
    switch (preferences.newLinkFormat) {
      case "absolute":
        return targetFile.path.replace(/\.md$/i, "");
      case "relative":
        return relativeLinkPath(originFile.path, targetFile.path, true);
      case "shortest":
      default:
        return app.metadataCache.fileToLinktext(targetFile, originFile.path, true);
    }
  })();

  return `${base}${subpath ?? ""}`;
}

function buildMarkdownDestination(
  app: App,
  originFile: TFile,
  targetFile: TFile,
  subpath: string | undefined,
  preferences: LinkGenerationPreferences
): string {
  const base = (() => {
    switch (preferences.newLinkFormat) {
      case "absolute":
        return targetFile.path;
      case "relative":
        return relativeLinkPath(originFile.path, targetFile.path, false);
      case "shortest":
      default:
        return app.metadataCache.fileToLinktext(targetFile, originFile.path, false);
    }
  })();

  return `${base}${subpath ?? ""}`;
}

function relativeLinkPath(sourceFilePath: string, targetFilePath: string, omitMdExtension: boolean): string {
  const sourceParts = normalizePath(sourceFilePath).split("/");
  sourceParts.pop();

  const targetParts = normalizePath(targetFilePath).split("/");
  const targetFileName = targetParts.pop() ?? "";

  let shared = 0;
  while (
    shared < sourceParts.length
    && shared < targetParts.length
    && sourceParts[shared] === targetParts[shared]
  ) {
    shared++;
  }

  const upSegments = new Array(sourceParts.length - shared).fill("..");
  const downSegments = targetParts.slice(shared);
  const fileName = omitMdExtension ? targetFileName.replace(/\.md$/i, "") : targetFileName;
  const combined = [...upSegments, ...downSegments, fileName].filter(Boolean);
  return combined.length > 0 ? combined.join("/") : fileName;
}

function wrapMarkdownDestination(destination: string): string {
  return /[\s()]/.test(destination) ? `<${destination}>` : destination;
}

function normalizeFolderPath(path: string | undefined): string {
  if (!path || path === "/" || path === ".") return "";
  return path;
}

function hasExistingExpansionBlock(content: string): boolean {
  return content.includes(START_MARKER) && content.includes(END_MARKER);
}

function rewriteWithExpansionBlock(content: string, title: string, links: string[]): string {
  const stripped = stripExistingExpansionBlock(content);
  if (links.length === 0) return stripped;

  const block = buildExpansionBlock(title, links);
  const trimmed = stripped.replace(/\s+$/u, "");
  if (!trimmed) return `${block}\n`;
  return `${trimmed}\n\n${block}\n`;
}

function stripExistingExpansionBlock(content: string): string {
  const lines = content.split("\n");
  let start = -1;
  let end = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(START_MARKER)) {
      start = i;
    }
    if (start !== -1 && lines[i].includes(END_MARKER)) {
      end = i;
      break;
    }
  }

  if (start === -1 || end === -1 || end < start) return content;

  let blockStart = start;
  if (blockStart > 0 && /^>\s*\[!info\]-\s*/.test(lines[blockStart - 1])) {
    blockStart -= 1;
  }

  if (blockStart > 0 && lines[blockStart - 1].trim() === "") {
    blockStart -= 1;
  }

  const nextIndex = end + 1;
  const kept = [...lines.slice(0, blockStart), ...lines.slice(nextIndex)];
  return kept.join("\n").replace(/\s+$/u, "");
}

function buildExpansionBlock(title: string, links: string[]): string {
  const safeTitle = title.trim() || "Dataview Expansion";
  return [
    `> [!info]- ${safeTitle}`,
    `> ${START_MARKER}`,
    ...links.map((link) => `> ${link}`),
    `> ${END_MARKER}`,
  ].join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
