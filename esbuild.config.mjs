import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import fs from "fs";
import path from "path";

const prod = process.argv[2] === "production";

/**
 * Dynamic doc folder plugin.
 *
 * Intercepts imports of the form:
 *   import docs from "vault-forge:docs";
 *   import examples from "vault-forge:examples";
 *
 * At build time, scans the corresponding folder for all .md files
 * and generates a virtual module that exports them as a Record<string, string>:
 *   { "START-HERE": "...", "COMMANDS": "...", ... }
 *
 * Adding, removing, or renaming a file in docs/ or examples/ is
 * automatically reflected on next build — no script changes needed.
 */
function docFolderPlugin() {
  return {
    name: "vault-forge-docs",
    setup(build) {
      // Resolve virtual module names
      build.onResolve({ filter: /^vault-forge:(docs|examples)$/ }, (args) => ({
        path: args.path,
        namespace: "vault-forge-docs",
      }));

      // Generate virtual module contents
      build.onLoad(
        { filter: /^vault-forge:(docs|examples)$/, namespace: "vault-forge-docs" },
        (args) => {
          const folderName = args.path.replace("vault-forge:", "");
          const folderPath = path.resolve(process.cwd(), folderName);

          if (!fs.existsSync(folderPath)) {
            return {
              contents: "export default {};",
              loader: "js",
            };
          }

          const files = fs.readdirSync(folderPath)
            .filter((f) => f.endsWith(".md"))
            .sort();

          // Generate: export default { "KEY": "...content..." }
          const entries = files.map((filename) => {
            const key = filename.replace(/\.md$/, "");
            const content = fs.readFileSync(path.join(folderPath, filename), "utf8");
            // Escape backticks and template literals in content
            const escaped = content
              .replace(/\\/g, "\\\\")
              .replace(/`/g, "\\`")
              .replace(/\$\{/g, "\\${");
            return `  ${JSON.stringify(key)}: \`${escaped}\``;
          });

          const contents = `export default {\n${entries.join(",\n")}\n};\n`;

          return { contents, loader: "js" };
        }
      );
    },
  };
}

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  plugins: [docFolderPlugin()],
  outfile: "main.js",
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
