// src/migration-notice.ts
// Forge — one-time migration notice modal.
//
// Shown once to users upgrading from a version that pre-dates
// lastInstalledVersion tracking (i.e. 0.9.5 and earlier).
// Never shown to fresh installs or users who have already dismissed it.
//
// The upgrade guide is bundled from the repo root at build time.
// It is not included in the general docs installer — this modal
// is the only way it gets written to the vault.

import { App, Modal, Notice, TFile, normalizePath } from "obsidian";
import type { ForgeSettings } from "./settings";
import { ensureFolder, todayString } from "./utils/files";
import guideContent from "../Upgrading from 0.9.5 to 1.0.0.md";

export class MigrationNoticeModal extends Modal {
  private settings: ForgeSettings;
  private onDismiss: () => void;

  constructor(app: App, settings: ForgeSettings, onDismiss: () => void) {
    super(app);
    this.settings = settings;
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
      text: "See the upgrade guide for the full migration steps and a complete before/after example.",
    });

    const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });

    const openGuide = buttonRow.createEl("button", {
      text: "Open upgrade guide",
      cls: "mod-cta",
    });
    openGuide.addEventListener("click", () => {
      this.installAndOpenGuide().catch((e) => {
        console.error("[Forge] Failed to open upgrade guide:", e);
        new Notice("Forge: Could not open upgrade guide.", 4000);
      });
      this.close();
    });

    const dismiss = buttonRow.createEl("button", { text: "Dismiss" });
    dismiss.addEventListener("click", () => {
      this.close();
    });
  }

  onClose(): void {
    this.onDismiss();
    this.contentEl.empty();
  }

  // ── Guide install + open ────────────────────────────────────────────────────

  private guidePath(): string {
    return normalizePath(
      `${this.settings.forgeFolder}/Upgrading from 0.9.5 to 1.0.0.md`
    );
  }

  private async installAndOpenGuide(): Promise<void> {
    const path = this.guidePath();
    let file = this.app.vault.getAbstractFileByPath(path);

    if (!(file instanceof TFile)) {
      await this.writeGuide(path);
      file = this.app.vault.getAbstractFileByPath(path);
    }

    if (file instanceof TFile) {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
    }
  }

  private async writeGuide(path: string): Promise<void> {
    const folder = path.substring(0, path.lastIndexOf("/"));
    await ensureFolder(this.app, folder);

    const today = todayString();
    const frontmatter = [
      "---",
      "type: reference",
      "status: active",
      "tags:",
      "  - tool/forge",
      "  - topic/onboarding",
      `created: ${today}`,
      `updated: ${today}`,
      "review_cycle: never",
      "---",
      "",
    ].join("\n");

    await this.app.vault.create(path, frontmatter + guideContent.trim() + "\n");
  }
}
