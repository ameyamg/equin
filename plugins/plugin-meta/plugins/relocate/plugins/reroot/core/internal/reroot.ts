import {
  parseTree,
  printParseErrorCode,
  type Node as JsonNode,
  type ParseError,
} from "jsonc-parser";
import {
  asPluginId,
  type PluginId,
} from "@plugins/framework/plugins/plugin-id/core";

/**
 * Where `id` lands after moving `from` to `to`: `from` itself or one of its
 * descendants is re-rooted; anything else is null (not moved).
 */
export function movedPluginId(
  id: string,
  from: PluginId,
  to: PluginId,
): PluginId | null {
  if (id === from) return to;
  if (id.startsWith(`${from}.`)) return asPluginId(to + id.slice(from.length));
  return null;
}

// `${pluginId}:${id}` reorder entryKey; pluginId is the dot-id before the colon.
const ENTRY_KEY_RE = /^[a-z0-9][a-z0-9.-]*:[a-z0-9][a-z0-9.-]*$/i;

/** The plugin-id half of one reorder entry key, by its range in the file's text. */
export interface ReorderKeyRange {
  id: PluginId;
  /** Offset of the id's first character. */
  start: number;
  /** Offset just past its last character (the `:`). */
  end: number;
}

function parseJsonc(file: string, text: string): JsonNode {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { allowTrailingComma: true });
  if (!tree || errors.length > 0) {
    const e = errors[0];
    throw new Error(
      `reroot: ${file} is not valid JSONC${e ? ` (${printParseErrorCode(e.error)} at offset ${e.offset})` : ""}`,
    );
  }
  return tree;
}

/** Every string element of any `items` array, at any depth (reorder overrides
 *  nest groups whose own `items` hold entry keys too). */
function collectItemStrings(node: JsonNode, acc: JsonNode[]): void {
  if (node.type === "property") {
    const [key, value] = node.children ?? [];
    if (key?.value === "items" && value?.type === "array") {
      for (const el of value.children ?? []) {
        if (el.type === "string") acc.push(el);
        else collectItemStrings(el, acc);
      }
      return;
    }
    if (value) collectItemStrings(value, acc);
    return;
  }
  for (const child of node.children ?? []) collectItemStrings(child, acc);
}

/**
 * The plugin-id half of every reorder entry key (`"<pluginId>:<contribution
 * id>"`) in an `items` array of a config JSONC file, in text order. Throws on
 * a file that is not JSONC.
 */
export function reorderKeyRanges(
  file: string,
  text: string,
): ReorderKeyRange[] {
  if (!text.includes('"items"')) return [];
  const nodes: JsonNode[] = [];
  collectItemStrings(parseJsonc(file, text), nodes);
  const out: ReorderKeyRange[] = [];
  for (const node of nodes) {
    const key = node.value as string;
    if (!ENTRY_KEY_RE.test(key)) continue;
    const id = key.slice(0, key.indexOf(":"));
    // Inside the quotes; a key needs no escaping, so offsets map 1:1.
    const start = node.offset + 1;
    if (text.slice(start, start + id.length) !== id)
      throw new Error(
        `reroot: ${file}: the key at offset ${start} does not read "${id}"`,
      );
    out.push({ id: asPluginId(id), start, end: start + id.length });
  }
  return out;
}

/** `text` with every reorder key naming the moved subtree re-rooted. */
export function rerootReorderKeys(
  file: string,
  text: string,
  move: { from: PluginId; to: PluginId },
): string {
  const edits = reorderKeyRanges(file, text)
    .map((r) => ({ r, to: movedPluginId(r.id, move.from, move.to) }))
    .filter((e) => e.to !== null)
    .sort((a, b) => b.r.start - a.r.start);
  let out = text;
  for (const { r, to } of edits)
    out = out.slice(0, r.start) + to + out.slice(r.end);
  return out;
}
