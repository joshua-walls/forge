import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
// JSON is a YAML subset. Keep serialization at the mocked host boundary;
// production uses Obsidian's parser/stringifier, not a new test dependency.
const yaml = { dump: (value) => `${JSON.stringify(value)}\n`, load: JSON.parse };
const commandPath = require.resolve("../.tmp-test/src/commands/repair.js");
const commandRequire = createRequire(commandPath);
const { createForgeSettings } = require("../.tmp-test/src/config/settings.js");
const { getVaultPaths } = require("../.tmp-test/src/vault/paths.js");
const schemaModel = require("../.tmp-test/src/schemas/schema.js");

// Obsidian adapter double. These tests drive the actual modal callbacks and
// patch writer; they do not measure browser layout or native keyboard behavior.
class Element {
  children = [];
  listeners = new Map();
  value = "";
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.text = options.text ?? "";
    this.classes = new Set((options.cls ?? "").split(" "));
  }
  createEl(tag, options) { const child = new Element(tag, options); this.children.push(child); return child; }
  createDiv(cls) { return this.createEl("div", { cls }); }
  createSpan(options) { return this.createEl("span", options); }
  empty() { this.children = []; }
  addClass(cls) { this.classes.add(cls); }
  removeClass(cls) { this.classes.delete(cls); }
  toggleClass(cls, enabled) { enabled ? this.addClass(cls) : this.removeClass(cls); }
  setAttribute() {}
  addEventListener(event, handler) { this.listeners.set(event, handler); }
  click() { this.listeners.get("click")?.(); }
  all() { return this.children.flatMap((child) => [child, ...child.all()]); }
  querySelector(tag) { return this.all().find((child) => child.tag === tag); }
}

class Setting {
  constructor(parent) {
    this.settingEl = parent.createDiv("setting-item");
    this.infoEl = this.settingEl.createDiv("setting-item-info");
    this.nameEl = this.infoEl.createDiv("setting-item-name");
    this.descEl = this.infoEl.createDiv("setting-item-description");
    this.controlEl = this.settingEl.createDiv("setting-item-control");
  }
  setName(name) { this.nameEl.text = name; return this; }
  setDesc(desc) { this.descEl.text = desc; return this; }
  addText(callback) { return this.addControl("input", callback); }
  addDropdown(callback) { return this.addControl("select", callback); }
  addControl(tag, callback) {
    const input = this.controlEl.createEl(tag);
    const control = {
      inputEl: input,
      setPlaceholder: () => control,
      setValue: (value) => { input.value = value; return control; },
      addOption: () => control,
      onChange: (handler) => { input.change = (value) => { input.value = value; handler(value); }; return control; },
    };
    callback(control);
    return this;
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

async function openRepair({ ctime = new Date(2020, 0, 2, 0, 15).getTime(), frontmatter = {}, cache = frontmatter, fields = ["created"], readError = false, raw, readGate, mobile = true } = {}) {
  const opened = [];
  const writes = [];
  const notices = [];
  class TFile { constructor(path) { this.path = path; this.stat = { ctime }; } }
  class Modal {
    constructor(app) { this.app = app; this.contentEl = new Element(); this.modalEl = new Element(); }
    open() { opened.push(this); this.onOpen(); }
    close() { this.onClose(); }
  }
  const settings = createForgeSettings({ patchDefaultFile: "Disposable/patch.md" });
  const paths = getVaultPaths(settings);
  const target = new TFile("Fixtures/Missing.md");
  const report = new TFile(paths.lintReportJson);
  const issues = fields.map((field) => ({ file: target.path, rule: "required_field", severity: "error", message: `Missing required field: '${field}'` }));
  const schema = {
    version: "test", frontmatter: { optional: [], required: fields.map((name) => ({ name, type: "date", severity: "error" })) },
    tag_rules: { allowed_namespaces: [] },
  };
  const app = {
    metadataCache: { getCache: () => cache === null ? null : { frontmatter: cache } },
    vault: {
      getAbstractFileByPath: (path) => path === target.path ? target : path === report.path ? report : null,
      read: async (file) => {
        if (file === report) return JSON.stringify({ results: issues });
        assert.equal(file, target);
        if (readGate) await readGate;
        if (readError) throw new Error("Fixture read failed");
        if (raw !== undefined) return raw;
        return `---\n${yaml.dump(frontmatter)}---\nFixture body\n`;
      },
      create: async (path, content) => { writes.push({ path, content }); },
      modify: () => assert.fail("Existing files must not be modified by this harness"),
    },
  };
  const exports = {};
  const obsidian = { Modal, Setting, TFile, Platform: { isMobile: mobile }, Notice: class { constructor(text) { notices.push(text); } }, parseYaml: (raw) => raw.trim() ? yaml.load(raw) : undefined };
  runInNewContext(readFileSync(commandPath, "utf8"), {
    exports, console,
    require: (id) => {
      if (id === "obsidian") return obsidian;
      if (id === "../utils/schema") return { ...schemaModel, loadSchema: async () => schema };
      if (id === "../utils/files") return { todayString: () => "2026-11-08", ensureFolder: async () => {} };
      if (id === "../utils/yaml") return { serializeYaml: yaml.dump };
      if (id === "./apply-patch") return { runApplyPatch: () => assert.fail("Must never apply repairs") };
      return commandRequire(id);
    },
  });
  await exports.runVaultRepair({ app, settings });
  const button = (modal, text) => {
    const result = modal.contentEl.all().find((el) => el.tag === "button" && el.text === text);
    assert.ok(result, `Missing button: ${text}`);
    return result;
  };
  button(opened.at(-1), "Review selected").click();
  await settle();
  const modal = opened.at(-1);
  const input = (field) => {
    const row = modal.contentEl.all().find((el) => el.classes.has("setting-item") && el.all().some((child) => child.text === field || child.text.startsWith(`${field} (`)));
    return row?.querySelector("input");
  };
  const finish = async () => {
    const fix = modal.contentEl.all().find((el) => el.tag === "button" && ["Fix & Continue", "Skip"].includes(el.text));
    assert.ok(fix);
    fix.click();
    await settle();
    const write = modal.contentEl.all().find((el) => el.text === "Write patch only");
    if (!write) return [];
    write.click();
    await settle();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, "Disposable/patch.md");
    return yaml.load(writes[0].content.match(/```yaml\n([\s\S]*?)\n```/u)[1]).operations;
  };
  return { modal, input, finish, notices };
}

describe("Vault Repair date input to patch", () => {
  it("prefills missing created from metadata and retains the final edited date", async () => {
    const review = await openRepair();
    assert.equal(review.input("created").value, "2020-01-02");
    review.input("created").change("1999-12-31");
    assert.deepEqual(await review.finish(), [{ op: "set_field", target: "Fixtures/Missing.md", field: "created", value: "1999-12-31" }]);
  });
  it("does not invent today or emit a created operation for unavailable metadata", async () => {
    for (const ctime of [0, -1, NaN, Infinity, 1e20]) {
      const review = await openRepair({ ctime });
      assert.equal(review.input("created").value, "");
      assert.deepEqual(await review.finish(), []);
    }
  });
  it("lets the user clear a suggestion without restoring it", async () => {
    const review = await openRepair();
    review.input("created").change("");
    assert.deepEqual(await review.finish(), []);
  });
  it("preserves an existing valid created date despite stale findings or absent cache", async () => {
    for (const cache of [null, {}, { created: "" }]) {
      const review = await openRepair({ frontmatter: { created: "2010-05-06" }, cache });
      assert.equal(review.input("created"), undefined);
      assert.deepEqual(await review.finish(), []);
    }
  });
  it("uses current note content when cache incorrectly reports a created value", async () => {
    const review = await openRepair({ cache: { created: "2010-05-06" } });
    assert.equal(review.input("created").value, "2020-01-02");
  });
  it("does not offer a created repair when the note cannot be read", async () => {
    const review = await openRepair({ readError: true });
    assert.equal(review.input("created"), undefined);
    assert.deepEqual(await review.finish(), []);
  });
  it("handles absent frontmatter and empty created values", async () => {
    for (const frontmatter of [{ created: null }, { created: "" }, { created: "  " }]) {
      const review = await openRepair({ frontmatter });
      assert.equal(review.input("created").value, "2020-01-02");
    }
    for (const raw of ["# Note without frontmatter\n", "---\n\n---\n"]) {
      const review = await openRepair({ raw });
      assert.equal(review.input("created").value, "2020-01-02");
    }
  });
  it("skips created when frontmatter is malformed", async () => {
    for (const raw of ["---\ncreated: [\n---\n", "---\ncreated: missing delimiter", "---\n- list\n---\n"]) {
      const review = await openRepair({ raw });
      assert.equal(review.input("created"), undefined);
      assert.deepEqual(await review.finish(), []);
    }
  });
  it("does not repopulate a closed modal after a pending read completes", async () => {
    let release;
    const readGate = new Promise((resolve) => { release = resolve; });
    const review = await openRepair({ readGate });
    review.modal.close();
    release();
    await settle();
    assert.equal(review.modal.contentEl.children.length, 0);
  });
  it("keeps input nodes stable while typing and puts actions outside the scrolling body", async () => {
    const review = await openRepair();
    const input = review.input("created");
    for (const value of ["1", "1999-", "1999-12-31"]) {
      input.change(value);
      assert.equal(review.input("created"), input);
    }
    const body = review.modal.contentEl.children.find((el) => el.classes.has("forge-repair-body"));
    assert.ok(body);
    assert.ok(review.modal.contentEl.children.some((el) => el.classes.has("forge-repair-actions")));
    assert.equal(body.all().some((el) => el.text === "Fix & Continue"), false);
    assert.equal(body.all().find((el) => el.tag === "details").open, false);
    const desktop = await openRepair({ mobile: false });
    assert.equal(desktop.modal.contentEl.all().find((el) => el.tag === "details").open, true);
  });
  it("keeps updated and review_by defaults unchanged", async () => {
    const review = await openRepair({ fields: ["created", "updated", "review_by"] });
    assert.equal(review.input("updated").value, new Date().toLocaleDateString("en-CA"));
    assert.equal(review.input("review_by").value, new Date().toLocaleDateString("en-CA"));
  });
});
