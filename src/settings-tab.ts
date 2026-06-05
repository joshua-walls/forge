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
import type { ForgeSettings } from "./settings";

type TabId = "general" | "lint" | "patch" | "maintenance" | "export" | "shapes";
type StringSettingKey = {
  [K in keyof ForgeSettings]: ForgeSettings[K] extends string ? K : never;
}[keyof ForgeSettings];

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

  private runAsync(task: () => Promise<void>): void {
    void task();
  }

  private stringifyUiValue(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  private setStringSetting<K extends StringSettingKey>(key: K, value: ForgeSettings[K]): void {
    this.plugin.settings[key] = value;
  }

  private renderTab(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.injectStyles();

    const tabBar = containerEl.createDiv({ cls: "forge-tab-bar" });

    TABS.forEach(({ id, label }) => {
      const btn = tabBar.createEl("button", {
        text: label,
        cls: ["forge-tab-btn", id === this.activeTab ? "is-active" : ""],
      });
      btn.addEventListener("click", () => {
        this.activeTab = id;
        this.renderTab();
      });
    });

    const content = containerEl.createDiv({ cls: "forge-tab-content" });

    switch (this.activeTab) {
      case "general":     this.renderGeneral(content);     break;
      case "lint":        this.renderLint(content);        break;
      case "patch":       this.renderPatch(content);       break;
      case "maintenance": this.renderMaintenance(content); break;
      case "export":      this.renderExport(content);      break;
      case "shapes":      this.renderShapes(content);      break;
    }
  }

  display(): void {
    this.renderTab();
  }

  // ── General ──────────────────────────────────────────────────────────────

  private renderGeneral(el: HTMLElement): void {
    new Setting(el)
      .setName("Install documentation")
      .setDesc(
        "Writes vault-native docs into your Forge folder — command reference, " +
        "schema guide, patch examples, and troubleshooting. Skips notes that already exist."
      )
      .addButton((btn) =>
        btn.setButtonText("Install docs").setCta().onClick(() => {
          this.runAsync(() =>
            installVaultForgeDocumentation(this.plugin.app, this.plugin.settings)
          );
        })
      );

    this.renderSectionHeading(el, "System Paths");
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

    this.renderDataviewExpansionSettings(el);
    this.renderFrontmatterFieldOrder(el);
  }

  private renderDataviewExpansionSettings(el: HTMLElement): void {
    const s = this.plugin.settings;
    const dataviewAvailable = this.plugin.dataviewExpansionService?.isDataviewAvailable?.() ?? false;

    this.renderSectionHeading(el, "Dataview Expansion");
    el.createEl("p", {
      text: "Collects link results from every dataview block in a note and writes one collapsed compatibility block at the bottom for graph view and raw-Markdown readers.",
      cls: "setting-item-description",
    });

    if (!dataviewAvailable) {
      el.createEl("p", {
        text: "Dataview expansion is unavailable because the dataview plugin is not installed or not enabled.",
        cls: "setting-item-description",
      });
    }

    new Setting(el)
      .setName("Enable dataview expansion")
      .setDesc("Turn on bottom-of-note dataview expansion blocks.")
      .addToggle((tg) =>
        tg.setValue(s.dataviewExpansionEnabled).setDisabled(!dataviewAvailable).onChange((value) => {
          this.runAsync(async () => {
            s.dataviewExpansionEnabled = value;
            await this.plugin.saveSettings();
            this.renderTab();
          });
        })
      );

    if (!s.dataviewExpansionEnabled || !dataviewAvailable) return;

    new Setting(el)
      .setName("Auto-update mode")
      .setDesc("Current session only. Off disables automatic refresh. Edit idle waits 5 seconds after typing stops and also refreshes when you leave the note.")
      .addDropdown((dd) =>
        dd
          .addOption("off", "Off")
          .addOption("edit_idle", "Edit idle")
          .setValue(s.dataviewExpansionAutoUpdateMode)
          .onChange((value) => {
            this.runAsync(async () => {
              s.dataviewExpansionAutoUpdateMode = value as import("./settings").DataviewExpansionAutoUpdateMode;
              await this.plugin.applyRuntimeSettingsChange();
            });
          })
      );

    new Setting(el)
      .setName("Block title")
      .setDesc("Title shown in the collapsed block appended to the end of the note.")
      .addText((text) =>
        text
          .setPlaceholder("Dataview expansion")
          .setValue(s.dataviewExpansionTitle)
          .onChange((value) => {
            this.runAsync(async () => {
              s.dataviewExpansionTitle = value.trim() || "Dataview Expansion";
              await this.plugin.saveSettings();
            });
          })
      );

    new Setting(el)
      .setName("Max links")
      .setDesc("Maximum number of links written to the block. Use 0 for no limit.")
      .addText((text) =>
        text
          .setPlaceholder("250")
          .setValue(String(s.dataviewExpansionMaxLinks))
          .onChange((value) => {
            this.runAsync(async () => {
              const parsed = Number.parseInt(value.trim(), 10);
              s.dataviewExpansionMaxLinks = Number.isFinite(parsed) && parsed >= 0 ? parsed : 250;
              await this.plugin.saveSettings();
            });
          })
      );
  }

  // ── Frontmatter field order ───────────────────────────────────────────────

  private renderFrontmatterFieldOrder(el: HTMLElement): void {
    this.renderSectionHeading(el, "Frontmatter Field Order");
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
      rm.addEventListener("click", () => {
        this.runAsync(async () => {
          item.remove();
          await save();
        });
      });

      // Drag-and-drop handlers
      item.addEventListener("dragstart", (e) => {
        item.classList.add("forge-field-order-dragging");
        e.dataTransfer?.setData("text/plain", field);
      });

      item.addEventListener("dragend", () => {
        this.runAsync(async () => {
          item.classList.remove("forge-field-order-dragging");
          await save();
        });
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
      attr: { placeholder: "Field_name" },
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

    addBtn.addEventListener("click", () => {
      this.runAsync(doAdd);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        this.runAsync(doAdd);
      }
    });

    // ── Prefill from schema ──────────────────────────────────────────
    new Setting(el)
      .setName("Prefill from schema")
      .setDesc(
        "Replace the field order with required + optional fields from schema.md, " +
        "in the order they appear in the schema."
      )
      .addButton((btn) =>
        btn.setButtonText("Prefill").onClick(() => {
          this.runAsync(async () => {
            const schema = await loadSchema(this.plugin.app, this.plugin.settings);
            if (!schema) {
              new Notice("Forge: Could not load schema — is schema.md present?");
              return;
            }
            const schemaFields = [
              ...schema.frontmatter.required.map((f) => f.name),
              ...schema.frontmatter.optional.map((f) => f.name),
            ];
            const seen = new Set<string>();
            const deduped = schemaFields.filter((f) => {
              if (seen.has(f)) return false;
              seen.add(f);
              return true;
            });
            this.plugin.settings.frontmatterFieldOrder = deduped;
            await this.plugin.saveSettings();
            this.renderTab();
          });
        })
      );
  }

  // ── Lint ─────────────────────────────────────────────────────────────────

  private renderLint(el: HTMLElement): void {
    this.renderSchemaNotePicker(el);
    this.renderSchemaVersionSettings(el);

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
        t.setValue(this.plugin.settings.lintStrictMode).onChange((v) => {
          this.runAsync(async () => {
            this.plugin.settings.lintStrictMode = v;
            await this.plugin.saveSettings();
          });
        })
      );

    new Setting(el)
      .setName("Lint run retention")
      .setDesc("Number of lint run notes to keep.")
      .addSlider((s) =>
        s
          .setLimits(5, 50, 5)
          .setValue(this.plugin.settings.lintRunRetentionCount)
          .setDynamicTooltip()
          .onChange((v) => {
            this.runAsync(async () => {
              this.plugin.settings.lintRunRetentionCount = v;
              await this.plugin.saveSettings();
            });
          })
      );

    new Setting(el)
      .setName("Lint file links")
      .setDesc(
        "Wrap file paths in [[wikilinks]] in lint run notes so you can navigate directly to affected files."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.lintFileLinks).onChange((v) => {
          this.runAsync(async () => {
            this.plugin.settings.lintFileLinks = v;
            await this.plugin.saveSettings();
          });
        })
      );

    new Setting(el)
      .setName("Lint inline metadata")
      .setDesc(
        "Check inline metadata (key:: Value patterns) against the schema. Disable to skip all inline metadata rules."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.lintInlineMetadata).onChange((v) => {
          this.runAsync(async () => {
            this.plugin.settings.lintInlineMetadata = v;
            await this.plugin.saveSettings();
          });
        })
      );

    new Setting(el)
      .setName("Exclude inbox folder")
      .setDesc(
        "Skip notes in the configured inbox folder during vault lint so draft notes can stay incomplete while they are still being worked out."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.lintExcludeInboxFolder).onChange((v) => {
          this.runAsync(async () => {
            this.plugin.settings.lintExcludeInboxFolder = v;
            await this.plugin.saveSettings();
          });
        })
      );

    new Setting(el)
      .setName("Repair prompt threshold")
      .setDesc("When to show the open vault repair button after a lint run.")
      .addDropdown((d) =>
        d
          .addOption("errors_only", "Errors only")
          .addOption("errors_and_warnings", "Errors and warnings")
          .setValue(this.plugin.settings.lintRepairThreshold)
          .onChange((v) => {
            this.runAsync(async () => {
              this.plugin.settings.lintRepairThreshold = v as "errors_only" | "errors_and_warnings";
              await this.plugin.saveSettings();
            });
          })
      );

    // ── Stale Note Review ─────────────────────────────────────────────
    this.renderSectionHeading(el, "Stale Note Review");

    new Setting(el)
      .setName("Enable stale note review")
      .setDesc(
        "Flag notes whose review cycle has elapsed, based on frontmatter field values."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.staleReviewEnabled).onChange((v) => {
          this.runAsync(async () => {
            this.plugin.settings.staleReviewEnabled = v;
            await this.plugin.saveSettings();
            this.renderTab();
          });
        })
      );

    if (!this.plugin.settings.staleReviewEnabled) return;

    const allFields = this.plugin.schemaCache.getFrontmatterFieldNames();

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
        this.renderTab();
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
        t.setValue(this.plugin.settings.patchBackupEnabled).onChange((v) => {
          this.runAsync(async () => {
            this.plugin.settings.patchBackupEnabled = v;
            await this.plugin.saveSettings();
            this.renderTab();
          });
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
            new FolderSuggestModal(this.app, (folder) => {
              this.runAsync(async () => {
                this.plugin.settings.patchBackupFolder = folder.path;
                await this.plugin.saveSettings();
                this.renderTab();
              });
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
          t.setValue(this.plugin.settings.patchGenerateManifest).onChange((v) => {
            this.runAsync(async () => {
              this.plugin.settings.patchGenerateManifest = v;
              await this.plugin.saveSettings();
            });
          })
        );
    }

    new Setting(el)
      .setName("Run lint after patch")
      .setDesc("Automatically run vault lint after a patch is applied.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.patchAutoLintAfterApply).onChange((v) => {
          this.runAsync(async () => {
            this.plugin.settings.patchAutoLintAfterApply = v;
            await this.plugin.saveSettings();
          });
        })
      );

    new Setting(el)
      .setName("Run maintenance after patch")
      .setDesc("Automatically run vault maintenance after a patch is applied.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.patchAutoMaintenanceAfterApply).onChange((v) => {
          this.runAsync(async () => {
            this.plugin.settings.patchAutoMaintenanceAfterApply = v;
            await this.plugin.saveSettings();
          });
        })
      );
  }

  // ── Maintenance ───────────────────────────────────────────────────────────

  private renderMaintenance(el: HTMLElement): void {
    new Setting(el)
      .setName("Backup retention (days)")
      .setDesc("Delete patch backup files older than this many days.")
      .addSlider((s) =>
        s.setLimits(1, 60, 1).setValue(this.plugin.settings.backupRetentionDays).setDynamicTooltip().onChange((v) => {
          this.runAsync(async () => {
            this.plugin.settings.backupRetentionDays = v;
            await this.plugin.saveSettings();
          });
        })
      );

    new Setting(el)
      .setName("Inbox retention (days)")
      .setDesc("Age threshold used for stale inbox handling.")
      .addSlider((s) =>
        s.setLimits(1, 60, 1).setValue(this.plugin.settings.inboxRetentionDays).setDynamicTooltip().onChange((v) => {
          this.runAsync(async () => {
            this.plugin.settings.inboxRetentionDays = v;
            await this.plugin.saveSettings();
          });
        })
      );

    new Setting(el)
      .setName("Inbox retention action")
      .setDesc("Choose whether stale inbox notes are deleted during maintenance or reported as lint warnings.")
      .addDropdown((d) =>
        d
          .addOption("delete", "Delete in maintenance")
          .addOption("warning", "Warn in vault lint")
          .setValue(this.plugin.settings.inboxRetentionAction)
          .onChange((v) => {
            this.runAsync(async () => {
              this.plugin.settings.inboxRetentionAction = v as "delete" | "warning";
              await this.plugin.saveSettings();
            });
          })
      );

    new Setting(el)
      .setName("Lint history retention (days)")
      .setDesc("Trim lint history entries older than this many days.")
      .addSlider((s) =>
        s.setLimits(1, 90, 1).setValue(this.plugin.settings.lintHistoryRetentionDays).setDynamicTooltip().onChange((v) => {
          this.runAsync(async () => {
            this.plugin.settings.lintHistoryRetentionDays = v;
            await this.plugin.saveSettings();
          });
        })
      );

    new Setting(el)
      .setName("Lint history max entries")
      .setDesc("Hard cap on the number of lint history entries to retain.")
      .addSlider((s) =>
        s.setLimits(10, 100, 10).setValue(this.plugin.settings.lintHistoryMaxEntries).setDynamicTooltip().onChange((v) => {
          this.runAsync(async () => {
            this.plugin.settings.lintHistoryMaxEntries = v;
            await this.plugin.saveSettings();
          });
        })
      );

    new Setting(el)
      .setName("Auto-run on dashboard refresh")
      .setDesc("Run vault maintenance silently whenever the vault health dashboard is refreshed.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.maintenanceAutoRunOnDashboardRefresh).onChange((v) => {
          this.runAsync(async () => {
            this.plugin.settings.maintenanceAutoRunOnDashboardRefresh = v;
            await this.plugin.saveSettings();
          });
        })
      );

    new Setting(el)
      .setName("Patch report retention")
      .setDesc("Number of patch report notes to keep.")
      .addSlider((s) =>
        s.setLimits(5, 50, 5).setValue(this.plugin.settings.patchReportRetentionCount).setDynamicTooltip().onChange((v) => {
          this.runAsync(async () => {
            this.plugin.settings.patchReportRetentionCount = v;
            await this.plugin.saveSettings();
          });
        })
      );

    new Setting(el)
      .setName("Shape lint run retention")
      .setDesc("Number of shape lint run notes to keep.")
      .addSlider((s) =>
        s.setLimits(5, 50, 5).setValue(this.plugin.settings.shapeLintRunRetentionCount).setDynamicTooltip().onChange((v) => {
          this.runAsync(async () => {
            this.plugin.settings.shapeLintRunRetentionCount = v;
            await this.plugin.saveSettings();
          });
        })
      );
  }

  // ── Export ────────────────────────────────────────────────────────────────

  private renderExport(el: HTMLElement): void {
    new Setting(el)
      .setName("Enable export")
      .setDesc("Enables vault inventory, meta, and ontology export commands.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.exportEnabled).onChange((v) => {
          this.runAsync(async () => {
            this.plugin.settings.exportEnabled = v;
            await this.plugin.saveSettings();
            this.renderTab();
          });
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
    this.renderSectionHeading(el, "Run Exports");

    new Setting(el)
      .setName("Export vault overview")
      .setDesc("Builds vault-inventory.json, vault-meta.json, and vault-export.md in one pass. Inventory is schema-optional; meta requires schema and excludes ai_private notes.")
      .addButton((btn) =>
        btn.setButtonText("Run").onClick(() => {
          this.runAsync(async () => {
            try {
              await runExportOverview(this.plugin);
            } catch (error) {
              const message = error instanceof Error ? error.message : "Unexpected error";
              new Notice(`Forge: ${message}`, 6000);
            }
          });
        })
      );

    new Setting(el)
      .setName("Export ontology index")
      .setDesc(
        "Builds per-type relationship indexes using the inventory and the filter settings below. " +
        "Runs inventory export first if no inventory file is on disk."
      )
      .addButton((btn) =>
        btn.setButtonText("Run").onClick(() => {
          this.runAsync(async () => {
            try {
              await runExportOntology(this.plugin);
            } catch (error) {
              const message = error instanceof Error ? error.message : "Unexpected error";
              new Notice(`Forge: ${message}`, 6000);
            }
          });
        })
      );

    // ── Overview options ───────────────────────────────────────────
    this.renderSectionHeading(el, "Overview Options");

    // Domain field
    const allFieldsForDomain = this.plugin.schemaCache.getFrontmatterFieldNames();
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
      .setDesc("Filename for the dataview dashboard note created on first export run. Leave blank to use 'vault-dashboard'.")
      .addText((t) =>
        t
          .setPlaceholder("Vault-dashboard")
          .setValue(this.plugin.settings.exportDashboardName)
          .onChange((v) => {
            this.runAsync(async () => {
              this.plugin.settings.exportDashboardName = v.trim();
              await this.plugin.saveSettings();
            });
          })
      );

    // Private notes
    new Setting(el)
      .setName("Private notes")
      .setDesc("When enabled, notes marked as private are counted separately in the overview and excluded from vault-meta.json.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.exportPrivateEnabled).onChange((v) => {
          this.runAsync(async () => {
            this.plugin.settings.exportPrivateEnabled = v;
            await this.plugin.saveSettings();
            this.renderTab();
          });
        })
      );

    if (this.plugin.settings.exportPrivateEnabled) {
      const allFieldsForPrivate = this.plugin.schemaCache.getFrontmatterFieldNames();
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
    this.renderSectionHeading(el, "Ontology Filter");
    el.createEl("p", {
      text: "Select which notes are included in the ontology export by choosing a schema field and the values to match.",
      cls: "setting-item-description",
    });

    new Setting(el)
      .setName("Reload from schema")
      .setDesc("Refresh field and value lists from the current schema.")
      .addButton((btn) =>
        btn.setButtonText("Reload").onClick(() => {
          this.runAsync(async () => {
            await this.plugin.schemaCache.refresh();
            new Notice("Forge: schema reloaded.");
            this.renderTab();
          });
        })
      );

    // Field selector — all required + optional fields from schema, no hardcoding
    const allFields = this.plugin.schemaCache.getFrontmatterFieldNames();

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
        this.renderTab();
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
    this.renderSectionHeading(el, "Relationship Extraction");

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
          .onChange((v) => {
            this.runAsync(async () => {
              this.plugin.settings.exportRelationshipHeading = v.trim();
              await this.plugin.saveSettings();
            });
          })
      );

    // ── Exclude folders ────────────────────────────────────────────
    this.renderSectionHeading(el, "Exclude Folders");
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

    const setCheckedMap = new Map<string, (checked: boolean) => void>();

    const renderChips = () => {
      chipStrip.empty();
      selected.forEach((val) => {
        const chip = chipStrip.createDiv({ cls: "forge-ms-chip" });
        chip.createSpan({ text: val });
        const rm = chip.createSpan({ cls: "forge-ms-chip-rm", text: "×" });
        rm.addEventListener("click", (e) => {
          this.runAsync(async () => {
            e.stopPropagation();
            const idx = selected.indexOf(val);
            if (idx > -1) selected.splice(idx, 1);
            setCheckedMap.get(val)?.(false);
            renderChips();
            updateTrigger();
            await this.plugin.saveSettings();
          });
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
      setCheckedMap.set(folderPath, setChecked);
      setChecked(selected.includes(folderPath));

      row.addEventListener("click", () => {
        this.runAsync(async () => {
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
    activeDocument.addEventListener("click", onOutside);

    const observer = new MutationObserver(() => {
      if (!activeDocument.contains(wrap)) {
        activeDocument.removeEventListener("click", onOutside);
        observer.disconnect();
      }
    });
    observer.observe(activeDocument.body, { childList: true, subtree: true });

    renderChips();
    updateTrigger();
  }

  /** Folder multi-select for shape repair scope — same pattern as renderFolderMultiSelect. */
  private renderShapeRepairFolderMultiSelect(el: HTMLElement): void {
    const selected = this.plugin.settings.shapeRepairFolders;

    const wrap = el.createDiv({ cls: "forge-multiselect" });
    const chipStrip = wrap.createDiv({ cls: "forge-ms-chips" });

    const setCheckedMap = new Map<string, (checked: boolean) => void>();

    const renderChips = () => {
      chipStrip.empty();
      selected.forEach((val) => {
        const chip = chipStrip.createDiv({ cls: "forge-ms-chip" });
        chip.createSpan({ text: val });
        const rm = chip.createSpan({ cls: "forge-ms-chip-rm", text: "×" });
        rm.addEventListener("click", (e) => {
          this.runAsync(async () => {
            e.stopPropagation();
            const idx = selected.indexOf(val);
            if (idx > -1) selected.splice(idx, 1);
            setCheckedMap.get(val)?.(false);
            renderChips();
            updateTrigger();
            await this.plugin.saveSettings();
          });
        });
      });
    };

    const trigger = wrap.createDiv({ cls: "forge-ms-trigger" });
    const triggerLabel = trigger.createSpan({ cls: "forge-ms-trigger-label" });
    const triggerIcon = trigger.createSpan({ cls: "forge-ms-trigger-icon", text: "▾" });

    const updateTrigger = () => {
      triggerLabel.setText(
        selected.length === 0 ? "Add folders…" : `${selected.length} folder(s) selected`
      );
    };

    const panel = wrap.createDiv({ cls: "forge-ms-panel forge-ms-hidden" });

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
      setCheckedMap.set(folderPath, setChecked);
      setChecked(selected.includes(folderPath));

      row.addEventListener("click", () => {
        this.runAsync(async () => {
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
    });

    let open = false;
    const togglePanel = (e: MouseEvent) => {
      e.stopPropagation();
      open = !open;
      panel.toggleClass("forge-ms-hidden", !open);
      triggerIcon.setText(open ? "▴" : "▾");
    };
    trigger.addEventListener("click", togglePanel);

    const onOutside = (e: MouseEvent) => {
      if (!wrap.contains(e.target as Node)) {
        open = false;
        panel.addClass("forge-ms-hidden");
        triggerIcon.setText("▾");
      }
    };
    activeDocument.addEventListener("click", onOutside);

    const observer = new MutationObserver(() => {
      if (!activeDocument.contains(wrap)) {
        activeDocument.removeEventListener("click", onOutside);
        observer.disconnect();
      }
    });
    observer.observe(activeDocument.body, { childList: true, subtree: true });

    renderChips();
    updateTrigger();
  }

  /** Folder multi-select for shape lint scope. */
  private renderShapeLintFolderMultiSelect(el: HTMLElement): void {
    const selected = this.plugin.settings.shapeLintFolders;

    const wrap = el.createDiv({ cls: "forge-multiselect" });
    const chipStrip = wrap.createDiv({ cls: "forge-ms-chips" });

    const setCheckedMap = new Map<string, (checked: boolean) => void>();

    const renderChips = () => {
      chipStrip.empty();
      selected.forEach((val) => {
        const chip = chipStrip.createDiv({ cls: "forge-ms-chip" });
        chip.createSpan({ text: val });
        const rm = chip.createSpan({ cls: "forge-ms-chip-rm", text: "×" });
        rm.addEventListener("click", (e) => {
          this.runAsync(async () => {
            e.stopPropagation();
            const idx = selected.indexOf(val);
            if (idx > -1) selected.splice(idx, 1);
            setCheckedMap.get(val)?.(false);
            renderChips();
            updateTrigger();
            await this.plugin.saveSettings();
          });
        });
      });
    };

    const trigger = wrap.createDiv({ cls: "forge-ms-trigger" });
    const triggerLabel = trigger.createSpan({ cls: "forge-ms-trigger-label" });
    const triggerIcon = trigger.createSpan({ cls: "forge-ms-trigger-icon", text: "▾" });

    const updateTrigger = () => {
      triggerLabel.setText(
        selected.length === 0 ? "Add folders…" : `${selected.length} folder(s) selected`
      );
    };

    const panel = wrap.createDiv({ cls: "forge-ms-panel forge-ms-hidden" });

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
      setCheckedMap.set(folderPath, setChecked);
      setChecked(selected.includes(folderPath));

      row.addEventListener("click", () => {
        this.runAsync(async () => {
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
    });

    let open = false;
    const togglePanel = (e: MouseEvent) => {
      e.stopPropagation();
      open = !open;
      panel.toggleClass("forge-ms-hidden", !open);
      triggerIcon.setText(open ? "▴" : "▾");
    };
    trigger.addEventListener("click", togglePanel);

    const onOutside = (e: MouseEvent) => {
      if (!wrap.contains(e.target as Node)) {
        open = false;
        panel.addClass("forge-ms-hidden");
        triggerIcon.setText("▾");
      }
    };
    activeDocument.addEventListener("click", onOutside);

    const observer = new MutationObserver(() => {
      if (!activeDocument.contains(wrap)) {
        activeDocument.removeEventListener("click", onOutside);
        observer.disconnect();
      }
    });
    observer.observe(activeDocument.body, { childList: true, subtree: true });

    renderChips();
    updateTrigger();
  }

  // ── Shapes ──────────────────────────────────────────────────────────────

  private renderShapes(el: HTMLElement): void {
    const s = this.plugin.settings;

    // ── Enable ────────────────────────────────────────────────────
    new Setting(el)
      .setName("Enable vault shape engine")
      .setDesc("Enables shape note processing and template refinement.")
      .addToggle((t) =>
        t.setValue(s.shapesEnabled).onChange((v) => {
          this.runAsync(async () => {
            s.shapesEnabled = v;
            await this.plugin.saveSettings();
            this.renderTab();
          });
        })
      );

    if (!s.shapesEnabled) return;

    // ── Folders ───────────────────────────────────────────────────
    this.renderSectionHeading(el, "Folders");

    this.renderFolderPicker(
      el,
      "Shapes folder",
      "Folder containing shape notes (type: shape, with a # Structure section).",
      "shapesFolder",
      "System/Shapes"
    );

    new Setting(el)
      .setName("Include subfolders")
      .setDesc(
        "When enabled, shape notes in subfolders of the shapes folder are included " +
        "in refinement, lint, and repair. Off by default to preserve existing behavior."
      )
      .addToggle((t) =>
        t.setValue(s.shapeIncludeSubfolders ?? false).onChange((v) => {
          this.runAsync(async () => {
            s.shapeIncludeSubfolders = v;
            await this.plugin.saveSettings();
          });
        })
      );

    // ── Field Configuration ───────────────────────────────────────
    this.renderSectionHeading(el, "Template Field Configuration");
    el.createEl("p", {
      text: "Configure which schema fields appear in generated templates and what value each gets. " +
            "The type target field and configured date fields are excluded — they are set automatically at runtime.",
      cls: "setting-item-description",
    });

    this.renderShapeTypeTargetField(el);

    this.renderShapeDateField(
      el,
      "Created field",
      "Schema date field stamped when a template is first created. Set to none to skip.",
      "shapeCreatedField"
    );

    this.renderShapeDateField(
      el,
      "Updated field",
      "Schema date field stamped every time a template is written. Set to none to skip.",
      "shapeUpdatedField"
    );

    this.renderShapeFieldConfigurator(el);

    // ── Template Refinement ───────────────────────────────────────
    this.renderSectionHeading(el, "Template Refinement");
    el.createEl("p", {
      text: "When enabled, the 'Refine Shape Templates' command reads each shape note " +
            "and writes or updates the corresponding template note.",
      cls: "setting-item-description",
    });

    new Setting(el)
      .setName("Enable template refinement")
      .setDesc("Allow the refine shape templates command to create and update template notes.")
      .addToggle((t) =>
        t.setValue(s.shapeRefinementEnabled).onChange((v) => {
          this.runAsync(async () => {
            s.shapeRefinementEnabled = v;
            await this.plugin.saveSettings();
            this.renderTab();
          });
        })
      );

    if (s.shapeRefinementEnabled) {
      this.renderFolderPicker(
        el,
        "Templates folder",
        "Folder where template notes are written.",
        "shapeTemplatesFolder",
        "System/Templates"
      );

      new Setting(el)
        .setName("Inject relationship headings from schema")
        .setDesc(
          "When enabled, refinement injects relationship headings into templates " +
          "based on schema.ontology.relationships. Only relationships where the shape " +
          "type participates as a source (or flexible member) are included."
        )
        .addToggle((t) =>
          t.setValue(s.shapeInjectRelationships ?? false).onChange((v) => {
            this.runAsync(async () => {
              s.shapeInjectRelationships = v;
              await this.plugin.saveSettings();
              this.renderTab();
            });
          })
        );

      if (s.shapeInjectRelationships) {
        new Setting(el)
          .setName("Relationship parent heading")
          .setDesc("The heading under which relationship subheadings are grouped.")
          .addText((t) =>
            t.setValue(s.shapeRelationshipHeading ?? "Related").onChange((v) => {
              this.runAsync(async () => {
                s.shapeRelationshipHeading = v.trim() || "Related";
                await this.plugin.saveSettings();
              });
            })
          );

        new Setting(el)
          .setName("Relationship heading level")
          .setDesc("Heading level for the parent relationship heading. Subheadings are always one level below.")
          .addDropdown((dd) => {
            dd.addOption("1", "H1");
            dd.addOption("2", "H2");
            dd.addOption("3", "H3");
            dd.setValue(String(s.shapeRelationshipHeadingLevel ?? 2));
            dd.onChange((v) => {
              this.runAsync(async () => {
                s.shapeRelationshipHeadingLevel = parseInt(v, 10);
                await this.plugin.saveSettings();
              });
            });
          });

        new Setting(el)
          .setName("Relationship injection position")
          .setDesc(
            "Inject: add missing headings under the existing parent heading in the structure. " +
            "Falls back to append if the parent heading is not found. " +
            "Append: always add the relationship section at the end of the template."
          )
          .addDropdown((dd) => {
            dd.addOption("append", "Append at end");
            dd.addOption("inject", "Inject into existing heading");
            dd.setValue(s.shapeRelationshipPosition ?? "append");
            dd.onChange((v) => {
              this.runAsync(async () => {
                s.shapeRelationshipPosition = v as "inject" | "append";
                await this.plugin.saveSettings();
              });
            });
          });
      }

      new Setting(el)
        .setName("Run refinement")
        .setDesc("Process all shape notes and write or update template notes now.")
        .addButton((btn) =>
          btn.setButtonText("Refine shape templates").setCta().onClick(() => {
            this.runAsync(async () => {
              const { runRefineShapes } = await import("./commands/refine-shapes");
              await runRefineShapes(this.plugin);
            });
          })
        );
    }

    // ── Shape Lint ────────────────────────────────────────────────
    this.renderSectionHeading(el, "Shape Lint");
    el.createEl("p", {
      text: "When enabled, lint runs validate note heading structure against the " +
            "corresponding shape template. Severity follows the Lint tab strict mode setting.",
      cls: "setting-item-description",
    });

    new Setting(el)
      .setName("Enable shape heading validation")
      .setDesc(
        "Checks that notes matching a shape have all required headings, " +
        "in the correct order, with no empty sections."
      )
      .addToggle((t) =>
        t.setValue(s.shapeLintEnabled).onChange((v) => {
          this.runAsync(async () => {
            s.shapeLintEnabled = v;
            await this.plugin.saveSettings();
            this.renderTab();
          });
        })
      );

    if (s.shapeLintEnabled) {
      new Setting(el)
        .setName("Strict template matching")
        .setDesc(
          "Also flag headings that are not defined in the matching shape template. " +
          "When off, Shape Lint checks required template headings and heading levels, but ignores extra headings."
        )
        .addToggle((t) =>
          t.setValue(s.shapeLintStrictMode).onChange((v) => {
            this.runAsync(async () => {
              s.shapeLintStrictMode = v;
              await this.plugin.saveSettings();
            });
          })
        );

      new Setting(el)
        .setName("Exclude inbox folder")
        .setDesc(
          "Skip notes in the configured inbox folder during shape lint so draft structures can evolve before heading rules are enforced."
        )
        .addToggle((t) =>
          t.setValue(s.shapeLintExcludeInboxFolder).onChange((v) => {
            this.runAsync(async () => {
              s.shapeLintExcludeInboxFolder = v;
              await this.plugin.saveSettings();
            });
          })
        );

      new Setting(el)
        .setName("Lint scope")
        .setDesc("Validate all notes in the vault, or limit to selected folders only.")
        .addDropdown((dd) => {
          dd.addOption("all", "All vault notes");
          dd.addOption("folder", "Selected folders only");
          dd.setValue(s.shapeLintScope ?? "all");
          dd.onChange((v) => {
            this.runAsync(async () => {
              s.shapeLintScope = v as "all" | "folder";
              await this.plugin.saveSettings();
              this.renderTab();
            });
          });
        });

      if (s.shapeLintScope === "folder") {
        new Setting(el)
          .setName("Lint folders")
          .setDesc("Only notes in these folders will be evaluated for shape heading validation.");
        this.renderShapeLintFolderMultiSelect(el);
      }
    }

    // ── Shape Repair ──────────────────────────────────────────────
    this.renderSectionHeading(el, "Shape Repair");
    el.createEl("p", {
      text: "When enabled, the 'Run Shape Repair' command corrects heading drift in notes " +
            "by adding missing headings and reordering sections to match the template. " +
            "No content is ever deleted. A backup is written before each file is modified.",
      cls: "setting-item-description",
    });

    new Setting(el)
      .setName("Enable shape repair")
      .setDesc("Allow the run shape repair command to modify notes.")
      .addToggle((t) =>
        t.setValue(s.shapeRepairEnabled).onChange((v) => {
          this.runAsync(async () => {
            s.shapeRepairEnabled = v;
            await this.plugin.saveSettings();
            this.renderTab();
          });
        })
      );

    if (s.shapeRepairEnabled) {
      new Setting(el)
        .setName("Repair scope")
        .setDesc("Repair all notes in the vault, or limit to selected folders only.")
        .addDropdown((dd) => {
          dd.addOption("all", "All vault notes");
          dd.addOption("folder", "Selected folders only");
          dd.setValue(s.shapeRepairScope ?? "all");
          dd.onChange((v) => {
            this.runAsync(async () => {
              s.shapeRepairScope = v as "all" | "folder";
              await this.plugin.saveSettings();
              this.renderTab();
            });
          });
        });

      if (s.shapeRepairScope === "folder") {
        new Setting(el)
          .setName("Repair folders")
          .setDesc("Notes in these folders will be evaluated for shape repair.");
        this.renderShapeRepairFolderMultiSelect(el);
      }

      this.renderFolderPicker(
        el,
        "Repair runs folder",
        "Folder where shape repair run notes are written.",
        "shapeRepairRunsFolder",
        "System/Exports/ShapeRepairRuns"
      );

      new Setting(el)
        .setName("Repair file links")
        .setDesc(
          "Wrap file paths in [[wikilinks]] in repair run notes so you can navigate directly to affected files."
        )
        .addToggle((t) =>
          t.setValue(s.shapeRepairFileLinks).onChange((v) => {
            this.runAsync(async () => {
              s.shapeRepairFileLinks = v;
              await this.plugin.saveSettings();
            });
          })
        );

      new Setting(el)
        .setName("Repair history retention")
        .setDesc("Maximum number of repair run entries to keep in shape-repair-history.json.")
        .addSlider((sl) =>
          sl
            .setLimits(5, 50, 5)
            .setValue(s.shapeRepairHistoryRetentionCount)
            .setDynamicTooltip()
            .onChange((v) => {
              this.runAsync(async () => {
                s.shapeRepairHistoryRetentionCount = v;
                await this.plugin.saveSettings();
              });
            })
        );

      new Setting(el)
        .setName("Run shape repair")
        .setDesc("Add missing headings and reorder sections to match templates now.")
        .addButton((btn) =>
          btn.setButtonText("Dry run").onClick(() => {
            this.runAsync(async () => {
              const { runShapeRepair } = await import("./commands/shape-repair");
              await runShapeRepair(this.plugin, true);
            });
          })
        )
        .addButton((btn) =>
          btn.setButtonText("Run shape repair").setCta().onClick(() => {
            this.runAsync(async () => {
              const { runShapeRepair } = await import("./commands/shape-repair");
              await runShapeRepair(this.plugin, false);
            });
          })
        );
    }
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
            ...schema.frontmatter.required.map((f) => f.name),
            ...schema.frontmatter.optional.map((f) => f.name),
          ];
          for (const name of allFields) {
            dd.addOption(name, name);
          }
          const current = s.shapeTypeTargetField || "type";
          dd.setValue(allFields.includes(current) ? current : (allFields[0] ?? ""));
        } else {
          dd.setValue(s.shapeTypeTargetField || "");
        }

        dd.onChange((v) => {
          this.runAsync(async () => {
            s.shapeTypeTargetField = v;
            await this.plugin.saveSettings();
            this.renderTab();
          });
        });
      });
  }

  private renderShapeDateField(
    el: HTMLElement,
    name: string,
    desc: string,
    settingKey: "shapeCreatedField" | "shapeUpdatedField"
  ): void {
    const s = this.plugin.settings;

    new Setting(el)
      .setName(name)
      .setDesc(desc)
      .addDropdown(async (dd) => {
        dd.addOption("", "— none —");

        const schema = await loadSchema(this.plugin.app, s);
        if (schema) {
          const dateFields = [
            ...schema.frontmatter.required,
            ...schema.frontmatter.optional,
          ]
            .filter((f) => f.type === "date")
            .map((f) => f.name);

          for (const fieldName of dateFields) {
            dd.addOption(fieldName, fieldName);
          }

          const current = s[settingKey] ?? "";
          dd.setValue(dateFields.includes(current) ? current : "");
        } else {
          dd.setValue(s[settingKey] ?? "");
        }

        dd.onChange((v) => {
          this.runAsync(async () => {
            s[settingKey] = v;
            await this.plugin.saveSettings();
            this.renderTab();
          });
        });
      });
  }

  private renderShapeFieldConfigurator(el: HTMLElement): void {
    const s = this.plugin.settings;

    const container = el.createDiv({ cls: "forge-shape-fields" });

    // Load schema and render field rows
    this.runAsync(async () => {
      const schema = await loadSchema(this.plugin.app, s);
      if (!schema) {
        container.createEl("p", {
          text: "Could not load schema. Ensure schema.md exists and is valid.",
          cls: "setting-item-description",
        });
        return;
      }

      const allFields = [
        ...schema.frontmatter.required,
        ...schema.frontmatter.optional,
      ];

      const order = s.frontmatterFieldOrder;
      const ordered = order.length > 0
        ? [
            ...order
              .map((name) => allFields.find((f) => f.name === name))
              .filter((f): f is NonNullable<typeof f> => f != null),
            ...allFields.filter((f) => !order.includes(f.name)),
          ]
        : allFields;

      const runtimeFields = new Set([
        s.shapeTypeTargetField,
        s.shapeCreatedField,
        s.shapeUpdatedField,
      ].filter(Boolean));
      const configurable = ordered.filter((f) => !runtimeFields.has(f.name));

      if (configurable.length === 0) {
        container.createEl("p", {
          text: "No configurable fields found in schema.",
          cls: "setting-item-description",
        });
        return;
      }

      const header = container.createDiv({ cls: "forge-shape-field-header" });
      header.createSpan({ text: "Include", cls: "forge-shape-field-col-include" });
      header.createSpan({ text: "Field", cls: "forge-shape-field-col-name" });
      header.createSpan({ text: "Value", cls: "forge-shape-field-col-value" });

      for (const field of configurable) {
        this.renderShapeFieldRow(container, field, s);
      }

      const runtimeNote = [
        "The type target field is always set to the shape name.",
        s.shapeCreatedField ? `'${s.shapeCreatedField}' is stamped on create.` : null,
        s.shapeUpdatedField ? `'${s.shapeUpdatedField}' is stamped on every write.` : null,
        "These fields are excluded from this list.",
      ].filter(Boolean).join(" ");

      container.createEl("p", {
        text: runtimeNote,
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

    checkbox.addEventListener("change", () => {
      this.runAsync(async () => {
        valueControl.setEnabled(checkbox.checked);
        await save();
      });
    });
    valueControl.setEnabled(existing.include);
    valueControl.onChanged(() => {
      this.runAsync(save);
    });
  }

  private renderSectionHeading(el: HTMLElement, title: string): void {
    new Setting(el).setName(title).setHeading();
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
        if (val === this.stringifyUiValue(currentValue)) opt.selected = true;
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
      select.createEl("option", { value: "true", text: "True" });
      select.createEl("option", { value: "false", text: "False" });
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
        attr: { placeholder: "Value1, value2" },
      });
      const arr = Array.isArray(currentValue)
        ? currentValue.filter((value): value is string => typeof value === "string").join(", ")
        : this.stringifyUiValue(currentValue);
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
      attr: { placeholder: field.type === "date" ? "Yyyy-MM-dd" : "" },
    });
    input.value = this.stringifyUiValue(currentValue);
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
    settingKey: StringSettingKey,
    fallback: string,
    _schemaNote = false   // reserved for future schema-specific behaviour
  ): void {
    const current = String(this.plugin.settings[settingKey] ?? fallback);

    new Setting(el)
      .setName(name)
      .setDesc(`${desc} Current: ${current}`)
      .addButton((btn) =>
        btn.setButtonText("Choose").onClick(() => {
          new FolderSuggestModal(this.app, (folder) => {
            this.runAsync(async () => {
              this.setStringSetting(settingKey, folder.path || fallback);
              await this.plugin.saveSettings();
              this.renderTab();
            });
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
          new MarkdownFileSuggestModal(this.app, (file) => {
            this.runAsync(async () => {
              const lastSlash = file.path.lastIndexOf("/");
              this.plugin.settings.schemaNoteFolder =
                lastSlash >= 0 ? file.path.substring(0, lastSlash) : "";
              this.plugin.settings.schemaNoteFile =
                lastSlash >= 0 ? file.path.substring(lastSlash + 1) : file.path;
              await this.plugin.saveSettings();
              this.renderTab();
            });
          }).open();
        })
      );
  }

  /** Schema version field settings — location picker + schema-driven field dropdown. */
  private renderSchemaVersionSettings(el: HTMLElement): void {
    const s = this.plugin.settings;

    new Setting(el)
      .setName("Version field location")
      .setDesc("Where the schema version is stored — inline metadata (key:: Value) or frontmatter.")
      .addDropdown((dd) =>
        dd
          .addOption("inline", "Inline (key:: Value)")
          .addOption("frontmatter", "Frontmatter")
          .setValue(s.schemaVersionLocation ?? "inline")
          .onChange((v) => {
            this.runAsync(async () => {
              s.schemaVersionLocation = v as "frontmatter" | "inline";
              await this.plugin.saveSettings();
              this.renderTab();
            });
          })
      );

    const fieldNames = s.schemaVersionLocation === "frontmatter"
      ? this.plugin.schemaCache.getFrontmatterFieldNames()
      : this.plugin.schemaCache.getInlineFieldNames();

    this.renderSchemaFieldDropdown(
      el,
      "Version field",
      `The ${s.schemaVersionLocation === "frontmatter" ? "frontmatter" : "inline"} field that holds the schema version.`,
      fieldNames,
      s.schemaVersionField ?? "version",
      async (v) => {
        s.schemaVersionField = v;
        await this.plugin.saveSettings();
      }
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
          new PatchFileSuggestModal(this.app, (file) => {
            this.runAsync(async () => {
              this.plugin.settings.patchDefaultFile = file.path;
              await this.plugin.saveSettings();
              this.renderTab();
            });
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
      fields.forEach((f) => {
        d.addOption(f, f);
      });
      d.setValue(currentValue).onChange((v) => {
        this.runAsync(async () => {
          await onChange(v);
        });
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
        rm.addEventListener("click", (e) => {
          this.runAsync(async () => {
            e.stopPropagation();
            const idx = selected.indexOf(val);
            if (idx > -1) selected.splice(idx, 1);
            renderChips();
            updateTrigger();
            await onChange([...selected]);
          });
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

      row.addEventListener("click", () => {
        this.runAsync(async () => {
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
    activeDocument.addEventListener("click", onOutside);

    // Cleanup listener when element is removed
    const observer = new MutationObserver(() => {
      if (!activeDocument.contains(wrap)) {
        activeDocument.removeEventListener("click", onOutside);
        observer.disconnect();
      }
    });
    observer.observe(activeDocument.body, { childList: true, subtree: true });

    renderChips();
    updateTrigger();
  }

  /** Styles are now in styles.css — this method is kept for backward compatibility. */
  private injectStyles(): void {}
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
    this.setPlaceholder("Choose a Markdown note...");
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
