import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    ignores: [
      ".tmp-test/**",
      "coverage/**",
      "esbuild.config.mjs",
      "eslint.config.mjs",
      "dist/**",
      "main.js",
      "node_modules/**",
      "tests/**",
      "version-bump.mjs",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
      "obsidianmd/ui/sentence-case": "off",
    },
  },
]);
