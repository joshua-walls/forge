export type PreviewItemStatus =
  | "applyable"
  | "skipped"
  | "error"
  | "unsupported"
  | "already_current"
  | "conflicted";

export type PreviewRiskLevel = "low" | "medium" | "high";

export type PreviewDiffKind =
  | "frontmatter_field"
  | "frontmatter_tags"
  | "frontmatter_order"
  | "template_text"
  | "file_create"
  | "file_delete"
  | "file_move"
  | "full_note_text"
  | "none";

export type PreviewSource =
  | "dashboard"
  | "command_palette"
  | "settings_tab"
  | "modal_followup";

export interface PreviewRun {
  run_id: string;
  contract_revision: "1.4.0-r4.2";
  command: string;
  source: PreviewSource;
  title: string;
  generated_at: number;
  dry_run: true;
  summary: PreviewSummary;
  items: PreviewItem[];
  warnings: string[];
  errors: string[];
}

export interface PreviewSummary {
  total_items: number;
  applyable_items: number;
  selected_items: number;
  skipped_items: number;
  error_items: number;
  affected_files: number;
  destructive_items: number;
  high_risk_items: number;
}

export interface PreviewItem {
  id: string;
  command: string;
  operation: string;
  target: string;
  file: string;
  status: PreviewItemStatus;
  detail: string;
  before: PreviewBefore | null;
  after: string | null;
  diff_kind: PreviewDiffKind;
  selectable: boolean;
  selected_by_default: boolean;
  risk: PreviewRiskLevel;
  metadata: Record<string, unknown>;
  requires_previous_operation: boolean;
  depends_on_item_ids: string[];
}

export interface PreviewBefore {
  diff_kind: PreviewDiffKind;
  value: string;
  captured_at: number;
}

export function isApplyablePreviewRun(run: PreviewRun): boolean {
  return run.dry_run === true;
}
