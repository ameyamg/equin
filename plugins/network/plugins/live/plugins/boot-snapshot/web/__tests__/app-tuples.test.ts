/**
 * An app's own preloads (`appTuples`): hydrated at once when their descriptor
 * is registered, else as soon as a deferred batch lands with it registered
 * (the app's priority batch lands before the first frame); a key still
 * unregistered once the deferred tier settles is reported missing — unless a
 * plugin of the app failed to load, when its tuples are dropped.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  markDeferredLoadComplete,
  markDeferredPluginsFailed,
  markDeferredPluginsLoaded,
} from "@plugins/framework/plugins/web-sdk/core";
import { resetDeferredLoadStateForTests } from "@plugins/framework/plugins/web-sdk/core/testing";

const hydrated: [string, unknown, unknown][] = [];
const registered = new Set<string>();

vi.mock(
  "@plugins/network/plugins/live/plugins/live-state/web",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    resourceDescriptorByKey: (key: string) =>
      registered.has(key) ? { key } : undefined,
    hydrateResource: (d: { key: string }, params: unknown, value: unknown) => {
      if (value === "BAD") throw new Error("schema rejected");
      hydrated.push([d.key, params, value]);
    },
  }),
);

const { hydrateAppTuples } = await import("../internal/hydrate");

const APP = "apps/plugins/mail/";
const tuples = (value: unknown = ["row"]) => ({
  "mail.threads": [{ params: { limit: "50" }, value }],
});

describe("hydrateAppTuples", () => {
  let missing: string[][];
  let failed: string[][];
  const problems = () => ({
    app: APP,
    onMissing: (k: string[]) => missing.push(k),
    onFailed: (f: string[]) => failed.push(f),
  });

  beforeEach(() => {
    hydrated.length = 0;
    registered.clear();
    missing = [];
    failed = [];
    resetDeferredLoadStateForTests();
  });

  it("hydrates a registered key at once", () => {
    registered.add("mail.threads");
    hydrateAppTuples(tuples(), problems());
    expect(hydrated).toEqual([["mail.threads", { limit: "50" }, ["row"]]]);
  });

  it("waits for a batch that registers the key, then hydrates", () => {
    hydrateAppTuples(tuples(), problems());
    markDeferredPluginsLoaded(["apps.other"]);
    expect(hydrated).toEqual([]);
    // The app's module evaluation registered the descriptor, then its batch
    // was recorded.
    registered.add("mail.threads");
    markDeferredPluginsLoaded(["apps.mail.threads"]);
    expect(hydrated).toEqual([["mail.threads", { limit: "50" }, ["row"]]]);
    markDeferredLoadComplete();
    expect(missing).toEqual([]);
  });

  it("reports a key still unregistered once every plugin has loaded", () => {
    hydrateAppTuples(tuples(), problems());
    markDeferredPluginsLoaded(["apps.mail.threads"]);
    expect(missing).toEqual([]);
    markDeferredLoadComplete();
    expect(missing).toEqual([["mail.threads"]]);
    expect(hydrated).toEqual([]);
  });

  it("drops the tuples of an app whose code failed to load", () => {
    hydrateAppTuples(tuples(), problems());
    markDeferredPluginsFailed(["apps/plugins/mail/plugins/threads"]);
    markDeferredLoadComplete();
    expect(missing).toEqual([]);
    expect(hydrated).toEqual([]);
  });

  it("reports an entry its schema rejects", () => {
    registered.add("mail.threads");
    hydrateAppTuples(tuples("BAD"), problems());
    expect(failed).toEqual([['mail.threads {"limit":"50"}: schema rejected']]);
  });
});
