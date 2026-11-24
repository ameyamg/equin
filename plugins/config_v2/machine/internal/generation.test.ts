import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  committedFilesFromMap,
  computeHash,
  defineConfigMigration,
  type ConfigDescriptor,
  type JsonValue,
  type RegisteredConfig,
} from "../../core";
import {
  asAppPath,
  type AppPath,
} from "@plugins/infra/plugins/host-fs/plugins/user-path/core";
import {
  ConfigGenerationMissing,
  ConfigGenerationRetired,
  configGenerations,
} from "./generation";

let ns: AppPath;
/** The committed layer, by layer-relative path. */
let committed: Map<string, string>;
/** What the generations recorded. */
let logged: string[];

beforeEach(() => {
  ns = asAppPath(
    join(mkdtempSync(join(tmpdir(), "config-generations-")), "wt"),
  );
  committed = new Map();
  logged = [];
});

afterEach(() => {
  rmSync(dirname(ns), { recursive: true, force: true });
});

const text = (content: JsonValue, hash: string) =>
  `// @hash ${hash}\n${JSON.stringify(content, null, 2)}\n`;

function put(dir: string, rel: string, content: JsonValue, hash: string) {
  const file = join(dir, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text(content, hash));
}

function get(dir: string, rel: string): { hash: string; content: JsonValue } {
  const raw = readFileSync(join(dir, rel), "utf8");
  const m = /^\/\/ @hash ([a-f0-9]+)\n/.exec(raw)!;
  return {
    hash: m[1]!,
    content: JSON.parse(raw.slice(m[0].length)) as JsonValue,
  };
}

/** Commit `content` as `a/b/config`'s origin. */
function commit(content: JsonValue): string {
  const hash = computeHash(content);
  committed.set("a/b/config.origin.jsonc", text(content, hash));
  return hash;
}

function generations(generation: string, derives = true) {
  return configGenerations({
    namespaceDir: ns,
    generation,
    derives: () => derives,
    readCommitted: async () => committedFilesFromMap(new Map(committed)),
    moves: [],
    log: (line) => logged.push(line),
  });
}

const config = (migrations: ConfigDescriptor["migrations"] = []) =>
  [
    {
      hierarchyPath: "a/b",
      descriptor: { name: "config", migrations } as unknown as ConfigDescriptor,
    },
  ] satisfies RegisteredConfig[];

const head = () =>
  JSON.parse(readFileSync(join(ns, "HEAD"), "utf8")) as {
    generation: string;
    history: string[];
  };

describe("config generations", () => {
  test("the first generation is derived from the pre-generation layout, which stays as it was", async () => {
    const oldHash = computeHash({ n: 1 });
    put(ns, "a/b/config.origin.jsonc", { n: 1 }, oldHash);
    put(ns, "a/b/config.jsonc", { n: 5 }, oldHash);
    const newHash = commit({ n: 2 });

    const g1 = generations("g1");
    await g1.open(config());
    // Derived beside the old layout, which is untouched.
    expect(get(g1.dir, "a/b/config.origin.jsonc")).toEqual({
      hash: newHash,
      content: { n: 2 },
    });
    // The override went stale: its merge base was captured for the merge.
    expect(get(g1.dir, "a/b/config.jsonc").hash).toBe(oldHash);
    expect(get(g1.dir, "a/b/config.ancestor.jsonc").content).toEqual({ n: 1 });
    expect(get(ns, "a/b/config.origin.jsonc").content).toEqual({ n: 1 });
    expect(existsSync(join(ns, "a/b/config.ancestor.jsonc"))).toBe(false);
    // Not served before its backend is ready.
    expect(existsSync(join(ns, "HEAD"))).toBe(false);

    await g1.promote();
    expect(head()).toEqual({ generation: "g1", history: ["g1"] });
  });

  test("a migration rewrites the new generation only", async () => {
    commit({ icon: "new" });
    put(ns, "a/b/config.jsonc", { icon: "old" }, "abcdef012345");
    const g1 = generations("g1");
    await g1.open(
      config([
        defineConfigMigration({
          id: "icon",
          apply: (doc): JsonValue =>
            typeof doc === "object" &&
            doc !== null &&
            !Array.isArray(doc) &&
            doc.icon === "old"
              ? { ...doc, icon: "new" }
              : doc,
        }),
      ]),
    );
    expect(get(g1.dir, "a/b/config.jsonc").content).toEqual({ icon: "new" });
    expect(get(ns, "a/b/config.jsonc").content).toEqual({ icon: "old" });
    await g1.promote();
  });

  test("a deploy that never promotes leaves HEAD and the served generation untouched", async () => {
    commit({ n: 1 });
    const g1 = generations("g1");
    await g1.open(config());
    await g1.promote();
    const served = readFileSync(
      join(g1.dir, "a/b/config.origin.jsonc"),
      "utf8",
    );

    commit({ n: 2 });
    const g2 = generations("g2");
    await g2.open(config());
    expect(get(g2.dir, "a/b/config.origin.jsonc").content).toEqual({ n: 2 });
    expect(head().generation).toBe("g1");
    expect(readFileSync(join(g1.dir, "a/b/config.origin.jsonc"), "utf8")).toBe(
      served,
    );
    expect(existsSync(join(g1.dir, ".retired"))).toBe(false);
    await g2.promote();
  });

  test("a leftover generation from a deploy that never promoted is derived again", async () => {
    commit({ n: 1 });
    const g1 = generations("g1");
    await g1.open(config());
    await g1.promote();
    // A stale copy of g2 an earlier attempt left.
    put(
      join(ns, "gens", "g2"),
      "a/b/config.origin.jsonc",
      { stale: true },
      "000000000000",
    );
    commit({ n: 3 });
    const g2 = generations("g2");
    await g2.open(config());
    expect(get(g2.dir, "a/b/config.origin.jsonc").content).toEqual({ n: 3 });
    await g2.promote();
  });

  test("a user write carries over: made before the derive, it is in the new generation", async () => {
    commit({ n: 1 });
    const g1 = generations("g1");
    await g1.open(config());
    await g1.promote();
    const hash = get(g1.dir, "a/b/config.origin.jsonc").hash;
    await g1.withWrite(async () => {
      put(g1.dir, "a/b/config.jsonc", { n: 9 }, hash);
    });

    const g2 = generations("g2");
    await g2.open(config());
    expect(get(g2.dir, "a/b/config.jsonc")).toEqual({
      hash,
      content: { n: 9 },
    });
    await g2.promote();
  });

  test("a write to the serving generation waits for a derive's promote, then is refused", async () => {
    commit({ n: 1 });
    const g1 = generations("g1");
    await g1.open(config());
    await g1.promote();

    const g2 = generations("g2");
    await g2.open(config());
    let ran = false;
    const write = g1.withWrite(async () => {
      ran = true;
    });
    // Still waiting on the lock the derive holds.
    await Bun.sleep(300);
    expect(ran).toBe(false);
    await g2.promote();
    let refused: unknown = null;
    try {
      await write;
    } catch (err) {
      refused = err;
    }
    expect(refused).toBeInstanceOf(ConfigGenerationRetired);
    expect(ran).toBe(false);
    expect(existsSync(join(g1.dir, ".retired"))).toBe(true);
    // And every later one, without waiting.
    expect(g1.withWrite(async () => undefined)).rejects.toThrow(
      ConfigGenerationRetired,
    );
  });

  test("a write to HEAD's generation runs when nothing is deriving", async () => {
    commit({ n: 1 });
    const g1 = generations("g1");
    await g1.open(config());
    await g1.promote();
    expect(await g1.withWrite(async () => 42)).toBe(42);
  });

  test("a reverted config change is derived again from what is served, carrying writes", async () => {
    commit({ n: 1 });
    const g1 = generations("g1");
    await g1.open(config());
    await g1.promote();
    commit({ n: 2 });
    const g2 = generations("g2");
    await g2.open(config());
    await g2.promote();
    const hash = get(g2.dir, "a/b/config.origin.jsonc").hash;
    await g2.withWrite(async () => {
      put(g2.dir, "a/b/config.jsonc", { n: 7 }, hash);
    });

    // Back to g1's inputs: g2 applied nothing g1 does not know.
    commit({ n: 1 });
    const back = generations("g1");
    await back.open(config());
    await back.promote();
    expect(get(back.dir, "a/b/config.origin.jsonc").content).toEqual({ n: 1 });
    // The write made under g2 is carried (now a conflict over the new origin).
    expect(get(back.dir, "a/b/config.jsonc").content).toEqual({ n: 7 });
    expect(head()).toEqual({ generation: "g1", history: ["g2", "g1"] });
    expect(existsSync(join(back.dir, ".retired"))).toBe(false);
    expect(existsSync(join(g2.dir, ".retired"))).toBe(true);
  });

  test("older code that cannot read what is served reuses its generation; one collected fails loudly", async () => {
    const migrated = config([
      defineConfigMigration({ id: "only-in-g2", apply: (doc) => doc }),
    ]);
    put(ns, "a/b/config.jsonc", { n: 0 }, "abcdef012345");
    commit({ n: 1 });
    const g1 = generations("g1");
    await g1.open(config());
    await g1.promote();
    // g2's code declares a migration g1's does not.
    const g2 = generations("g2");
    await g2.open(migrated);
    await g2.promote();

    const back = generations("g1");
    await back.open(config());
    await back.promote();
    expect(
      logged.some(
        (l) =>
          l.includes("rolling back to config generation g1") &&
          l.includes("a/b/config:only-in-g2"),
      ),
    ).toBe(true);
    expect(head()).toEqual({ generation: "g1", history: ["g2", "g1"] });

    // g3 (g2's code again) replaces g1: g1 applied nothing it does not know,
    // so it is derived again. Then two newer generations apply a migration
    // g3's code does not know, and g3 is collected under them: g3's code
    // coming back can neither derive nor reuse — its boot fails loudly.
    const g3 = generations("g3");
    await g3.open(migrated);
    await g3.promote();
    expect(existsSync(join(ns, "gens", "g2"))).toBe(false);
    const newer = config([
      defineConfigMigration({ id: "only-in-g4", apply: (doc) => doc }),
    ]);
    for (const g of ["g4", "g5"]) {
      const next = generations(g);
      await next.open(newer);
      await next.promote();
    }
    expect(existsSync(join(ns, "gens", "g3"))).toBe(false);
    expect(generations("g3").open(migrated)).rejects.toThrow(
      ConfigGenerationMissing,
    );
  });

  test("a process that does not derive requires its generation on disk", async () => {
    expect(generations("g1", false).open(config())).rejects.toThrow(
      ConfigGenerationMissing,
    );
  });
});
