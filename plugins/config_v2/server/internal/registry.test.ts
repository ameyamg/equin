/**
 * The portable registry over its two host services, with no file in sight: the
 * user layer is `createMemoryConfigStore()` (wrapped to record every `edit`),
 * the committed layer a fixture answering `document` from a set.
 *
 * `initRegistry` reads its registrations from collected contributions, so the
 * suite fakes a collect of its own two descriptors (cleared after, so no later
 * suite reads them), and provides the services through `withHostServices` —
 * scoped to each call, never the process-wide unbooted set the preload owns.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { boolField } from "@plugins/fields/plugins/bool/plugins/config/core";
import { textField } from "@plugins/fields/plugins/text/plugins/config/core";
import { stringListField } from "@plugins/fields/plugins/string-list/plugins/config/core";
import { collectContributions } from "@plugins/framework/plugins/server-core/core";
import {
  clearCollectedContributions,
  withHostServices,
} from "@plugins/framework/plugins/server-core/core/testing";
import { asPluginId } from "@plugins/framework/plugins/plugin-id/core";
import { systemOrigin } from "@plugins/infra/plugins/request-origin/core";
import {
  computeHash,
  createMemoryConfigStore,
  defineConfig,
  type ConfigDocRef,
  type ConfigFileRef,
  type ConfigStoreImpl,
  type JsonValue,
} from "../../core";
import { ConfigV2 } from "./contribution";
import { mergeReviewFields } from "../../core";
import { ConfigGitLayer, ConfigStore } from "./host-services";
import {
  acknowledgeConflictByPath,
  deleteOverrideByPath,
  getConfig,
  hasConfigDocument,
  initRegistry,
  mergeConflictByPath,
  onDocumentChange,
  readAutoMerge,
  resolveAutoMergeFieldByPath,
  reloadConfigDocument,
  stampAutoMergeByPath,
  undoAutoMergeByPath,
  resetConfigByPath,
  setConfig,
  setConfigByPath,
  settleAutoMergePlacementByPath,
  shutdownRegistry,
  watchConfig,
  type ConfigDocumentTuple,
} from "./registry";
import { configValuesServed } from "./resource";
import { getConfigScopeIds } from "./resource";
import { forkDescriptorScope, removeDescriptorScope } from "./scope-fork";

const alpha = defineConfig({
  name: "alpha",
  fields: {
    enabled: boolField({ label: "Enabled", default: true }),
    title: textField({ label: "Title", default: "hello" }),
  },
});
const gamma = defineConfig({
  name: "gamma",
  fields: {
    enabled: boolField({ label: "Enabled", default: true }),
    title: textField({ label: "Title", default: "g" }),
  },
});
const beta = defineConfig({
  name: "beta",
  fields: { title: textField({ label: "Title", default: "b" }) },
});

const delta = defineConfig({
  name: "delta",
  fields: {
    items: stringListField({ label: "Items", default: [] }),
    title: textField({ label: "Title", default: "d" }),
  },
});

const PLUGIN = "registry-test";
const DELTA = `${PLUGIN}/delta.jsonc`;
const ALPHA = `${PLUGIN}/alpha.jsonc`;
const BETA = `${PLUGIN}/beta.jsonc`;
const GAMMA = `${PLUGIN}/gamma.jsonc`;
const writer = systemOrigin("registry-test");

const memory = createMemoryConfigStore();
const edits: { doc: ConfigDocRef; operation: string }[] = [];
// The memory store, recording every write the registry routes through `edit`
// — the hook the desktop's agent-write ledger hangs off.
const store: ConfigStoreImpl = {
  ...memory,
  edit: (doc, w, operation, mutate) => {
    edits.push({ doc, operation });
    return memory.edit(doc, w, operation, mutate);
  },
};
// The committed layer: `<storePath>|<appId>` pairs the repo commits a scope for.
const committedScopes = new Set<string>();
const providers = [
  ConfigStore.provide(store),
  ConfigGitLayer.provide({
    document: (storePath) =>
      Promise.resolve({
        base: {},
        scopes: Object.fromEntries(
          [...committedScopes]
            .map((pair) => pair.split("|"))
            .filter(([sp]) => sp === storePath)
            .map(([, appId]) => [appId!, {}]),
        ),
      }),
    watch: () => Promise.resolve(() => {}),
  }),
];
const run = <T>(fn: () => T | Promise<T>) => withHostServices(providers, fn);

const file = (
  storePath: string,
  f: ConfigFileRef["file"],
  scopeId?: string,
): ConfigFileRef => ({ storePath, ...(scopeId ? { scopeId } : {}), file: f });
const read = (ref: ConfigFileRef) => memory.read(ref);
const exists = async (ref: ConfigFileRef) => (await memory.read(ref)) !== null;
// Write a document file the way the build propagates one.
function seed(
  ref: ConfigFileRef,
  content: JsonValue,
  hash?: string,
): Promise<void> {
  return memory.write(ref, content, hash ?? computeHash(content));
}

const ALPHA_ORIGIN = { enabled: true, title: "committed" };
const changes: ConfigDocumentTuple[] = [];
let offChanges: () => void = () => {};

beforeAll(async () => {
  await seed(file(ALPHA, "origin"), ALPHA_ORIGIN);
  await seed(file(BETA, "origin"), { title: "b" });
  await seed(file(GAMMA, "origin"), { enabled: true, title: "g" });
  await seed(file(DELTA, "origin"), { items: [], title: "d" });
  // A committed scope the build propagated before boot: rehydrated by init.
  await seed(file(BETA, "origin", "app:mail"), { title: "mail" });
  collectContributions([
    {
      id: PLUGIN,
      contributions: [
        ConfigV2.Register({ descriptor: alpha, pluginId: asPluginId(PLUGIN) }),
        ConfigV2.Register({ descriptor: beta, pluginId: asPluginId(PLUGIN) }),
        ConfigV2.Register({ descriptor: gamma, pluginId: asPluginId(PLUGIN) }),
        ConfigV2.Register({ descriptor: delta, pluginId: asPluginId(PLUGIN) }),
      ],
    },
  ]);
  await run(() => initRegistry());
  offChanges = onDocumentChange((doc) => changes.push(doc));
});

afterAll(() => {
  offChanges();
  shutdownRegistry();
  clearCollectedContributions();
});

function lastEdits(n: number): string[] {
  return edits.slice(-n).map((e) => e.operation);
}

describe("reads", () => {
  test("a base read resolves the propagated origin", () =>
    run(() => {
      expect(getConfig(alpha)).toEqual(ALPHA_ORIGIN);
      expect(hasConfigDocument(ALPHA)).toBe(true);
    }));

  test("a scope with no document of its own tracks the base", () =>
    run(() => {
      expect(getConfig(alpha, "app:pages")).toEqual(ALPHA_ORIGIN);
      expect(hasConfigDocument(ALPHA, "app:pages")).toBe(false);
    }));

  test("a committed scope found at init reads its own document", () =>
    run(async () => {
      expect(getConfig(beta, "app:mail")).toEqual({ title: "mail" });
      expect(await getConfigScopeIds(beta)).toEqual(["app:mail"]);
    }));
});

describe("writes", () => {
  test("a base write anchors a full override to the origin, through edit", () =>
    run(async () => {
      changes.length = 0;
      await setConfig(alpha, "title", "mine", { writer });
      expect(await read(file(ALPHA, "override"))).toEqual({
        content: { enabled: true, title: "mine" },
        hash: computeHash(ALPHA_ORIGIN),
      });
      expect(getConfig(alpha).title).toBe("mine");
      expect(lastEdits(1)).toEqual(["set-field:title"]);
      expect(changes).toContainEqual({ path: ALPHA });
    }));

  test("a value the field's schema refuses is not written", () =>
    run(async () => {
      const before = edits.length;
      expect(
        setConfigByPath(ALPHA, "enabled", "not-a-bool", { writer }),
      ).rejects.toBeInstanceOf(Error);
      expect(edits.length).toBe(before);
      expect(getConfig(alpha).enabled).toBe(true);
    }));

  test("a reset leaving nothing the origin does not say removes the override", () =>
    run(async () => {
      await resetConfigByPath(ALPHA, "title", { writer });
      expect(await exists(file(ALPHA, "override"))).toBe(false);
      expect(getConfig(alpha)).toEqual(ALPHA_ORIGIN);
      expect(lastEdits(1)).toEqual(["reset-field:title"]);
    }));

  test("a first scoped write forks the scope from the base", () =>
    run(async () => {
      changes.length = 0;
      await setConfig(alpha, "enabled", false, {
        writer,
        scopeId: "app:pages",
      });
      expect((await read(file(ALPHA, "origin", "app:pages")))?.content).toEqual(
        ALPHA_ORIGIN,
      );
      expect(getConfig(alpha, "app:pages").enabled).toBe(false);
      expect(getConfig(alpha).enabled).toBe(true);
      expect(await getConfigScopeIds(alpha)).toEqual(["app:pages"]);
      expect(changes).toContainEqual({ path: ALPHA, scopeId: "app:pages" });
    }));
});

describe("conflict resolution", () => {
  // A stale override (written against an older origin) plus the merge base
  // propagate captured: the override no longer wins.
  async function conflict(): Promise<void> {
    const ancestor = { enabled: true, title: "old" };
    await seed(file(ALPHA, "ancestor"), ancestor);
    await seed(
      file(ALPHA, "override"),
      { enabled: false, title: "old" },
      computeHash(ancestor),
    );
  }

  test("acknowledge restamps the override and drops the ancestor", () =>
    run(async () => {
      await conflict();
      await reloadConfigDocument(ALPHA, "");
      expect(getConfig(alpha)).toEqual(ALPHA_ORIGIN);
      await acknowledgeConflictByPath(ALPHA, { writer });
      expect((await read(file(ALPHA, "override")))?.hash).toBe(
        computeHash(ALPHA_ORIGIN),
      );
      expect(await exists(file(ALPHA, "ancestor"))).toBe(false);
      expect(getConfig(alpha)).toEqual({ enabled: false, title: "old" });
      expect(lastEdits(1)).toEqual(["acknowledge-conflict"]);
    }));

  test("merge takes each side's change and resolves when nothing collides", () =>
    run(async () => {
      await conflict();
      await reloadConfigDocument(ALPHA, "");
      const result = await mergeConflictByPath(ALPHA, { writer });
      expect(result).toEqual({ resolved: true, conflictKeys: [] });
      expect(await read(file(ALPHA, "override"))).toEqual({
        content: { enabled: false, title: "committed" },
        hash: computeHash(ALPHA_ORIGIN),
      });
      expect(await exists(file(ALPHA, "ancestor"))).toBe(false);
      expect(lastEdits(1)).toEqual(["merge-conflict"]);
    }));

  test("merge completes a partial override with its base instead of dropping the rest", () =>
    run(async () => {
      const ancestor = { enabled: true, title: "old" };
      await seed(file(ALPHA, "ancestor"), ancestor);
      await seed(
        file(ALPHA, "override"),
        { enabled: false },
        computeHash(ancestor),
      );
      await reloadConfigDocument(ALPHA, "");
      const result = await mergeConflictByPath(ALPHA, { writer });
      expect(result).toEqual({ resolved: true, conflictKeys: [] });
      expect((await read(file(ALPHA, "override")))?.content).toEqual({
        enabled: false,
        title: "committed",
      });
    }));

  test("delete-override drops the override and the ancestor", () =>
    run(async () => {
      await conflict();
      await reloadConfigDocument(ALPHA, "");
      await deleteOverrideByPath(ALPHA, { writer });
      expect(await exists(file(ALPHA, "override"))).toBe(false);
      expect(await exists(file(ALPHA, "ancestor"))).toBe(false);
      expect(getConfig(alpha)).toEqual(ALPHA_ORIGIN);
      expect(lastEdits(1)).toEqual(["delete-override"]);
    }));

  test("a write from what the app shows is refused and leaves the parked override", () =>
    run(async () => {
      await conflict();
      await reloadConfigDocument(ALPHA, "");
      const before = await read(file(ALPHA, "override"));
      const editCount = edits.length;
      expect(
        setConfigByPath(ALPHA, "title", "from-screen", { writer }),
      ).rejects.toThrow("has a conflict");
      expect(await read(file(ALPHA, "override"))).toEqual(before);
      expect(edits.length).toBe(editCount);
    }));

  test("a write from the override edits the parked document and keeps the conflict", () =>
    run(async () => {
      await conflict();
      await reloadConfigDocument(ALPHA, "");
      await setConfigByPath(ALPHA, "title", "edited", {
        writer,
        fromOverride: true,
      });
      expect(await read(file(ALPHA, "override"))).toEqual({
        content: { enabled: false, title: "edited" },
        hash: computeHash({ enabled: true, title: "old" }),
      });
      expect(getConfig(alpha)).toEqual(ALPHA_ORIGIN);
    }));
});

describe("scope fork and removal", () => {
  test("fork writes origin and override from the scope's values; removal drops the scope", () =>
    run(async () => {
      await forkDescriptorScope(ALPHA, "app:docs", { writer });
      expect((await read(file(ALPHA, "origin", "app:docs")))?.content).toEqual(
        ALPHA_ORIGIN,
      );
      expect(
        (await read(file(ALPHA, "override", "app:docs")))?.content,
      ).toEqual(ALPHA_ORIGIN);
      expect(await getConfigScopeIds(alpha)).toContain("app:docs");

      await removeDescriptorScope(ALPHA, "app:docs", { writer });
      expect(await exists(file(ALPHA, "origin", "app:docs"))).toBe(false);
      expect(await getConfigScopeIds(alpha)).not.toContain("app:docs");
      expect(hasConfigDocument(ALPHA, "app:docs")).toBe(false);
      expect(lastEdits(2)).toEqual([
        "fork-descriptor-scope",
        "remove-descriptor-scope",
      ]);
    }));

  test("a scoped write queued behind a removal re-forks the scope with a live entry", () =>
    run(async () => {
      await forkDescriptorScope(ALPHA, "app:race", { writer });
      // Both start at once: the write queues on the document lock the removal
      // holds, so it must find the entry gone and build a fresh one.
      await Promise.all([
        removeDescriptorScope(ALPHA, "app:race", { writer }),
        setConfig(alpha, "title", "after", { writer, scopeId: "app:race" }),
      ]);
      expect(hasConfigDocument(ALPHA, "app:race")).toBe(true);
      expect(getConfig(alpha, "app:race").title).toBe("after");
      await removeDescriptorScope(ALPHA, "app:race", { writer });
    }));

  test("removing a git-backed scope falls back to its committed document", () =>
    run(async () => {
      committedScopes.add(`${BETA}|mail`);
      await setConfig(beta, "title", "runtime", {
        writer,
        scopeId: "app:mail",
      });
      expect(getConfig(beta, "app:mail").title).toBe("runtime");

      await removeDescriptorScope(BETA, "app:mail", { writer });
      expect(await exists(file(BETA, "override", "app:mail"))).toBe(false);
      expect(await exists(file(BETA, "origin", "app:mail"))).toBe(true);
      expect(getConfig(beta, "app:mail")).toEqual({ title: "mail" });
      expect(await getConfigScopeIds(beta)).toEqual(["app:mail"]);
    }));
});

describe("reloadConfigDocument", () => {
  test("a base document rewritten behind the registry is re-read", () =>
    run(async () => {
      changes.length = 0;
      await seed(
        file(ALPHA, "override"),
        { enabled: true, title: "restored" },
        computeHash(ALPHA_ORIGIN),
      );
      await reloadConfigDocument(ALPHA, "");
      expect(getConfig(alpha).title).toBe("restored");
      expect(changes).toContainEqual({ path: ALPHA });
    }));

  test("a rewrite that resolves to the same values moves the files' readers only", () =>
    run(async () => {
      const heard: unknown[] = [];
      const watch = watchConfig(alpha, (v) => heard.push(v));
      const notified: unknown[] = [];
      const notify = configValuesServed.notify;
      configValuesServed.notify = (p) => {
        notified.push(p);
        notify(p);
      };
      try {
        const same = { ...getConfig(alpha) };
        heard.length = 0; // watchConfig answers once on subscribe
        changes.length = 0;
        // The same document written again: the stamp moves, the values do not.
        await seed(file(ALPHA, "override"), same, computeHash(ALPHA_ORIGIN));
        await reloadConfigDocument(ALPHA, "");
        expect(changes).toContainEqual({ path: ALPHA }); // the raw file moved …
        expect(heard).toEqual([]); // … no subscriber and no values tuple did
        expect(notified).toEqual([]);

        await seed(
          file(ALPHA, "override"),
          { ...same, title: "moved" },
          computeHash(ALPHA_ORIGIN),
        );
        await reloadConfigDocument(ALPHA, "");
        expect(heard).toHaveLength(1);
        expect(notified).toContainEqual({ path: ALPHA });
      } finally {
        configValuesServed.notify = notify;
        watch.dispose();
      }
    }));

  test("an override hand-written without a hash is applied and stamped with its origin's", () =>
    run(async () => {
      // What a person or an agent writes straight into the user layer: no
      // `// @hash` header. It is applied, not refused, and stamped so the next
      // origin change surfaces it as a conflict like any other override.
      await memory.write(
        file(ALPHA, "override"),
        { enabled: false, title: "by hand" },
        null,
      );
      await reloadConfigDocument(ALPHA, "");
      expect(getConfig(alpha)).toEqual({ enabled: false, title: "by hand" });
      expect(await read(file(ALPHA, "override"))).toEqual({
        content: { enabled: false, title: "by hand" },
        hash: computeHash(ALPHA_ORIGIN),
      });
      expect(lastEdits(1)).toEqual(["stamp-unstamped-override"]);
      await deleteOverrideByPath(ALPHA, { writer });
    }));

  test("an override that does not parse is never applied nor rewritten", () =>
    run(async () => {
      const broken = {
        content: { enabled: false },
        hash: null,
        syntaxErrors: ["JSONC syntax error: CommaExpected at line 3"],
      };
      const ref = file(ALPHA, "override");
      // The memory store holds what it is given: stand the parsed broken file in.
      const realRead = store.read;
      store.read = (r) =>
        r.storePath === ref.storePath && r.file === "override" && !r.scopeId
          ? Promise.resolve(broken)
          : realRead(r);
      try {
        await memory.write(ref, { enabled: false }, null); // moves the stamp
        const before = edits.length;
        await reloadConfigDocument(ALPHA, "");
        expect(getConfig(alpha)).toEqual(ALPHA_ORIGIN);
        expect(edits.length).toBe(before); // not stamped
      } finally {
        store.read = realRead;
      }
      await deleteOverrideByPath(ALPHA, { writer });
    }));

  test("a scoped document whose files were removed leaves the registry", () =>
    run(async () => {
      await forkDescriptorScope(ALPHA, "app:tmp", { writer });
      await memory.remove(file(ALPHA, "origin", "app:tmp"));
      await memory.remove(file(ALPHA, "override", "app:tmp"));
      await reloadConfigDocument(ALPHA, "app:tmp");
      expect(hasConfigDocument(ALPHA, "app:tmp")).toBe(false);
      expect(await getConfigScopeIds(alpha)).not.toContain("app:tmp");
    }));
});

describe("automatic merge at boot", () => {
  const ANCESTOR = { enabled: true, title: "old" };
  const NEW_ORIGIN = { enabled: true, title: "new" };
  const PRE_MERGE = { enabled: false };

  // An update moved gamma's origin under the user's (partial) override; the
  // build captured the merge base. Then the backend restarts.
  async function staleOverride(origin: JsonValue = NEW_ORIGIN): Promise<void> {
    await seed(file(GAMMA, "origin"), origin);
    await seed(file(GAMMA, "ancestor"), ANCESTOR);
    await seed(file(GAMMA, "override"), PRE_MERGE, computeHash(ANCESTOR));
  }
  async function reboot(): Promise<void> {
    shutdownRegistry();
    await initRegistry();
  }

  test("a stale override that merges cleanly is applied, with a record", () =>
    run(async () => {
      await staleOverride();
      await reboot();
      expect(await read(file(GAMMA, "override"))).toEqual({
        content: { enabled: false, title: "new" },
        hash: computeHash(NEW_ORIGIN),
      });
      expect(await exists(file(GAMMA, "ancestor"))).toBe(false);
      expect(getConfig(gamma)).toEqual({ enabled: false, title: "new" });
      const state = await readAutoMerge(GAMMA);
      expect(state?.status).toBe("current");
      expect(state?.record).toMatchObject({
        fromHash: computeHash(ANCESTOR),
        toHash: computeHash(NEW_ORIGIN),
        undo: {
          override: { content: PRE_MERGE, hash: computeHash(ANCESTOR) },
          ancestor: { content: ANCESTOR, hash: computeHash(ANCESTOR) },
        },
      });
      expect(
        edits.some(
          (e) => e.operation === "auto-merge" && e.doc.storePath === GAMMA,
        ),
      ).toBe(true);
    }));

  test("Undo puts the normal conflict back and keeps the record as a tombstone", () =>
    run(async () => {
      await undoAutoMergeByPath(GAMMA, { writer });
      expect(await read(file(GAMMA, "override"))).toEqual({
        content: PRE_MERGE,
        hash: computeHash(ANCESTOR),
      });
      expect((await read(file(GAMMA, "ancestor")))?.content).toEqual(ANCESTOR);
      expect((await readAutoMerge(GAMMA))?.status).toBe("undone");
      // In conflict: the new origin wins until the user reconciles.
      expect(getConfig(gamma)).toEqual(NEW_ORIGIN);
      expect(lastEdits(1)).toEqual(["undo-auto-merge"]);
    }));

  test("a restart does not merge again the update the user undid", () =>
    run(async () => {
      await reboot();
      expect((await read(file(GAMMA, "override")))?.hash).toBe(
        computeHash(ANCESTOR),
      );
      expect((await readAutoMerge(GAMMA))?.status).toBe("undone");
      expect(getConfig(gamma)).toEqual(NEW_ORIGIN);
      expect(undoAutoMergeByPath(GAMMA, { writer })).rejects.toThrow(
        "no automatic merge to undo",
      );
    }));

  test("a later update merges again over the tombstone", () =>
    run(async () => {
      await seed(file(GAMMA, "origin"), { enabled: true, title: "newer" });
      await reboot();
      expect(getConfig(gamma)).toEqual({ enabled: false, title: "newer" });
      expect((await readAutoMerge(GAMMA))?.status).toBe("current");
    }));

  test("Undo is refused once the user edited the config since", () =>
    run(async () => {
      expect((await readAutoMerge(GAMMA))?.status).toBe("current");
      await setConfig(gamma, "title", "mine", { writer });
      expect((await readAutoMerge(GAMMA))?.status).toBe("edited");
      expect(undoAutoMergeByPath(GAMMA, { writer })).rejects.toThrow(
        "changed since",
      );
      expect(getConfig(gamma).title).toBe("mine");
    }));

  test("Undo is refused once a later update moved the origin past it", () =>
    run(async () => {
      await deleteOverrideByPath(GAMMA, { writer });
      await staleOverride();
      await reboot();
      await seed(file(GAMMA, "origin"), { enabled: true, title: "newer" });
      await reloadConfigDocument(GAMMA, "");
      expect((await readAutoMerge(GAMMA))?.status).toBe("superseded");
      expect(undoAutoMergeByPath(GAMMA, { writer })).rejects.toThrow(
        "superseded",
      );
    }));

  test("a merge it cannot decide stays a conflict and writes nothing", () =>
    run(async () => {
      await deleteOverrideByPath(GAMMA, { writer });
      // The update dropped `title`, which the user changed: delete-modify.
      await seed(file(GAMMA, "origin"), { enabled: true });
      await seed(file(GAMMA, "ancestor"), ANCESTOR);
      await seed(
        file(GAMMA, "override"),
        { enabled: true, title: "mine" },
        computeHash(ANCESTOR),
      );
      await reboot();
      expect((await read(file(GAMMA, "override")))?.hash).toBe(
        computeHash(ANCESTOR),
      );
      expect(await exists(file(GAMMA, "ancestor"))).toBe(true);
      expect(await exists(file(GAMMA, "merge"))).toBe(false);
    }));

  test("acknowledging stamps only the record it names, and moves the document's listeners", () =>
    run(async () => {
      await deleteOverrideByPath(GAMMA, { writer });
      await staleOverride();
      await reboot();
      const id = (await readAutoMerge(GAMMA))!.record.id;
      expect(
        await stampAutoMergeByPath(GAMMA, "other", "acknowledgedAt", {
          writer,
        }),
      ).toBe(false);
      changes.length = 0;
      expect(
        await stampAutoMergeByPath(GAMMA, id, "acknowledgedAt", { writer }),
      ).toBe(true);
      expect((await readAutoMerge(GAMMA))?.record.acknowledgedAt).toBeDefined();
      expect(changes).toContainEqual({ path: GAMMA });
      // Stamping again is a no-op.
      expect(
        await stampAutoMergeByPath(GAMMA, id, "acknowledgedAt", { writer }),
      ).toBe(false);
    }));

  test("deleting the override drops the record with it", () =>
    run(async () => {
      await deleteOverrideByPath(GAMMA, { writer });
      expect(await exists(file(GAMMA, "merge"))).toBe(false);
      expect(await readAutoMerge(GAMMA)).toBeNull();
    }));
});

describe("reviewing an automatic merge per field", () => {
  const ANCESTOR = { enabled: true, title: "old" };
  const NEW_ORIGIN = { enabled: true, title: "new" };
  // The user turned `enabled` off (only they changed it) and retitled
  // (the update retitled too: their value wins).
  const PRE_MERGE = { enabled: false, title: "mine" };

  async function merged(): Promise<string> {
    await deleteOverrideByPath(GAMMA, { writer });
    await seed(file(GAMMA, "origin"), NEW_ORIGIN);
    await seed(file(GAMMA, "ancestor"), ANCESTOR);
    await seed(file(GAMMA, "override"), PRE_MERGE, computeHash(ANCESTOR));
    shutdownRegistry();
    await initRegistry();
    const state = await readAutoMerge(GAMMA);
    expect(state?.status).toBe("current");
    return state!.record.id;
  }
  const resolve = (
    recordId: string,
    field: string,
    choice: "keep" | "mine" | "new-default",
  ) =>
    resolveAutoMergeFieldByPath(GAMMA, { recordId, field, choice }, { writer });

  test("the review lists each field a side changed, with its outcome", () =>
    run(async () => {
      await merged();
      const { record } = (await readAutoMerge(GAMMA))!;
      expect(
        mergeReviewFields(record).map((f) => [f.key, f.outcome, f.result]),
      ).toEqual([
        ["enabled", "kept-yours", false],
        ["title", "yours-won", "mine"],
      ]);
    }));

  test("Use new default rewrites the field, keeps the merge current and undoable", () =>
    run(async () => {
      const id = await merged();
      await resolve(id, "title", "new-default");
      expect(getConfig(gamma)).toEqual({ enabled: false, title: "new" });
      const state = (await readAutoMerge(GAMMA))!;
      expect(state.status).toBe("current");
      expect(state.editedFields).toEqual([]);
      expect(state.record.resolutions.map((r) => [r.path, r.choice])).toEqual([
        [["title"], "new-default"],
      ]);
      // Use mine puts the user's pre-merge value back.
      await resolve(id, "title", "mine");
      expect(getConfig(gamma).title).toBe("mine");
      // Undo still restores the exact pre-merge state.
      await undoAutoMergeByPath(GAMMA, { writer });
      expect((await read(file(GAMMA, "override")))?.content).toEqual(PRE_MERGE);
    }));

  test("Keep records the choice and rewrites nothing", () =>
    run(async () => {
      const id = await merged();
      const before = await read(file(GAMMA, "override"));
      changes.length = 0;
      await resolve(id, "enabled", "keep");
      expect(await read(file(GAMMA, "override"))).toEqual(before);
      expect(
        mergeReviewFields((await readAutoMerge(GAMMA))!.record).find(
          (f) => f.key === "enabled",
        )?.resolution?.choice,
      ).toBe("keep");
      expect(changes).toContainEqual({ path: GAMMA });
    }));

  test("a field edited since, a replaced record and an untouched field are refused", () =>
    run(async () => {
      const id = await merged();
      await setConfig(gamma, "title", "edited", { writer });
      const state = (await readAutoMerge(GAMMA))!;
      expect(state.status).toBe("edited");
      expect(state.editedFields).toEqual(["title"]);
      expect(resolve(id, "title", "new-default")).rejects.toThrow(
        "changed since",
      );
      expect(resolve("other", "enabled", "keep")).rejects.toThrow(
        "replaced it",
      );
      // A field the user did not edit can still be reviewed.
      await resolve(id, "enabled", "new-default");
      expect(getConfig(gamma)).toEqual({ enabled: true, title: "edited" });
    }));
});

describe("placing the rows an update added (the placement job's write)", () => {
  const ANCESTOR = { items: ["a", "b", "c"], title: "d" };
  // The update added `n` before `c`; the user had moved `c` first.
  const NEW_ORIGIN = { items: ["a", "b", "n", "c"], title: "d" };
  const PRE_MERGE = { items: ["c", "a", "b"] };
  const LIST = {
    path: ["items"],
    order: ["s:c", "s:a", "s:b", "s:n"],
    movable: ["s:n"],
  };

  async function merged(): Promise<string> {
    await deleteOverrideByPath(DELTA, { writer });
    await seed(file(DELTA, "origin"), NEW_ORIGIN);
    await seed(file(DELTA, "ancestor"), ANCESTOR);
    await seed(file(DELTA, "override"), PRE_MERGE, computeHash(ANCESTOR));
    shutdownRegistry();
    await initRegistry();
    const state = (await readAutoMerge(DELTA))!;
    expect(state.status).toBe("current");
    expect(state.record.placement).toEqual({
      status: "pending",
      lists: [LIST],
    });
    expect(getConfig(delta).items).toEqual(["c", "a", "b", "n"]);
    return state.record.id;
  }
  const answer = (id: string, answers: unknown[]) =>
    settleAutoMergePlacementByPath(
      DELTA,
      id,
      { kind: "answered", model: "sonnet", answers },
      { writer },
    );

  test("a merge that placed no new row needs no placement", () =>
    run(async () => {
      await deleteOverrideByPath(GAMMA, { writer });
      await seed(file(GAMMA, "origin"), { enabled: true, title: "new" });
      await seed(file(GAMMA, "ancestor"), { enabled: true, title: "old" });
      await seed(
        file(GAMMA, "override"),
        { enabled: false },
        computeHash({ enabled: true, title: "old" }),
      );
      shutdownRegistry();
      await initRegistry();
      expect((await readAutoMerge(GAMMA))?.record.placement).toEqual({
        status: "not-needed",
      });
    }));

  test("a valid answer is written; the merge stays current and undoable", () =>
    run(async () => {
      const id = await merged();
      const placement = await answer(id, [["s:c", "s:n", "s:a", "s:b"]]);
      expect(placement).toMatchObject({
        status: "decided",
        model: "sonnet",
        results: [
          {
            path: ["items"],
            verdict: "moved",
            order: ["s:c", "s:n", "s:a", "s:b"],
          },
        ],
      });
      expect(getConfig(delta).items).toEqual(["c", "n", "a", "b"]);
      const state = (await readAutoMerge(DELTA))!;
      expect(state.status).toBe("current");
      expect(state.record.result.items).toEqual(["c", "n", "a", "b"]);
      expect(lastEdits(1)).toEqual(["auto-merge-placement"]);
      // Settled once: a retried job finds nothing to do.
      expect(await answer(id, [["s:c", "s:a", "s:n", "s:b"]])).toBeNull();
      await undoAutoMergeByPath(DELTA, { writer });
      expect((await read(file(DELTA, "override")))?.content).toEqual(PRE_MERGE);
    }));

  test("an answer that is not a permutation keeping your order is refused", () =>
    run(async () => {
      const id = await merged();
      const before = await read(file(DELTA, "override"));
      // Reorders the user's rows (a before c).
      expect(await answer(id, [["s:a", "s:c", "s:b", "s:n"]])).toMatchObject({
        status: "decided",
        results: [{ verdict: "rejected", reason: "reordered your rows" }],
      });
      expect(await read(file(DELTA, "override"))).toEqual(before);
      // Drops a row.
      const id2 = await merged();
      expect(await answer(id2, [["s:c", "s:a", "s:b"]])).toMatchObject({
        results: [{ verdict: "rejected", reason: "dropped s:n" }],
      });
      // No answer at all for the list.
      const id3 = await merged();
      expect(await answer(id3, [])).toMatchObject({
        results: [{ verdict: "rejected" }],
      });
      expect(getConfig(delta).items).toEqual(["c", "a", "b", "n"]);
    }));

  test("a skipped placement (usage limit) records why and writes nothing else", () =>
    run(async () => {
      const id = await merged();
      const before = await read(file(DELTA, "override"));
      expect(
        await settleAutoMergePlacementByPath(
          DELTA,
          id,
          { kind: "skipped", reason: "usage-limit" },
          { writer },
        ),
      ).toMatchObject({ status: "skipped", reason: "usage-limit" });
      expect(await read(file(DELTA, "override"))).toEqual(before);
      expect((await readAutoMerge(DELTA))?.status).toBe("current");
    }));

  test("a list the user changed since the merge is never rewritten", () =>
    run(async () => {
      const id = await merged();
      await setConfig(delta, "items", ["n", "c", "a", "b"], { writer });
      expect(await answer(id, [["s:c", "s:n", "s:a", "s:b"]])).toMatchObject({
        results: [{ verdict: "edited" }],
      });
      expect(getConfig(delta).items).toEqual(["n", "c", "a", "b"]);
    }));

  test("a review choice made while the model answers is never overwritten", () =>
    run(async () => {
      // Use mine: the list lacks the new row — refused, not thrown.
      const id = await merged();
      await resolveAutoMergeFieldByPath(
        DELTA,
        { recordId: id, field: "items", choice: "mine" },
        { writer },
      );
      expect(await answer(id, [["s:c", "s:n", "s:a", "s:b"]])).toMatchObject({
        status: "decided",
        results: [{ verdict: "edited" }],
      });
      expect(getConfig(delta).items).toEqual(["c", "a", "b"]);
      // Use new default: the same rows, the update's order — left as chosen.
      const id2 = await merged();
      await resolveAutoMergeFieldByPath(
        DELTA,
        { recordId: id2, field: "items", choice: "new-default" },
        { writer },
      );
      expect(await answer(id2, [["s:c", "s:n", "s:a", "s:b"]])).toMatchObject({
        results: [{ verdict: "edited" }],
      });
      expect(getConfig(delta).items).toEqual(["a", "b", "n", "c"]);
    }));

  test("an undone merge is not placed", () =>
    run(async () => {
      const id = await merged();
      await undoAutoMergeByPath(DELTA, { writer });
      expect(await answer(id, [["s:c", "s:n", "s:a", "s:b"]])).toMatchObject({
        status: "skipped",
        reason: "undone",
      });
      expect((await read(file(DELTA, "override")))?.content).toEqual(PRE_MERGE);
      expect(await answer("other", [])).toBeNull();
    }));
});
