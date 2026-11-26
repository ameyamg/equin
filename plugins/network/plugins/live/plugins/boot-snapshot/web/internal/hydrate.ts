import {
  hydrateResource,
  resourceDescriptorByKey,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import {
  getDeferredLoadState,
  hasLoadErrorUnder,
  subscribeDeferredLoadState,
} from "@plugins/framework/plugins/web-sdk/core";

/** The part of a boot snapshot the cache is seeded from (the endpoint's body, timings aside). */
export interface BootSnapshotValues {
  resources: Record<string, unknown>;
  tuples: Record<
    string,
    readonly { params: Record<string, string>; value: unknown }[]
  >;
}

/** What a hydrate pass could not seed: keys with no descriptor, entries whose value failed. */
export interface BootSnapshotHydration {
  /** Snapshot keys no evaluated descriptor registered (its module is not loaded). */
  missing: string[];
  /** `<key> <params>: <message>` per entry its client schema rejected. */
  failed: string[];
}

/**
 * Seed the live-state cache from a boot snapshot — THE hydrate path, shared by
 * the page's boot task and a static render (`primitives/dom/static-render`).
 *
 * The snapshot's keys are the authoritative set: each resolves to its client
 * descriptor through the live-state descriptor registry (populated when the
 * descriptor's module is evaluated). One bad entry (a value its client schema
 * rejects) must not stop every entry after it: each hydrate is isolated, and
 * every failure is returned for the caller to surface.
 */
export function hydrateBootSnapshot(
  snapshot: BootSnapshotValues,
): BootSnapshotHydration {
  const missing: string[] = [];
  const failed: string[] = [];
  const hydrate = (
    d: NonNullable<ReturnType<typeof resourceDescriptorByKey>>,
    params: Record<string, string> | undefined,
    value: unknown,
  ) => {
    try {
      hydrateResource(d, params, value);
    } catch (err) {
      failed.push(
        `${d.key} ${JSON.stringify(params ?? {})}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
  for (const key of Object.keys(snapshot.resources)) {
    const d = resourceDescriptorByKey(key);
    if (!d) {
      missing.push(key);
      continue;
    }
    // A descriptor with defaultParams (a windowed resource's default window)
    // hydrates at that tuple — the same one the server's fallback loader used
    // and the one a bare useLive(c) subscribes to. Plain global resources
    // keep the param-less tuple.
    hydrate(d, d.defaultParams, snapshot.resources[key]);
  }
  // An enumerated preload (a parameterized value) ships every tuple with its
  // params — canonical, the same tuple its readers subscribe.
  for (const [key, entries] of Object.entries(snapshot.tuples)) {
    const d = resourceDescriptorByKey(key);
    if (!d) {
      missing.push(key);
      continue;
    }
    for (const e of entries) hydrate(d, e.params, e.value);
  }
  return { missing, failed };
}

/** What an app-tuple hydrate could not seed, reported as it is found. */
export interface AppTupleProblems {
  /** The app the snapshot was asked for (its plugin subtree), whose code registers the keys. */
  app: string | null;
  /** Keys still unregistered once every plugin has loaded (the app's own load did not fail). */
  onMissing: (keys: string[]) => void;
  /** `<key> <params>: <message>` per entry its client schema rejected. */
  onFailed: (failed: string[]) => void;
}

/**
 * Seed the cache with an app's own preloads (the snapshot's `appTuples`).
 * Their descriptors are registered by the APP's code, which loads beside the
 * boot snapshot (web-core's "App code" boot task), not by the eager tier: a
 * key registered now is hydrated now, any other once a deferred batch lands
 * with it registered — the app's priority batch registers before the first
 * frame commits, so the rows are there for it. A key still unregistered once
 * the deferred tier has settled is a missing descriptor, reported — unless a
 * plugin of the app failed to load (that is reported by the loader), when
 * its tuples are dropped. Returns a stop for a caller abandoning the wait.
 */
export function hydrateAppTuples(
  appTuples: BootSnapshotValues["tuples"],
  problems: AppTupleProblems,
): () => void {
  const parked = new Map(Object.entries(appTuples));
  const pass = () => {
    const failed: string[] = [];
    const missing: string[] = [];
    const complete = getDeferredLoadState().deferredComplete;
    for (const [key, entries] of parked) {
      const d = resourceDescriptorByKey(key);
      if (!d) {
        if (!complete) continue;
        parked.delete(key);
        if (problems.app === null || !hasLoadErrorUnder(problems.app)) {
          missing.push(key);
        }
        continue;
      }
      parked.delete(key);
      for (const e of entries) {
        try {
          hydrateResource(d, e.params, e.value);
        } catch (err) {
          failed.push(
            `${key} ${JSON.stringify(e.params)}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
    if (missing.length > 0) problems.onMissing(missing);
    if (failed.length > 0) problems.onFailed(failed);
  };
  pass();
  if (parked.size === 0) return () => undefined;
  const stop = subscribeDeferredLoadState(() => {
    pass();
    if (parked.size === 0) stop();
  });
  return stop;
}
