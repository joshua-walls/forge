// src/config/migration-notice.ts
// Forge — one-time migration notice modal.
//
// Shown once to users upgrading from a version that pre-dates
// lastInstalledVersion tracking (i.e. 0.9.5 and earlier).
// Never shown to fresh installs or users who have already dismissed it.
//
import { App, Modal } from "obsidian";
import type { ForgeSettings } from "./settings";

export class MigrationNoticeModal extends Modal {
  private onDismiss: () => void;

  constructor(app: App, _settings: ForgeSettings, onDismiss: () => void) {
    super(app);
    this.onDismiss = onDismiss;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Forge 1.0.0 — Schema Migration Required" });

    contentEl.createEl("p", {
      text: "Forge 1.0.0 introduces a new schema contract structure. Your existing schema.md must be updated before running Vault Lint or Validate Schema.",
    });

    contentEl.createEl("p", {
      text: "The schema structure has changed as follows:",
    });

    const list = contentEl.createEl("ul");
    const items = [
      "required_fields  →  frontmatter.required",
      "optional_fields  →  frontmatter.optional",
      "inline_fields    →  inline.allowed  (entries are now objects with a name key)",
      "meta             →  removed",
      "domain_model     →  removed",
    ];
    for (const item of items) {
      list.createEl("li", { text: item });
    }

    contentEl.createEl("p", {
      text: "If you use stale review, add values_meta to your review_cycle field to declare day counts — the internal hardcoded map has been removed.",
    });

    contentEl.createEl("p", {
      text: "Review your schema before running Validate Schema or Vault Lint.",
    });

    const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });

    const dismiss = buttonRow.createEl("button", {
      text: "Dismiss",
      cls: "mod-cta",
    });
    dismiss.addEventListener("click", () => {
      this.close();
    });
  }

  onClose(): void {
    this.onDismiss();
    this.contentEl.empty();
  }
}
