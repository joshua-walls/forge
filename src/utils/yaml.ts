import { stringifyYaml } from "obsidian";

const stringifyYamlTyped = stringifyYaml as (value: unknown) => string;

export function serializeYaml(value: unknown): string {
  return stringifyYamlTyped(value);
}

export function trimTrailingWhitespace(value: string): string {
  return value.replace(/\s+$/u, "");
}

export function trimLineEnd(value: string): string {
  return value.replace(/[ \t]+$/u, "");
}
