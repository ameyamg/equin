import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { CONFIG_HASH_RE } from "./config-file";
import type { JsonValue } from "./types";

// A config file's text, read and re-stamped as text: what a rewrite that keeps
// the bytes it does not change (the config ledgers, a plugin move's re-stamp of
// committed overrides) reads a file through.

export function parseConfigText(file: string, text: string): JsonValue {
  const errors: ParseError[] = [];
  const body = text.replace(CONFIG_HASH_RE, "");
  const value = parseJsonc(body, errors, { allowTrailingComma: true }) as
    JsonValue | undefined;
  if (errors.length > 0 || value === undefined) {
    throw new Error(`config: ${file} is not valid JSONC`);
  }
  return value;
}

/** The hash a config file's first line records, or undefined when it has none. */
export function configTextHash(text: string): string | undefined {
  return CONFIG_HASH_RE.exec(text)?.[1];
}

/** `text` with its first-line `// @hash` header replaced by `hash`. */
export function withConfigTextHash(text: string, hash: string): string {
  return text.replace(CONFIG_HASH_RE, `// @hash ${hash}\n`);
}
