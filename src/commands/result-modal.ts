import type { LintResult, LintSeverity } from "../lint-engine";

export type ResultSeverityFilter = "all" | LintSeverity;

export interface ResultModalSection {
  severity: LintSeverity;
  label: string;
  items: LintResult[];
}

export interface ResultSummaryItem {
  label: string;
  value: string | number;
  tone?: "critical" | "warning" | "info" | "review" | "good" | "muted";
}

interface GroupedResultReason {
  label: string;
  files: string[];
}

interface GroupedResultItem {
  rule: string;
  summary: string;
  reasons: GroupedResultReason[];
  count: number;
  fileCount: number;
}

export function defaultResultFilter(sections: ResultModalSection[]): ResultSeverityFilter {
  return sections.find((section) => section.items.length > 0)?.severity ?? "all";
}

export function resultItemsForFilter(
  sections: ResultModalSection[],
  filter: ResultSeverityFilter
): LintResult[] {
  if (filter === "all") {
    const items: LintResult[] = [];
    for (const section of sections) {
      items.push(...section.items);
    }
    return items;
  }
  return sections.find((section) => section.severity === filter)?.items ?? [];
}

export function firstResultItem(
  sections: ResultModalSection[],
  filter: ResultSeverityFilter
): LintResult | null {
  return resultItemsForFilter(sections, filter)[0] ?? resultItemsForFilter(sections, "all")[0] ?? null;
}

export function renderResultSummaryGrid(container: HTMLElement, items: ResultSummaryItem[]): void {
  const grid = container.createDiv("forge-results-summary-grid");
  for (const item of items) {
    const card = grid.createDiv({
      cls: "forge-results-summary-card",
      attr: item.tone ? { "data-tone": item.tone } : undefined,
    });
    card.createDiv({ text: String(item.value), cls: "forge-results-summary-value" });
    card.createDiv({ text: item.label, cls: "forge-results-summary-label" });
  }
}

export function renderSeverityFilters(
  container: HTMLElement,
  sections: ResultModalSection[],
  activeFilter: ResultSeverityFilter,
  onSelect: (filter: ResultSeverityFilter) => void
): void {
  const total = sections.reduce((sum, section) => sum + section.items.length, 0);
  const filters = [
    { filter: "all" as const, label: "All", count: total },
    ...sections.map((section) => ({
      filter: section.severity,
      label: section.label,
      count: section.items.length,
    })),
  ];

  const row = container.createDiv("forge-results-filter-row");
  for (const filter of filters) {
    const button = row.createEl("button", {
      text: `${filter.label} ${filter.count}`,
      cls: filter.filter === activeFilter ? "forge-results-filter is-active" : "forge-results-filter",
    });
    button.setAttr("aria-pressed", filter.filter === activeFilter ? "true" : "false");
    button.disabled = filter.count === 0 && filter.filter !== "all";
    button.addEventListener("click", () => onSelect(filter.filter));
  }
}

export function renderGroupedResults(
  container: HTMLElement,
  items: LintResult[],
  options: {
    emptyText: string;
    openFile: (filePath: string) => void;
  }
): void {
  if (items.length === 0) {
    container.createDiv({ text: options.emptyText, cls: "forge-results-empty" });
    return;
  }

  const groups = groupResultItems(items);
  const list = container.createDiv("forge-results-group-list");
  for (const group of groups) {
    const card = list.createDiv("forge-results-group");
    const header = card.createDiv("forge-results-group-header");
    header.createDiv({ text: group.rule, cls: "forge-results-rule" });
    header.createDiv({
      text: `${group.count} item${group.count === 1 ? "" : "s"} across ${group.fileCount} file${group.fileCount === 1 ? "" : "s"}`,
      cls: "forge-results-count",
    });
    card.createDiv({ text: group.summary, cls: "forge-results-message" });

    for (const reason of group.reasons.slice(0, 6)) {
      const reasonEl = card.createDiv("forge-results-reason");
      reasonEl.createDiv({ text: reason.label, cls: "forge-results-reason-label" });
      const files = reasonEl.createEl("ul", { cls: "forge-results-file-list" });
      for (const file of reason.files.slice(0, 8)) {
        const item = files.createEl("li");
        const openButton = item.createEl("button", {
          text: file,
          cls: "forge-results-file-button",
        });
        openButton.addEventListener("click", () => options.openFile(file));
      }
      if (reason.files.length > 8) {
        files.createEl("li", {
          text: `and ${reason.files.length - 8} more`,
          cls: "forge-results-more",
        });
      }
    }

    if (group.reasons.length > 6) {
      card.createDiv({
        text: `${group.reasons.length - 6} more grouped reason${group.reasons.length - 6 === 1 ? "" : "s"}`,
        cls: "forge-results-more",
      });
    }
  }
}

function groupResultItems(items: LintResult[]): GroupedResultItem[] {
  const groups = new Map<string, GroupedResultItem>();
  const reasons = new Map<string, GroupedResultReason>();
  const seenReasonFiles = new Set<string>();

  for (const item of items) {
    const summary = summarizeLintMessage(item.rule, item.message);
    const reasonLabel = extractLintReason(item.rule, item.message);
    const groupKey = `${item.rule}::${summary}`;
    const reasonKey = `${groupKey}::${reasonLabel}`;
    const reasonFileKey = `${reasonKey}::${item.file}`;

    let group = groups.get(groupKey);
    if (!group) {
      group = {
        rule: item.rule,
        summary,
        reasons: [],
        count: 0,
        fileCount: 0,
      };
      groups.set(groupKey, group);
    }

    group.count += 1;

    let reason = reasons.get(reasonKey);
    if (!reason) {
      reason = { label: reasonLabel, files: [] };
      reasons.set(reasonKey, reason);
      group.reasons.push(reason);
    }

    if (!seenReasonFiles.has(reasonFileKey)) {
      seenReasonFiles.add(reasonFileKey);
      reason.files.push(item.file);
      group.fileCount = uniqueFileCount(group);
    }
  }

  return [...groups.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.rule.localeCompare(b.rule);
  });
}

function uniqueFileCount(group: GroupedResultItem): number {
  const files = new Set<string>();
  for (const reason of group.reasons) {
    for (const file of reason.files) files.add(file);
  }
  return files.size;
}

function summarizeLintMessage(rule: string, message: string): string {
  if (rule === "inline_undocumented") {
    return "Inline keys are undocumented. Consider adding them to inline.allowed in schema.md.";
  }

  if (rule === "tag_namespace") {
    return "Tags are not namespaced. Expected format: namespace/tag.";
  }

  return message;
}

function extractLintReason(rule: string, message: string): string {
  if (rule === "inline_undocumented") {
    const match = message.match(/Inline key '([^']+)'/);
    return match ? `'${match[1]}'` : message;
  }

  if (rule === "tag_namespace") {
    const match = message.match(/Tag '([^']+)'/);
    return match ? `'${match[1]}'` : message;
  }

  return message;
}
