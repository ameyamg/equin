import { beforeEach, describe, expect, test } from "bun:test";
import {
  committedFilesFromMap,
  computeHash,
  type ConfigPluginMove,
  type JsonValue,
} from "../../../core";
import {
  APPLIED_MOVES_FILE,
  applyPluginMoves,
  rerootMigrationKey,
} from "./plugin-moves";
import { APPLIED_CONFIG_MIGRATIONS_FILE } from "./config-migrations";
import { memoryConfigTree } from "./config-tree";
import {
  asPluginId,
  type PluginId,
} from "@plugins/framework/plugins/plugin-id/core";

let tree: ReturnType<typeof memoryConfigTree>;
let moves: { at: string; from: string; to: string }[];
/** The checkout's committed `config/`, by layer-relative path. */
let committed: Map<string, string>;
/** Plugin ids that are plugins of the tree (a reused old id). */
let plugins: Set<PluginId>;

beforeEach(() => {
  tree = memoryConfigTree();
  moves = [];
  committed = new Map();
  plugins = new Set();
});

function ledger(entries: { at: string; from: string; to: string }[]): void {
  moves = entries;
}

/** Apply the ledger to the namespace's tree, as a generation derive does. */
function apply(opts: { fresh?: boolean } = {}) {
  return applyPluginMoves({
    tree,
    // As codegen bakes them: the ledger key, and whether the old id is a
    // plugin again.
    moves: moves.map((m): ConfigPluginMove => ({
      key: `${m.at} ${m.from} ${m.to}`,
      from: asPluginId(m.from),
      to: asPluginId(m.to),
      fromIsPlugin: plugins.has(asPluginId(m.from)),
    })),
    committed: committedFilesFromMap(committed),
    fresh: opts.fresh ?? false,
  });
}

/** Write a config file the way the canonical writers do: `// @hash` + JSON. */
function put(rel: string, content: JsonValue, hash: string): void {
  tree.write(rel, `// @hash ${hash}\n${JSON.stringify(content, null, 2)}\n`);
}

function get(rel: string): { hash: string; content: JsonValue } {
  const raw = tree.read(rel)!;
  const m = /^\/\/ @hash ([a-f0-9]+)\n/.exec(raw)!;
  return {
    hash: m[1]!,
    content: JSON.parse(raw.slice(m[0].length)) as JsonValue,
  };
}

const hasUnder = (dir: string) =>
  tree.paths().some((p) => p.startsWith(`${dir}/`));

const MOVE = { at: "2026-09-23T00:00:00.000Z", from: "a.b", to: "x.b" };

describe("applyPluginMoves", () => {
  test("moves the plugin's saved config, descendants and app scopes included", () => {
    ledger([MOVE]);
    put("a/b/view-state.jsonc", { v: 1 }, "a1");
    put("a/b/view-state.origin.jsonc", { v: 0 }, "a1");
    put("a/b/@app/home/view-state.jsonc", { v: 2 }, "a1");
    put("a/b/child/config.jsonc", { c: 1 }, "a2");
    put("a/other/config.jsonc", { o: 1 }, "a3");

    const [r] = apply();

    expect(r!.moved.sort()).toEqual([
      "@app/home/view-state.jsonc",
      "child/config.jsonc",
      "view-state.jsonc",
      "view-state.origin.jsonc",
    ]);
    expect(get("x/b/view-state.jsonc").content).toEqual({ v: 1 });
    expect(get("x/b/@app/home/view-state.jsonc").content).toEqual({ v: 2 });
    expect(get("x/b/child/config.jsonc").content).toEqual({ c: 1 });
    expect(hasUnder("a/b")).toBe(false);
    expect(tree.read("a/other/config.jsonc")).not.toBeNull();
  });

  test("rewrites reorder keys in every slot's file and keeps overrides non-stale", () => {
    ledger([MOVE]);
    const origin = { items: ["a.b:one", "a.b.child:two", "a.bc:three"] };
    const originHash = computeHash(origin);
    put("shell/sidebar.origin.jsonc", origin, originHash);
    put(
      "shell/sidebar.jsonc",
      { items: ["a.b.child:two", { items: ["a.b:one"] }, "z:four"] },
      originHash,
    );

    apply();

    const newOrigin = get("shell/sidebar.origin.jsonc");
    expect(newOrigin.content).toEqual({
      items: ["x.b:one", "x.b.child:two", "a.bc:three"],
    });
    expect(newOrigin.hash).toBe(computeHash(newOrigin.content));
    const override = get("shell/sidebar.jsonc");
    expect(override.content).toEqual({
      items: ["x.b.child:two", { items: ["x.b:one"] }, "z:four"],
    });
    // Still anchored to the (rewritten) origin, so it keeps winning.
    expect(override.hash).toBe(newOrigin.hash);
  });

  test("a rewritten origin takes the hash of the git-layer document it matches but for order", () => {
    ledger([MOVE]);
    const origin = { items: ["a.b:one", "m:two"] };
    const originHash = computeHash(origin);
    put("shell/sidebar.origin.jsonc", origin, originHash);
    put("shell/sidebar.jsonc", { items: ["m:two", "a.b:one"] }, originHash);
    // The checkout's regenerated origin: the renamed key re-sorts.
    const upstream = { items: ["m:two", "x.b:one"] };
    committed.set(
      "shell/sidebar.origin.jsonc",
      `// @hash ${computeHash(upstream)}\n${JSON.stringify(upstream)}\n`,
    );

    apply();

    // Propagation stamps computeHash(upstream): the override is already there.
    expect(get("shell/sidebar.origin.jsonc").hash).toBe(computeHash(upstream));
    expect(get("shell/sidebar.jsonc").hash).toBe(computeHash(upstream));
  });

  test("a rewritten origin that differs from the git layer keeps its own hash", () => {
    ledger([MOVE]);
    const origin = { items: ["a.b:one", "m:two"] };
    const originHash = computeHash(origin);
    put("shell/sidebar.origin.jsonc", origin, originHash);
    put("shell/sidebar.jsonc", { items: ["m:two", "a.b:one"] }, originHash);
    const upstream = { items: ["m:two", "new:three", "x.b:one"] };
    committed.set(
      "shell/sidebar.origin.jsonc",
      `// @hash ${computeHash(upstream)}\n${JSON.stringify(upstream)}\n`,
    );

    apply();

    const rewritten = get("shell/sidebar.origin.jsonc");
    expect(rewritten.hash).toBe(computeHash(rewritten.content));
    expect(get("shell/sidebar.jsonc").hash).toBe(rewritten.hash);
  });

  test("a stale override stays anchored to its (rewritten) ancestor", () => {
    ledger([MOVE]);
    const base = { items: ["a.b:one"] };
    put("shell/s.ancestor.jsonc", base, computeHash(base));
    const current = { items: ["a.b:one", "q:new"] };
    put("shell/s.origin.jsonc", current, computeHash(current));
    put("shell/s.jsonc", { items: ["a.b:one"] }, computeHash(base));

    apply();

    expect(get("shell/s.jsonc").hash).toBe(get("shell/s.ancestor.jsonc").hash);
    expect(get("shell/s.jsonc").hash).not.toBe(
      get("shell/s.origin.jsonc").hash,
    );
  });

  test("a file already at the destination wins; the source stays put", () => {
    ledger([MOVE]);
    put("a/b/config.jsonc", { old: true }, "a0");
    put("x/b/config.jsonc", { new: true }, "a0");

    const [r] = apply();

    expect(r!.kept).toEqual(["config.jsonc"]);
    expect(get("x/b/config.jsonc").content).toEqual({ new: true });
    expect(get("a/b/config.jsonc").content).toEqual({ old: true });
  });

  test("chains apply in order, and each entry applies once", () => {
    ledger([MOVE, { at: "2026-09-24T00:00:00.000Z", from: "x.b", to: "y" }]);
    put("a/b/config.jsonc", { v: 1 }, "a0");

    expect(apply()).toHaveLength(2);
    expect(get("y/config.jsonc").content).toEqual({ v: 1 });

    // A new plugin reusing the old id is not swept along on the next build.
    put("a/b/config.jsonc", { reused: true }, "a0");
    expect(apply()).toEqual([]);
    expect(get("a/b/config.jsonc").content).toEqual({ reused: true });
  });

  test("a namespace created after the move records it without moving anything", () => {
    ledger([MOVE]);

    expect(apply({ fresh: true })).toEqual([]);
    expect(JSON.parse(tree.read(APPLIED_MOVES_FILE)!)).toEqual({
      applied: [`${MOVE.at} ${MOVE.from} ${MOVE.to}`],
    });
  });
});

describe("applied config-migration markers follow the move", () => {
  const markers = (keys: string[]) =>
    tree.write(
      APPLIED_CONFIG_MIGRATIONS_FILE,
      JSON.stringify({ applied: keys }),
    );
  const readMarkers = (): string[] =>
    (
      JSON.parse(tree.read(APPLIED_CONFIG_MIGRATIONS_FILE)!) as {
        applied: string[];
      }
    ).applied;

  test("rerootMigrationKey swaps the moved path prefix, in ledger order", () => {
    const moves = [
      { at: "t1", from: asPluginId("a.b"), to: asPluginId("x.b") },
      { at: "t2", from: asPluginId("x.b"), to: asPluginId("y") },
    ];
    expect(rerootMigrationKey("a/b/child/v:m1", moves)).toBe("y/child/v:m1");
    expect(rerootMigrationKey("a/bc/v:m1", moves)).toBe("a/bc/v:m1");
  });

  test("a key under the moved path is re-rooted with the files", () => {
    ledger([MOVE]);
    put("a/b/view.origin.jsonc", { v: 0 }, "a1");
    markers(["a/b/view:m1", "a/other/view:m1"]);

    apply();

    expect(readMarkers()).toEqual(["x/b/view:m1", "a/other/view:m1"]);
  });

  test("an already-applied move still heals stale markers (idempotent)", () => {
    ledger([MOVE]);
    put("x/b/view.origin.jsonc", { v: 0 }, "a1");
    apply();
    // Markers left under the old path by a replay that predates the re-root.
    markers(["a/b/view:m1", "x/b/view:m1"]);

    apply();
    expect(readMarkers()).toEqual(["x/b/view:m1"]);
    apply();
    expect(readMarkers()).toEqual(["x/b/view:m1"]);
  });

  test("a reused old id keeps its own markers", () => {
    ledger([MOVE]);
    // The old id is a plugin of the tree again.
    plugins.add(asPluginId(MOVE.from));
    put("a/b/view.origin.jsonc", { v: 0 }, "a1");
    markers(["a/b/view:m1"]);

    apply();

    expect(readMarkers()).toEqual(["a/b/view:m1"]);
  });
});
