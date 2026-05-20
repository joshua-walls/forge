// src/settings-tab.ts
// Settings UI for Forge — tabbed layout.
//
// Tabs: General | Lint | Patch | Maintenance | Export | Shapes
//
// Tab state is in-memory only (not persisted) — resets to General on reopen,
// which is standard Obsidian plugin behaviour.

import {
  App,
  FuzzySuggestModal,
  Notice,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
  TFolder,
} from "obsidian";
import type ForgePlugin from "./main";
import { runExportOverview } from "./commands/export-overview";
import { runExportOntology } from "./commands/export-ontology";
import { installVaultForgeDocumentation } from "./docs";
import { loadSchema } from "./utils/schema";

type TabId = "general" | "lint" | "patch" | "maintenance" | "export" | "shapes";

const TABS: { id: TabId; label: string }[] = [
  { id: "general",     label: "General"     },
  { id: "lint",        label: "Lint"        },
  { id: "patch",       label: "Patch"       },
  { id: "maintenance", label: "Maintenance" },
  { id: "export",      label: "Export"      },
  { id: "shapes",    label: "Shapes"    },
];

export class ForgeSettingsTab extends PluginSettingTab {
  plugin: ForgePlugin;
  private activeTab: TabId = "general";

  constructor(app: App, plugin: ForgePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.injectStyles();

    // ── Tab bar ──────────────────────────────────────────────────────
    const tabBar = containerEl.createDiv({ cls: "forge-tab-bar" });

    TABS.forEach(({ id, label }) => {
      const btn = tabBar.createEl("button", {
        text: label,
        cls: ["forge-tab-btn", id === this.activeTab ? "is-active" : ""],
      });
      btn.addEventListener("click", () => {
        this.activeTab = id;
        this.display();
      });
    });

    // ── Tab content ──────────────────────────────────────────────────
    const content = containerEl.createDiv({ cls: "forge-tab-content" });

    switch (this.activeTab) {
      case "general":     this.renderGeneral(content);     break;
      case "lint":        this.renderLint(content);        break;
      case "patch":       this.renderPatch(content);       break;
      case "maintenance": this.renderMaintenance(content); break;
      case "export":      this.renderExport(content);      break;
      case "shapes":    this.renderShapes(content);    break;
    }
  }

  // ── General ──────────────────────────────────────────────────────────────

  private renderGeneral(el: HTMLElement): void {
    new Setting(el)
      .setName("Install Documentation")
      .setDesc(
        "Writes vault-native docs into your Forge folder — command reference, " +
        "schema guide, patch examples, and troubleshooting. Skips notes that already exist."
      )
      .addButton((btn) =>
        btn.setButtonText("Install Docs").setCta().onClick(async () => {
          await installVaultForgeDocumentation(this.plugin.app, this.plugin.settings);
        })
      );

    el.createEl("h3", { text: "System Paths" });
    el.createEl("p", {
      text: "All paths are relative to your vault root.",
      cls: "setting-item-description",
    });

    this.renderFolderPicker(
      el,
      "System folder",
      "Root folder for all vault system files.",
      "systemFolder",
      "System"
    );

    this.renderFolderPicker(
      el,
      "Forge folder",
      "Folder for Forge configuration and patch archives.",
      "forgeFolder",
      "System/Forge"
    );

    this.renderFrontmatterFieldOrder(el);
  }

  // ── Frontmatter field order ───────────────────────────────────────────────

  private renderFrontmatterFieldOrder(el: HTMLElement): void {
    el.createEl("h3", { text: "Frontmatter Field Order" });
    el.createEl("p", {
      text: "Fields are written in this order when Forge modifies a note. " +
            "Fields not listed here are appended alphabetically. " +
            "Use 'Prefill from schema' to seed this list from your schema.md, " +
            "or add fields manually. Drag to reorder, \u00d7 to remove.",
      cls: "setting-item-description",
    });

    const listEl = el.createDiv({ cls: "forge-field-order-list" });

    const save = async () => {
      const items = Array.from(listEl.querySelectorAll<HTMLElement>(".forge-field-order-item"));
      this.plugin.settings.frontmatterFieldOrder = items.map(
        (item) => item.dataset.field ?? ""
      ).filter(Boolean);
      await this.plugin.saveSettings();
    };

    const renderItem = (field: string) => {
      const item = listEl.createDiv({ cls: "forge-field-order-item", attr: { draggable: "true", "data-field": field } });

      const handle = item.createSpan({ cls: "forge-field-order-handle", text: "⠿" });
      handle.title = "Drag to reorder";

      item.createSpan({ cls: "forge-field-order-name", text: field });

      const rm = item.createSpan({ cls: "forge-field-order-rm", text: "×" });
      rm.title = "Remove";
      rm.addEventListener("click", async () => {
        item.remove();
        await save();
      });

      // Drag-and-drop handlers
      item.addEventListener("dragstart", (e) => {
        item.classList.add("forge-field-order-dragging");
        e.dataTransfer?.setData("text/plain", field);
      });

      item.addEventListener("dragend", async () => {
        item.classList.remove("forge-field-order-dragging");
        await save();
      });

      item.addEventListener("dragover", (e) => {
        e.preventDefault();
        const dragging = listEl.querySelector<HTMLElement>(".forge-field-order-dragging");
        if (!dragging || dragging === item) return;
        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          listEl.insertBefore(dragging, item);
        } else {
          listEl.insertBefore(dragging, item.nextSibling);
        }
      });
    };

    // Render current order
    for (const field of this.plugin.settings.frontmatterFieldOrder) {
      renderItem(field);
    }

    // ── Add field row ────────────────────────────────────────────────
    const addRow = el.createDiv({ cls: "forge-field-order-add-row" });

    const input = addRow.createEl("input", {
      type: "text",
      cls: "forge-field-order-input",
      attr: { placeholder: "field_name" },
    });

    const addBtn = addRow.createEl("button", {
      text: "Add",
      cls: "forge-field-order-add-btn",
    });

    const doAdd = async () => {
      const val = input.value.trim().toLowerCase().replace(/\s+/g, "_");
      if (!val) return;
      const existing = this.plugin.settings.frontmatterFieldOrder;
      if (existing.includes(val)) {
        new Notice(`'${val}' is already in the list`);
        return;
      }
      this.plugin.settings.frontmatterFieldOrder = [...existing, val];
      await this.plugin.saveSettings();
      renderItem(val);
      input.value = "";
    };

    addBtn.addEventListener("click", doAdd);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") doAdd(); });

    // ── Prefill from schema ──────────────────────────────────────────
    new Setting(el)
      .setName("Prefill from schema")
      .setDesc(
        "Replace the field order with required + optional fields from schema.md, " +
        "in the order they appear in the schema."
      )
      .addButton((btn) =>
        btn.setButtonText("Prefill").onClick(async () => {
          const schema = await loadSchema(this.plugin.app, this.plugin.settings);
          if (!schema) {
            new Notice("Forge: Could not load schema — is schema.md present?");
            return;
          }
          const schemaFields = [
            ...schema.required_fields.map((f) => f.name),
            ...schema.optional_fields.map((f) => f.name),
          ];
          // Dedupe while preserving order
          const seen = new Set<string>();
          const deduped = schemaFields.filter((f) => {
            if (seen.has(f)) return false;
            seen.add(f);
            return true;
          });
          this.plugin.settings.frontmatterFieldOrder = deduped;
          await this.plugin.saveSettings();
          // Re-render the tab so the list reflects the new order
          this.display();
        })
      );
  }

  // ── Lint ─────────────────────────────────────────────────────────────────

  private renderLint(el: HTMLElement): void {
    this.renderSchemaNotePicker(el);

    this.renderFolderPicker(
      el,
      "Lint reports folder",
      "Folder where lint run reports are written.",
      "lintRunsFolder",
      "System/Exports/LintReports"
    );

    new Setting(el)
      .setName("Strict mode")
      .setDesc("Treat warnings as errors.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.lintStrictMode).onChange(async (v) => {
          this.plugin.settings.lintStrictMode = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(el)
      .setName("Lint run retention")
      .setDesc("Number of lint run notes to keep.")
      .addSlider((s) =>
        s
          .setLimits(5, 100, 5)
          .setValue(this.plugin.settings.lintRunRetentionCount)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.lintRunRetentionCount = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(el)
      .setName("Lint file links")
      .setDesc(
        "Wrap file paths in [[wikilinks]] in lint run notes so you can navigate directly to affected files."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.lintFileLinks).onChange(async (v) => {
          this.plugin.settings.lintFileLinks = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(el)
      .setName("Lint inline metadata")
      .setDesc(
        "Check inline metadata (key:: value patterns) against the schema. Disable to skip all inline metadata rules."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.lintInlineMetadata).onChange(async (v) => {
          this.plugin.settings.lintInlineMetadata = v;
          await this.plugin.saveSettings();
        })
      );

    // ── Stale Note Review ─────────────────────────────────────────────
    el.createEl("h3", { text: "Stale Note Review" });

    new Setting(el)
      .setName("Enable stale note review")
      .setDesc(
        "Flag notes whose review cycle has elapsed, based on frontmatter field values."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.staleReviewEnabled).onChange(async (v) => {
          this.plugin.settings.staleReviewEnabled = v;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    if (!this.plugin.settings.staleReviewEnabled) return;

    const allFields = this.plugin.schemaCache.getFieldNames();

    // Review cycle field — single-select from all schema fields
    this.renderSchemaFieldDropdown(
      el,
      "Review cycle field",
      "The frontmatter field that holds the review cadence. Must be an enum field in your schema with values: daily, weekly, monthly, quarterly, yearly, never.",
      allFields,
      this.plugin.settings.staleReviewCycleField,
      async (v) => {
        this.plugin.settings.staleReviewCycleField = v;
        await this.plugin.saveSettings();
      }
    );

    // Last updated field — single-select from all schema fields
    this.renderSchemaFieldDropdown(
      el,
      "Last updated field",
      "The frontmatter field that holds the last-updated date (e.g. updated).",
      allFields,
      this.plugin.settings.staleReviewUpdatedField,
      async (v) => {
        this.plugin.settings.staleReviewUpdatedField = v;
        await this.plugin.saveSettings();
      }
    );

    // In-scope filter — pick which field to filter on, then pick values
    this.renderSchemaFieldDropdown(
      el,
      "In-scope field",
      "Schema field used to determine which notes are in scope for stale review (e.g. status).",
      allFields,
      this.plugin.settings.staleReviewFilterField,
      async (v) => {
        this.plugin.settings.staleReviewFilterField = v;
        this.plugin.settings.staleReviewStatuses = [];
        await this.plugin.saveSettings();
        this.display();
      }
    );

    if (this.plugin.settings.staleReviewFilterField) {
      const filterValues = this.plugin.schemaCache.getEnumValues(
        this.plugin.settings.staleReviewFilterField
      );

      if (filterValues && filterValues.length > 0) {
        new Setting(el)
          .setName("In-scope values")
          .setDesc(
            `Notes whose '${this.plugin.settings.staleReviewFilterField}' matches one of these values will be evaluated for staleness. Leave empty to skip stale review.`
          );

        this.renderCheckboxGroup(
          el,
          filterValues,
          this.plugin.settings.staleReviewStatuses,
          async (selected) => {
            this.plugin.settings.staleReviewStatuses = selected;
            await this.plugin.saveSettings();
          }
        );
      } else {
        el.createEl("p", {
          text: `'${this.plugin.settings.staleReviewFilterField}' has no defined enum values in schema — choose a different field or add values to your schema.`,
          cls: "setting-item-description",
        });
      }
    }
  }

  // ── Patch ─────────────────────────────────────────────────────────────────

  private renderPatch(el: HTMLElement): void {
    this.renderFolderPicker(
      el,
      "Patches folder",
      "Folder where applied patch files are archived.",
      "patchesFolder",
      "System/Forge/Patches"
    );

    this.renderFolderPicker(
      el,
      "Inbox folder",
      "Folder for draft notes awaiting processing.",
      "inboxFolder",
      "System/Inbox"
    );

    this.renderPatchFilePicker(el);

    new Setting(el)
      .setName("Backup before patch")
      .setDesc("Create a backup of each modified file before applying a patch.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.patchBackupEnabled).onChange(async (v) => {
          this.plugin.settings.patchBackupEnabled = v;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    if (this.plugin.settings.patchBackupEnabled) {
      const backupCurrent = this.plugin.settings.patchBackupFolder || "System/Forge/Patches/Backups";

      new Setting(el)
        .setName("Backup folder")
        .setDesc(
          `Folder where patch backups are stored. Current: ${backupCurrent}. ` +
          "Note: the restore script must be able to find this location — verify before changing."
        )
        .addButton((btn) =>
          btn.setButtonText("Choose").onClick(() => {
            new FolderSuggestModal(this.app, async (folder) => {
              this.plugin.settings.patchBackupFolder = folder.path;
              await this.plugin.saveSettings();
              this.display();
            }).open();
          })
        );

      new Setting(el)
        .setName("Generate restore manifest")
        .setDesc(
          "Write a manifest file alongside each patch run so you can restore a full patch run " +
          "in one step. Only active when backups are enabled."
        )
        .addToggle((t) =>
          t.setValue(this.plugin.settings.patchGenerateManifest).onChange(async (v) => {
            this.plugin.settings.patchGenerateManifest = v;
            await this.plugin.saveSettings();
          })
        );
    }

    new Setting(el)
      .setName("Run lint after patch")
      .setDesc("Automatically run Vault Lint after a patch is applied.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.patchAutoLintAfterApply).onChange(async (v) => {
          this.plugin.settings.patchAutoLintAfterApply = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(el)
      .setName("Run maintenance after patch")
      .setDesc("Automatically run Vault Maintenance after a patch is applied.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.patchAutoMaintenanceAfterApply).onChange(async (v) => {
          this.plugin.settings.patchAutoMaintenanceAfterApply = v;
          await this.plugin.saveSettings();
        })
      );
  }

  // ── Maintenance ───────────────────────────────────────────────────────────

  private renderMaintenance(el: HTMLElement): void {
    new Setting(el)
      .setName("Backup retention (days)")
      .setDesc("Delete patch backup files older than this many days.")
      .addSlider((s) =>
        s.setLimits(1, 90, 1).setValue(this.plugin.settings.backupRetentionDays).setDynamicTooltip().onChange(async (v) => {
          this.plugin.settings.backupRetentionDays = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(el)
      .setName("Inbox retention (days)")
      .setDesc("Flag inbox files older than this many days as stale.")
      .addSlider((s) =>
        s.setLimits(1, 90, 1).setValue(this.plugin.settings.inboxRetentionDays).setDynamicTooltip().onChange(async (v) => {
          this.plugin.settings.inboxRetentionDays = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(el)
      .setName("Lint history retention (days)")
      .setDesc("Trim lint history entries older than this many days.")
      .addSlider((s) =>
        s.setLimits(1, 365, 1).setValue(this.plugin.settings.lintHistoryRetentionDays).setDynamicTooltip().onChange(async (v) => {
          this.plugin.settings.lintHistoryRetentionDays = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(el)
      .setName("Lint history max entries")
      .setDesc("Hard cap on the number of lint history entries to retain.")
      .addSlider((s) =>
        s.setLimits(10, 500, 10).setValue(this.plugin.settings.lintHistoryMaxEntries).setDynamicTooltip().onChange(async (v) => {
          this.plugin.settings.lintHistoryMaxEntries = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(el)
      .setName("Patch report retention")
      .setDesc("Number of patch report notes to keep.")
      .addSlider((s) =>
        s.setLimits(5, 100, 5).setValue(this.plugin.settings.patchReportRetentionCount).setDynamicTooltip().onChange(async (v) => {
          this.plugin.settings.patchReportRetentionCount = v;
          await this.plugin.saveSettings();
        })
      );
  }

  // ── Export ────────────────────────────────────────────────────────────────

  private renderExport(el: HTMLElement): void {
    new Setting(el)
      .setName("Enable export")
      .setDesc("Enables vault inventory, meta, and ontology export commands.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.exportEnabled).onChange(async (v) => {
          this.plugin.settings.exportEnabled = v;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    if (!this.plugin.settings.exportEnabled) return;

    this.renderFolderPicker(
      el,
      "Exports folder",
      "Folder where inventory and index files are written.",
      "exportsFolder",
      "System/Exports"
    );

    // ── Export actions ─────────────────────────────────────────────
    el.createEl("h3", { text: "Run Exports" });

    new Setting(el)
      .setName("Export Vault Overview")
      .setDesc("Builds vault-inventory.json, vault-meta.json, and vault-overview.md in one pass. Inventory is schema-optional; meta requires schema.")
      .addButton((btn) =>
        btn.setButtonText("Run").onClick(async () => {
          runExportOverview(this.plugin).catch((e: Error) => {
            new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          });
        })
      );

    new Setting(el)
      .setName("Export Ontology Index")
      .setDesc(
        "Builds per-type relationship indexes using the inventory and the filter settings below. " +
        "Runs inventory export first if no inventory file is on disk."
      )
      .addButton((btn) =>
        btn.setButtonText("Run").onClick(async () => {
          runExportOntology(this.plugin).catch((e: Error) => {
            new Notice(`Forge: ${e?.message ?? "Unexpected error"}`, 6000);
          });
        })
      );

    // ── Overview options ───────────────────────────────────────────
    el.createEl("h3", { text: "Overview Options" });

    // Domain field
    const allFieldsForDomain = this.plugin.schemaCache.getFieldNames();
    this.renderSchemaFieldDropdown(
      el,
      "Domain field",
      "Which frontmatter field represents a note's domain. Leave blank to use the parent folder.",
      allFieldsForDomain,
      this.plugin.settings.exportDomainField,
      async (v) => {
        this.plugin.settings.exportDomainField = v;
        await this.plugin.saveSettings();
      }
    );

    this.renderSchemaFieldDropdown(
      el,
      "Type field",
      "Which frontmatter field represents a note's type. Leave blank to use 'type'.",
      allFieldsForDomain,
      this.plugin.settings.exportTypeField,
      async (v) => {
        this.plugin.settings.exportTypeField = v;
        await this.plugin.saveSettings();
      }
    );

    this.renderSchemaFieldDropdown(
      el,
      "Status field",
      "Which frontmatter field represents a note's lifecycle status. Leave blank to use 'status'.",
      allFieldsForDomain,
      this.plugin.settings.exportStatusField,
      async (v) => {
        this.plugin.settings.exportStatusField = v;
        await this.plugin.saveSettings();
      }
    );

    // Dashboard name
    new Setting(el)
      .setName("Dashboard note name")
      .setDesc("Filename for the Dataview dashboard note created on first export run. Leave blank to use 'vault-dashboard'.")
      .addText((t) =>
        t
          .setPlaceholder("vault-dashboard")
          .setValue(this.plugin.settings.exportDashboardName)
          .onChange(async (v) => {
            this.plugin.settings.exportDashboardName = v.trim();
            await this.plugin.saveSettings();
          })
      );

    // Private notes
    new Setting(el)
      .setName("Private notes")
      .setDesc("When enabled, notes marked as private are counted separately in the overview and excluded from vault-meta.json.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.exportPrivateEnabled).onChange(async (v) => {
          this.plugin.settings.exportPrivateEnabled = v;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    if (this.plugin.settings.exportPrivateEnabled) {
      const allFieldsForPrivate = this.plugin.schemaCache.getFieldNames();
      this.renderSchemaFieldDropdown(
        el,
        "Private note field",
        "The frontmatter field that signals a note as private (e.g. ai_private, private, draft). Any truthy value marks the note as private.",
        allFieldsForPrivate,
        this.plugin.settings.exportPrivateField,
        async (v) => {
          this.plugin.settings.exportPrivateField = v;
          await this.plugin.saveSettings();
        }
      );
    }

    // ── Ontology filter ────────────────────────────────────────────
    el.createEl("h3", { text: "Ontology Filter" });
    el.createEl("p", {
      text: "Select which notes are included in the ontology export by choosing a schema field and the values to match.",
      cls: "setting-item-description",
    });

    new Setting(el)
      .setName("Reload from schema")
      .setDesc("Refresh field and value lists from the current schema.")
      .addButton((btn) =>
        btn.setButtonText("Reload").onClick(async () => {
          await this.plugin.schemaCache.refresh();
          new Notice("Forge: schema reloaded.");
          this.display();
        })
      );

    // Field selector — all required + optional fields from schema, no hardcoding
    const allFields = this.plugin.schemaCache.getFieldNames();

    this.renderSchemaFieldDropdown(
      el,
      "Filter field",
      "The schema field to filter notes by. Only notes matching the selected values will be indexed.",
      allFields,
      this.plugin.settings.exportFilterField,
      async (v) => {
        this.plugin.settings.exportFilterField = v;
        this.plugin.settings.exportFilterValues = []; // reset values when field changes
        await this.plugin.saveSettings();
        this.display();
      }
    );

    // Value multi-select — driven by the selected field's enum values
    if (this.plugin.settings.exportFilterField) {
      const fieldValues = this.plugin.schemaCache.getEnumValues(
        this.plugin.settings.exportFilterField
      );

      if (fieldValues && fieldValues.length > 0) {
        new Setting(el)
          .setName("Filter values")
          .setDesc(
            `Select which values of '${this.plugin.settings.exportFilterField}' to include. ` +
            "Notes matching any selected value will be included in the ontology export."
          );

        this.renderCheckboxGroup(
          el,
          fieldValues,
          this.plugin.settings.exportFilterValues,
          async (selected) => {
            this.plugin.settings.exportFilterValues = selected;
            await this.plugin.saveSettings();
          }
        );
      } else {
        el.createEl("p", {
          text: `'${this.plugin.settings.exportFilterField}' is not an enum field — no values to select. Choose a field with defined allowed values.`,
          cls: "setting-item-description",
        });
      }
    }

    // ── Relationship heading ───────────────────────────────────────
    el.createEl("h3", { text: "Relationship Extraction" });

    new Setting(el)
      .setName("Relationship heading")
      .setDesc(
        "The top-level heading under which relationship links are organised in your notes. " +
        "Enter without the # — e.g. 'Related'. Subheadings under this heading become relationship keys."
      )
      .addText((t) =>
        t
          .setPlaceholder("Related")
          .setValue(this.plugin.settings.exportRelationshipHeading)
          .onChange(async (v) => {
            this.plugin.settings.exportRelationshipHeading = v.trim();
            await this.plugin.saveSettings();
          })
      );

    // ── Exclude folders ────────────────────────────────────────────
    el.createEl("h3", { text: "Exclude Folders" });
    el.createEl("p", {
      text: "Notes inside these folders are skipped during ontology export. Applies at any depth — add a top-level folder to exclude everything under it.",
      cls: "setting-item-description",
    });

    new Setting(el)
      .setName("Excluded folders")
      .setDesc("Add folders to exclude from ontology indexing.");

    this.renderFolderMultiSelect(el);
  }

  /** Folder multi-select for ontology exclusions — uses the dropdown+chips pattern. */
  private renderFolderMultiSelect(el: HTMLElement): void {
    const selected = this.plugin.settings.exportExcludeFolders;

    const wrap = el.createDiv({ cls: "forge-multiselect" });
    const chipStrip = wrap.createDiv({ cls: "forge-ms-chips" });

    const renderChips = () => {
      chipStrip.empty();
      selected.forEach((val) => {
        const chip = chipStrip.createDiv({ cls: "forge-ms-chip" });
        chip.createSpan({ text: val });
        const rm = chip.createSpan({ cls: "forge-ms-chip-rm", text: "×" });
        rm.addEventListener("click", async (e) => {
          e.stopPropagation();
          const idx = selected.indexOf(val);
          if (idx > -1) selected.splice(idx, 1);
          renderChips();
          updateTrigger();
          await this.plugin.saveSettings();
        });
      });
    };

    const trigger = wrap.createDiv({ cls: "forge-ms-trigger" });
    const triggerLabel = trigger.createSpan({ cls: "forge-ms-trigger-label" });
    const triggerIcon = trigger.createSpan({ cls: "forge-ms-trigger-icon", text: "▾" });

    const updateTrigger = () => {
      triggerLabel.setText(
        selected.length === 0 ? "Add folders to exclude…" : `${selected.length} folder(s) excluded`
      );
    };

    const panel = wrap.createDiv({ cls: "forge-ms-panel forge-ms-hidden" });

    // Build folder list from vault
    const folders: string[] = [];
    const walk = (node: import("obsidian").TAbstractFile) => {
      if (node instanceof TFolder) {
        if (node.path && node.path !== "/") folders.push(node.path);
        node.children.forEach(walk);
      }
    };
    walk(this.app.vault.getRoot());
    folders.sort();

    folders.forEach((folderPath) => {
      const row = panel.createDiv({ cls: "forge-ms-row" });
      const box = row.createDiv({ cls: "forge-ms-box" });
      row.createSpan({ text: folderPath, cls: "forge-ms-row-label" });

      const setChecked = (checked: boolean) => {
        box.toggleClass("forge-ms-box-checked", checked);
        box.setText(checked ? "✓" : "");
      };
      setChecked(selected.includes(folderPath));

      row.addEventListener("click", async () => {
        const idx = selected.indexOf(folderPath);
        if (idx > -1) {
          selected.splice(idx, 1);
          setChecked(false);
        } else {
          selected.push(folderPath);
          setChecked(true);
        }
        renderChips();
        updateTrigger();
        await this.plugin.saveSettings();
      });
    });

    let open = false;
    trigger.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      open = !open;
      panel.toggleClass("forge-ms-hidden", !open);
      triggerIcon.setText(open ? "▴" : "▾");
    });

    const onOutside = (e: MouseEvent) => {
      if (!wrap.contains(e.target as Node)) {
        open = false;
        panel.addClass("forge-ms-hidden");
        triggerIcon.setText("▾");
      }
    };
    document.addEventListener("click", onOutside);

    const observer = new MutationObserver(() => {
      if (!document.contains(wrap)) {
        document.removeEventListener("click", onOutside);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    renderChips();
    updateTrigger();
  }

  // ── Shapes ──────────────────────────────────────────────────────────────

  private renderShapes(el: HTMLElement): void {
    const s = this.plugin.settings;

    // ── Enable ────────────────────────────────────────────────────
    new Setting(el)
      .setName("Enable Vault Shape Engine")
      .setDesc("Enables shape note processing and template refinement.")
      .addToggle((t) =>
        t.setValue(s.shapesEnabled).onChange(async (v) => {
          s.shapesEnabled = v;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    if (!s.shapesEnabled) return;

    // ── Folders ───────────────────────────────────────────────────
    el.createEl("h3", { text: "Folders" });

    this.renderFolderPicker(
      el,
      "Shapes folder",
      "Folder containing shape notes (type: shape, with a # Structure section).",
      "shapesFolder",
      "System/Shapes"
    );

    // ── Template Refinement ───────────────────────────────────────
    el.createEl("h3", { text: "Template Refinement" });
    el.createEl("p", {
      text: "When enabled, the 'Refine Shape Templates' command reads each shape note " +
            "and writes or updates the corresponding template note.",
      cls: "setting-item-description",
    });

    new Setting(el)
      .setName("Enable template refinement")
      .setDesc("Allow the Refine Shape Templates command to create and update template notes.")
      .addToggle((t) =>
        t.setValue(s.shapeRefinementEnabled).onChange(async (v) => {
          s.shapeRefinementEnabled = v;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    if (!s.shapeRefinementEnabled) return;

    this.renderFolderPicker(
      el,
      "Templates folder",
      "Folder where template notes are written.",
      "shapeTemplatesFolder",
      "System/Templates"
    );

    // ── Run button ────────────────────────────────────────────────
    new Setting(el)
      .setName("Run refinement")
      .setDesc("Process all shape notes and write or update template notes now.")
      .addButton((btn) =>
        btn.setButtonText("Refine Shape Templates").setCta().onClick(async () => {
          const { runRefineShapes } = await import("./commands/refine-shapes");
          await runRefineShapes(this.plugin);
        })
      );

    // ── Field configuration ───────────────────────────────────────
    el.createEl("h3", { text: "Template Field Configuration" });
    el.createEl("p", {
      text: "Configure which schema fields appear in generated templates and what value each gets. " +
            "The type target field always receives the shape name and is excluded here. " +
            "created and updated are set automatically at runtime.",
      cls: "setting-item-description",
    });

    // Type target field — dropdown of all schema field names
    this.renderShapeTypeTargetField(el);

    // Per-field configurator — rendered async from schema
    this.renderShapeFieldConfigurator(el);
  }

  private renderShapeTypeTargetField(el: HTMLElement): void {
    const s = this.plugin.settings;

    new Setting(el)
      .setName("Type target field")
      .setDesc(
        "The schema field that receives the shape name when a template is generated. " +
        "Load schema to populate this dropdown."
      )
      .addDropdown(async (dd) => {
        dd.addOption("", "— load schema to populate —");

        const schema = await loadSchema(this.plugin.app, s);
        if (schema) {
          const allFields = [
            ...schema.required_fields.map((f) => f.name),
            ...schema.optional_fields.map((f) => f.name),
          ];
          for (const name of allFields) {
            dd.addOption(name, name);
          }
          const current = s.shapeTypeTargetField || "type";
          dd.setValue(allFields.includes(current) ? current : (allFields[0] ?? ""));
        } else {
          dd.setValue(s.shapeTypeTargetField || "");
        }

        dd.onChange(async (v) => {
          s.shapeTypeTargetField = v;
          await this.plugin.saveSettings();
          this.display();
        });
      });
  }

  private renderShapeFieldConfigurator(el: HTMLElement): void {
    const s = this.plugin.settings;

    const container = el.createDiv({ cls: "forge-shape-fields" });

    // Load schema and render field rows
    loadSchema(this.plugin.app, s).then((schema) => {
      if (!schema) {
        container.createEl("p", {
          text: "Could not load schema. Ensure schema.md exists and is valid.",
          cls: "setting-item-description",
        });
        return;
      }

      const allFields = [
        ...schema.required_fields,
        ...schema.optional_fields,
      ];

      // Order by frontmatterFieldOrder if set
      const order = s.frontmatterFieldOrder;
      const ordered = order.length > 0
        ? [
            ...order
              .map((name) => allFields.find((f) => f.name === name))
              .filter((f): f is NonNullable<typeof f> => f != null),
            ...allFields.filter((f) => !order.includes(f.name)),
          ]
        : allFields;

      // Filter out runtime fields
      const runtimeFields = new Set(["created", "updated", s.shapeTypeTargetField].filter(Boolean));
      const configurable = ordered.filter((f) => !runtimeFields.has(f.name));

      if (configurable.length === 0) {
        container.createEl("p", {
          text: "No configurable fields found in schema.",
          cls: "setting-item-description",
        });
        return;
      }

      // Header row
      const header = container.createDiv({ cls: "forge-shape-field-header" });
      header.createSpan({ text: "Include", cls: "forge-shape-field-col-include" });
      header.createSpan({ text: "Field", cls: "forge-shape-field-col-name" });
      header.createSpan({ text: "Value", cls: "forge-shape-field-col-value" });

      for (const field of configurable) {
        this.renderShapeFieldRow(container, field, s);
      }

      // Runtime fields note
      container.createEl("p", {
        text: "The type target field, created, and updated are set automatically and are not configurable here.",
        cls: "setting-item-description forge-shape-runtime-note",
      });
    });
  }

  private renderShapeFieldRow(
    container: HTMLElement,
    field: import("./utils/schema").SchemaField,
    s: import("./settings").ForgeSettings
  ): void {
    const fieldName = field.name;
    const existing = s.shapeTemplateFields[fieldName] ?? { include: false, value: "" };

    const row = container.createDiv({ cls: "forge-shape-field-row" });

    // Include toggle
    const includeWrap = row.createDiv({ cls: "forge-shape-field-col-include" });
    const checkbox = includeWrap.createEl("input", { type: "checkbox" });
    checkbox.checked = existing.include;

    // Field name
    row.createSpan({ text: fieldName, cls: "forge-shape-field-col-name forge-field-name" });

    // Value control
    const valueWrap = row.createDiv({ cls: "forge-shape-field-col-value" });
    const valueControl = this.createShapeFieldValueControl(valueWrap, field, existing.value, existing.include);

    const save = async () => {
      s.shapeTemplateFields[fieldName] = {
        include: checkbox.checked,
        value: valueControl.getValue(),
      };
      await this.plugin.saveSettings();
    };

    checkbox.addEventListener("change", async () => {
      valueControl.setEnabled(checkbox.checked);
      await save();
    });
    valueControl.setEnabled(existing.include);
    valueControl.onChanged(save);
  }

  private createShapeFieldValueControl(
    container: HTMLElement,
    field: import("./utils/schema").SchemaField,
    currentValue: unknown,
    enabled: boolean
  ): { getValue: () => unknown; setEnabled: (v: boolean) => void; onChanged: (cb: () => void) => void } {
    let onChange: (() => void) | null = null;
    const notify = () => onChange?.();

    if (field.type === "enum" && field.values && field.values.length > 0) {
      // Dropdown
      const select = container.createEl("select", { cls: "forge-shape-field-select" });
      const emptyOpt = select.createEl("option", { value: "", text: "— none —" });
      for (const val of field.values) {
        const opt = select.createEl("option", { value: val, text: val });
        if (val === String(currentValue ?? "")) opt.selected = true;
      }
      if (!currentValue) emptyOpt.selected = true;

      select.addEventListener("change", notify);

      return {
        getValue: () => select.value || "",
        setEnabled: (v) => { select.disabled = !v; },
        onChanged: (cb) => { onChange = cb; },
      };
    }

    if (field.type === "boolean") {
      // Boolean dropdown
      const select = container.createEl("select", { cls: "forge-shape-field-select" });
      select.createEl("option", { value: "", text: "— none —" });
      select.createEl("option", { value: "true", text: "true" });
      select.createEl("option", { value: "false", text: "false" });
      const strVal = currentValue === true ? "true" : currentValue === false ? "false" : "";
      select.value = strVal;
      select.addEventListener("change", notify);

      return {
        getValue: () => {
          if (select.value === "true") return true;
          if (select.value === "false") return false;
          return "";
        },
        setEnabled: (v) => { select.disabled = !v; },
        onChanged: (cb) => { onChange = cb; },
      };
    }

    if (field.type === "list") {
      // Comma-separated text input — stored as string[], displayed as CSV
      const input = container.createEl("input", {
        type: "text",
        cls: "forge-shape-field-input",
        attr: { placeholder: "value1, value2" },
      });
      const arr = Array.isArray(currentValue) ? (currentValue as string[]).join(", ") : String(currentValue ?? "");
      input.value = arr;
      input.addEventListener("input", notify);

      return {
        getValue: () =>
          input.value
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        setEnabled: (v) => { input.disabled = !v; },
        onChanged: (cb) => { onChange = cb; },
      };
    }

    // Default: text input (string, date, version, unknown)
    const input = container.createEl("input", {
      type: "text",
      cls: "forge-shape-field-input",
      attr: { placeholder: field.type === "date" ? "yyyy-MM-dd" : "" },
    });
    input.value = String(currentValue ?? "");
    input.addEventListener("input", notify);

    return {
      getValue: () => input.value.trim(),
      setEnabled: (v) => { input.disabled = !v; },
      onChanged: (cb) => { onChange = cb; },
    };
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  /**
   * Renders a folder picker row. All folder pickers show only folders
   * via FolderSuggestModal — no files in the tree.
   */
  private renderFolderPicker(
    el: HTMLElement,
    name: string,
    desc: string,
    settingKey: keyof import("./settings").ForgeSettings,
    fallback: string,
    _schemaNote = false   // reserved for future schema-specific behaviour
  ): void {
    const current = String(this.plugin.settings[settingKey] ?? fallback);

    new Setting(el)
      .setName(name)
      .setDesc(`${desc} Current: ${current}`)
      .addButton((btn) =>
        btn.setButtonText("Choose").onClick(() => {
          new FolderSuggestModal(this.app, async (folder) => {
            (this.plugin.settings as unknown as Record<string, unknown>)[settingKey as string] = folder.path || fallback;
            await this.plugin.saveSettings();
            this.display();
          }).open();
        })
      );
  }

  /** Schema note picker — selects a .md file, splits into folder + filename. */
  private renderSchemaNotePicker(el: HTMLElement): void {
    const current = `${this.plugin.settings.schemaNoteFolder}/${this.plugin.settings.schemaNoteFile}`;

    new Setting(el)
      .setName("Schema note")
      .setDesc(`Path to schema.md relative to vault root. Current: ${current}`)
      .addButton((btn) =>
        btn.setButtonText("Choose").onClick(() => {
          new MarkdownFileSuggestModal(this.app, async (file) => {
            const lastSlash = file.path.lastIndexOf("/");
            this.plugin.settings.schemaNoteFolder =
              lastSlash >= 0 ? file.path.substring(0, lastSlash) : "";
            this.plugin.settings.schemaNoteFile =
              lastSlash >= 0 ? file.path.substring(lastSlash + 1) : file.path;
            await this.plugin.saveSettings();
            this.display();
          }).open();
        })
      );
  }

  /** Patch file picker — selects .md / .yaml / .yml files. */
  private renderPatchFilePicker(el: HTMLElement): void {
    const fallback = "System/Forge/Patches/vault-patch.md";
    const current = this.plugin.settings.patchDefaultFile || fallback;

    new Setting(el)
      .setName("Default patch file")
      .setDesc(`Path to the patch note loaded by Apply Vault Patch. Current: ${current}`)
      .addButton((btn) =>
        btn.setButtonText("Choose").onClick(() => {
          new PatchFileSuggestModal(this.app, async (file) => {
            this.plugin.settings.patchDefaultFile = file.path;
            await this.plugin.saveSettings();
            this.display();
          }).open();
        })
      );
  }

  /**
   * Single-select dropdown populated from a list of field names.
   * Emits the chosen value to the provided async handler.
   */
  private renderSchemaFieldDropdown(
    el: HTMLElement,
    name: string,
    desc: string,
    fields: string[],
    currentValue: string,
    onChange: (value: string) => Promise<void>
  ): void {
    const setting = new Setting(el).setName(name).setDesc(desc);

    if (fields.length === 0) {
      setting.setDesc(
        desc + " (No schema fields found — reload schema on the Export tab.)"
      );
      return;
    }

    setting.addDropdown((d) => {
      d.addOption("", "— select a field —");
      fields.forEach((f) => d.addOption(f, f));
      d.setValue(currentValue).onChange(async (v) => {
        await onChange(v);
      });
    });
  }

  /**
   * Dropdown + chips multi-select.
   *
   * Renders a collapsed trigger showing how many values are selected.
   * Opens an inline checklist panel on click.
   * Selected values appear as removable chips above the trigger.
   * Scales cleanly from 2 to 50+ options.
   */
  private renderCheckboxGroup(
    el: HTMLElement,
    options: string[],
    selected: string[],
    onChange: (selected: string[]) => Promise<void>
  ): void {
    const wrap = el.createDiv({ cls: "forge-multiselect" });

    // ── Chip strip ────────────────────────────────────────────────
    const chipStrip = wrap.createDiv({ cls: "forge-ms-chips" });

    const renderChips = () => {
      chipStrip.empty();
      selected.forEach((val) => {
        const chip = chipStrip.createDiv({ cls: "forge-ms-chip" });
        chip.createSpan({ text: val });
        const rm = chip.createSpan({ cls: "forge-ms-chip-rm", text: "×" });
        rm.addEventListener("click", async (e) => {
          e.stopPropagation();
          const idx = selected.indexOf(val);
          if (idx > -1) selected.splice(idx, 1);
          renderChips();
          updateTrigger();
          await onChange([...selected]);
        });
      });
    };

    // ── Trigger button ────────────────────────────────────────────
    const trigger = wrap.createDiv({ cls: "forge-ms-trigger" });
    const triggerLabel = trigger.createSpan({ cls: "forge-ms-trigger-label" });
    const triggerIcon = trigger.createSpan({ cls: "forge-ms-trigger-icon", text: "▾" });

    const updateTrigger = () => {
      triggerLabel.setText(
        selected.length === 0
          ? "Select values…"
          : `${selected.length} of ${options.length} selected`
      );
    };

    // ── Dropdown panel ────────────────────────────────────────────
    const panel = wrap.createDiv({ cls: "forge-ms-panel forge-ms-hidden" });

    options.forEach((val) => {
      const row = panel.createDiv({ cls: "forge-ms-row" });
      const box  = row.createDiv({ cls: "forge-ms-box" });
      row.createSpan({ text: val, cls: "forge-ms-row-label" });

      const setChecked = (checked: boolean) => {
        box.toggleClass("forge-ms-box-checked", checked);
        box.setText(checked ? "✓" : "");
      };

      setChecked(selected.includes(val));

      row.addEventListener("click", async () => {
        const idx = selected.indexOf(val);
        if (idx > -1) {
          selected.splice(idx, 1);
          setChecked(false);
        } else {
          selected.push(val);
          setChecked(true);
        }
        renderChips();
        updateTrigger();
        await onChange([...selected]);
      });
    });

    // ── Toggle panel on trigger click ─────────────────────────────
    let open = false;
    const togglePanel = (e: MouseEvent) => {
      e.stopPropagation();
      open = !open;
      panel.toggleClass("forge-ms-hidden", !open);
      triggerIcon.setText(open ? "▴" : "▾");
    };

    trigger.addEventListener("click", togglePanel);

    // Close on outside click
    const onOutside = (e: MouseEvent) => {
      if (!wrap.contains(e.target as Node)) {
        open = false;
        panel.addClass("forge-ms-hidden");
        triggerIcon.setText("▾");
      }
    };
    document.addEventListener("click", onOutside);

    // Cleanup listener when element is removed
    const observer = new MutationObserver(() => {
      if (!document.contains(wrap)) {
        document.removeEventListener("click", onOutside);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    renderChips();
    updateTrigger();
  }

  /** Inject tab bar and multiselect styles scoped to the settings container. */
  private injectStyles(): void {
    if (this.containerEl.querySelector("#forge-tab-styles")) return;

    const style = document.createElement("style");
    style.id = "forge-tab-styles";
    style.textContent = `
      .forge-tab-bar {
        display: flex;
        gap: 4px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--background-modifier-border);
        margin-bottom: 16px;
        flex-wrap: wrap;
      }
      .forge-tab-btn {
        padding: 4px 12px;
        border-radius: 4px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-secondary);
        color: var(--text-muted);
        cursor: pointer;
        font-size: var(--font-ui-small);
      }
      .forge-tab-btn:hover {
        background: var(--background-modifier-hover);
        color: var(--text-normal);
      }
      .forge-tab-btn.is-active {
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        border-color: var(--interactive-accent);
      }
      .forge-multiselect {
        margin: 4px 0 8px 0;
        position: relative;
      }
      .forge-ms-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 6px;
        min-height: 0;
      }
      .forge-ms-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 3px 10px;
        border-radius: 12px;
        font-size: var(--font-ui-smaller);
        background: var(--interactive-accent);
        color: var(--text-on-accent);
      }
      .forge-ms-chip-rm {
        cursor: pointer;
        opacity: 0.7;
        font-size: 13px;
        line-height: 1;
      }
      .forge-ms-chip-rm:hover { opacity: 1; }
      .forge-ms-trigger {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 10px;
        border-radius: 4px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-secondary);
        cursor: pointer;
        user-select: none;
      }
      .forge-ms-trigger:hover { background: var(--background-modifier-hover); }
      .forge-ms-trigger-label {
        font-size: var(--font-ui-small);
        color: var(--text-muted);
      }
      .forge-ms-trigger-icon {
        font-size: 11px;
        color: var(--text-muted);
      }
      .forge-ms-panel {
        margin-top: 4px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 4px;
        background: var(--background-primary);
        max-height: 240px;
        overflow-y: auto;
        z-index: 100;
      }
      .forge-ms-hidden { display: none; }
      .forge-ms-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 7px 12px;
        cursor: pointer;
        border-bottom: 1px solid var(--background-modifier-border-hover);
      }
      .forge-ms-row:last-child { border-bottom: none; }
      .forge-ms-row:hover { background: var(--background-modifier-hover); }
      .forge-ms-box {
        width: 16px;
        height: 16px;
        border-radius: 3px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-secondary);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        flex-shrink: 0;
        color: var(--text-on-accent);
      }
      .forge-ms-box-checked {
        background: var(--interactive-accent);
        border-color: var(--interactive-accent);
      }
      .forge-ms-row-label {
        font-size: var(--font-ui-small);
        color: var(--text-normal);
      }
      .forge-coming-soon {
        padding: 16px 0;
        opacity: 0.6;
      }
      .forge-field-order-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin: 8px 0 10px 0;
      }
      .forge-field-order-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 5px 10px;
        border-radius: 4px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-secondary);
        cursor: default;
        user-select: none;
      }
      .forge-field-order-item.forge-field-order-dragging {
        opacity: 0.4;
      }
      .forge-field-order-handle {
        cursor: grab;
        color: var(--text-muted);
        font-size: 14px;
        line-height: 1;
        flex-shrink: 0;
      }
      .forge-field-order-handle:active { cursor: grabbing; }
      .forge-field-order-name {
        flex: 1;
        font-size: var(--font-ui-small);
        font-family: var(--font-monospace);
        color: var(--text-normal);
      }
      .forge-field-order-rm {
        cursor: pointer;
        color: var(--text-muted);
        font-size: 14px;
        line-height: 1;
        flex-shrink: 0;
      }
      .forge-field-order-rm:hover { color: var(--text-error); }
      .forge-field-order-add-row {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
      }
      .forge-field-order-input {
        flex: 1;
        padding: 5px 8px;
        border-radius: 4px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        color: var(--text-normal);
        font-size: var(--font-ui-small);
        font-family: var(--font-monospace);
      }
      .forge-field-order-add-btn {
        padding: 5px 14px;
        border-radius: 4px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-secondary);
        color: var(--text-normal);
        cursor: pointer;
        font-size: var(--font-ui-small);
      }
      .forge-field-order-add-btn:hover {
        background: var(--background-modifier-hover);
      }
      .forge-shape-fields {
        margin: 8px 0 16px 0;
        border: 1px solid var(--background-modifier-border);
        border-radius: 4px;
        overflow: hidden;
      }
      .forge-shape-field-header {
        display: grid;
        grid-template-columns: 48px 180px 1fr;
        gap: 8px;
        padding: 6px 12px;
        background: var(--background-secondary);
        border-bottom: 1px solid var(--background-modifier-border);
        font-size: var(--font-ui-smaller);
        color: var(--text-muted);
        font-weight: 600;
      }
      .forge-shape-field-row {
        display: grid;
        grid-template-columns: 48px 180px 1fr;
        gap: 8px;
        padding: 6px 12px;
        align-items: center;
        border-bottom: 1px solid var(--background-modifier-border-hover);
      }
      .forge-shape-field-row:last-of-type {
        border-bottom: none;
      }
      .forge-shape-field-col-include {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .forge-shape-field-col-name {
        font-size: var(--font-ui-small);
      }
      .forge-shape-field-col-value {
        display: flex;
        align-items: center;
      }
      .forge-field-name {
        font-family: var(--font-monospace);
        color: var(--text-normal);
      }
      .forge-shape-field-select,
      .forge-shape-field-input {
        width: 100%;
        padding: 3px 6px;
        border-radius: 4px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        color: var(--text-normal);
        font-size: var(--font-ui-small);
      }
      .forge-shape-field-select:disabled,
      .forge-shape-field-input:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .forge-shape-runtime-note {
        padding: 8px 12px;
        border-top: 1px solid var(--background-modifier-border);
        margin: 0;
      }
    `;
    this.containerEl.appendChild(style);
  }
}

// ── Modal helpers ─────────────────────────────────────────────────────────────

/** Folder-only picker — no files shown in the suggestion list. */
class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  constructor(app: App, private onChoose: (folder: TFolder) => void) {
    super(app);
    this.setPlaceholder("Choose a folder...");
  }

  getItems(): TFolder[] {
    const folders: TFolder[] = [];
    const walk = (node: TAbstractFile) => {
      if (node instanceof TFolder) {
        folders.push(node);
        node.children.forEach(walk);
      }
    };
    walk(this.app.vault.getRoot());
    return folders;
  }

  getItemText(folder: TFolder): string {
    return folder.path || "/";
  }

  onChooseItem(folder: TFolder): void {
    this.onChoose(folder);
  }
}

/** Markdown file picker — used for schema note selection only. */
class MarkdownFileSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private onChoose: (file: TFile) => void) {
    super(app);
    this.setPlaceholder("Choose a markdown note...");
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}

/** Patch file picker — .md, .yaml, .yml only. */
class PatchFileSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private onChoose: (file: TFile) => void) {
    super(app);
    this.setPlaceholder("Choose a patch note or YAML file...");
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((f) => {
      const p = f.path.toLowerCase();
      return p.endsWith(".md") || p.endsWith(".yaml") || p.endsWith(".yml");
    });
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}