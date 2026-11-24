import { beforeEach, describe, expect, test } from "bun:test";
import {
  computeHash,
  defineConfigMigration,
  type ConfigDescriptor,
  type JsonValue,
} from "../../../core";
import {
  APPLIED_CONFIG_MIGRATIONS_FILE,
  applyConfigMigrations,
} from "./config-migrations";
import { memoryConfigTree, rewriteConfigFiles } from "./config-tree";

let tree: ReturnType<typeof memoryConfigTree>;

beforeEach(() => {
  tree = memoryConfigTree();
});

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

let calls = 0;
const renameIcon = defineConfigMigration({
  id: "rename-icon",
  apply: (doc) => {
    calls++;
    if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
      return doc;
    }
    return doc.icon === "old" ? { ...doc, icon: "new" } : doc;
  },
});

function descriptor(): ConfigDescriptor {
  return {
    name: "config",
    migrations: [renameIcon],
  } as unknown as ConfigDescriptor;
}

const configs = () => [{ hierarchyPath: "a/b", descriptor: descriptor() }];

describe("applyConfigMigrations", () => {
  test("rewrites origin, override and app scopes, re-stamping the hash chain", () => {
    const origin = { icon: "old", n: 1 };
    const originHash = computeHash(origin);
    put("a/b/config.origin.jsonc", origin, originHash);
    put("a/b/config.jsonc", { icon: "old", n: 2 }, originHash);
    put("a/b/@app/x/config.jsonc", { icon: "old" }, "abcdef012345");
    put("other/config.jsonc", { icon: "old" }, "abcdef012345");

    const applied = applyConfigMigrations({
      tree,
      configs: configs(),
    });
    expect(applied.map((a) => a.key)).toEqual(["a/b/config:rename-icon"]);

    const newOrigin = get("a/b/config.origin.jsonc");
    expect(newOrigin.content).toEqual({ icon: "new", n: 1 });
    expect(newOrigin.hash).toBe(computeHash({ icon: "new", n: 1 }));
    // The override follows its origin's new hash, so it stays in force.
    expect(get("a/b/config.jsonc")).toEqual({
      hash: newOrigin.hash,
      content: { icon: "new", n: 2 },
    });
    expect(get("a/b/@app/x/config.jsonc").content).toEqual({ icon: "new" });
    // Another config's file is not this migration's.
    expect(get("other/config.jsonc").content).toEqual({ icon: "old" });
  });

  test("runs once per namespace", () => {
    put("a/b/config.jsonc", { icon: "old" }, "abcdef012345");
    applyConfigMigrations({ tree, configs: configs() });
    put("a/b/config.jsonc", { icon: "old" }, "abcdef012345");
    calls = 0;
    expect(applyConfigMigrations({ tree, configs: configs() })).toEqual([]);
    expect(calls).toBe(0);
    expect(get("a/b/config.jsonc").content).toEqual({ icon: "old" });
  });

  test("a namespace with no saved config records every migration without running it", () => {
    calls = 0;
    expect(applyConfigMigrations({ tree, configs: configs() })).toEqual([]);
    expect(calls).toBe(0);
    expect(tree.read(APPLIED_CONFIG_MIGRATIONS_FILE)).not.toBeNull();
    put("a/b/config.jsonc", { icon: "old" }, "abcdef012345");
    expect(applyConfigMigrations({ tree, configs: configs() })).toEqual([]);
  });

  test("leaves a file the migration does not change byte-for-byte", () => {
    const text = '// @hash abcdef012345\n{ "icon": "new" /* kept */ }\n';
    tree.write("a/b/config.jsonc", text);
    const [applied] = applyConfigMigrations({
      tree,
      configs: configs(),
    });
    expect(applied?.rewritten).toEqual([]);
    expect(tree.read("a/b/config.jsonc")).toBe(text);
  });
});

describe("rewriteConfigFiles", () => {
  test("an automatic-merge record follows its origin's new hash, header and toHash", () => {
    const origin = { icon: "old" };
    const oldHash = computeHash(origin);
    put("a/b/config.origin.jsonc", origin, oldHash);
    put("a/b/config.jsonc", { icon: "old", x: 1 }, oldHash);
    put(
      "a/b/config.merge.jsonc",
      { version: 1, fromHash: "000000000000", toHash: oldHash },
      oldHash,
    );
    rewriteConfigFiles(tree, {
      rewrite: (rel, text) =>
        rel.endsWith(".origin.jsonc") ? text.replace('"old"', '"new"') : text,
    });
    const newHash = computeHash({ icon: "new" });
    expect(get("a/b/config.jsonc").hash).toBe(newHash);
    expect(get("a/b/config.merge.jsonc")).toEqual({
      hash: newHash,
      content: { version: 1, fromHash: "000000000000", toHash: newHash },
    });
  });
});
