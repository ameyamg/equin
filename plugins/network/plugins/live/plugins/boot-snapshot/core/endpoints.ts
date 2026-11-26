import { z } from "zod";
import { defineEndpoint } from "@plugins/infra/plugins/endpoints/core";

// One-shot snapshot fetched at boot to hydrate the live-state cache before first
// paint. `resources` maps each boot-critical resource's KEY to its freshly
// loaded value; the client matches keys against its registered descriptors and
// `hydrateResource(...)`s each one, so the first render reads real data instead
// of `pending`/defaults — no flash, no WS round-trip.
//
// `resources` holds the DEFAULT-TUPLE preloads (a param-less resource, a
// collection's default window — hydrated at the descriptor's `defaultParams`).
// `tuples` holds the ENUMERATED preloads: a parameterized value whose served half
// names the tuples to hydrate (`preloadParams`), each shipped with its params —
// the server knows those at boot even though no route has named them. A failed
// loader is omitted (not fatal, but reported) — that tuple falls back to its
// normal WS sub-ack.
//
// NOTE: the plan's `version` per entry is intentionally omitted — `hydrateResource`
// doesn't consume it and the version-aware sub-skip (Phase D) is out of scope.
//
// `timings` is additive (existing `{ resources }` consumers keep working): per-key
// server work time and where the value came from — `memory` (a persisted alias's
// kept in-memory snapshot, fresher than its trailing L2 row), `persisted` (a
// share of the one L2 read), or `loader` (a from-scratch load) — consumed by the
// boot profiler to split wait vs work.
const bootSnapshotSource = z.enum(["memory", "persisted", "loader"]);
export type BootSnapshotSource = z.infer<typeof bootSnapshotSource>;

/** One key's enumerated tuples, each with its params. */
const tupleListSchema = z.array(
  z.object({
    params: z.record(z.string(), z.string()),
    value: z.unknown(),
  }),
);

export const bootSnapshot = defineEndpoint({
  route: "GET /api/resources/boot-snapshot",
  // The app the page boots — its plugin subtree, `apps/plugins/<app>/`
  // (apps-core/app-preload's `appRootOf`): the snapshot then also carries the
  // app-scoped preloads of that app's plugins (`appTuples`). Absent: a page
  // outside every app, or a boot that does not know its app (a Retry).
  query: z.object({ app: z.string().optional() }),
  // Like the live-state read it front-loads (`GET /api/resources/:key`): every
  // page of a deployed site boots from it.
  access: {
    visitor:
      "every page of a deployed site boots from it; it carries the boot resources of the composition the site runs",
  },
  response: z.object({
    // Who the page's server took this request for — the same verdict that
    // picked the resources below. The page records it (`framework/principal`'s
    // `recordPagePrincipal`), so it never sends a write its server refuses a
    // visitor (`useWriteAvailability`, `infra/endpoints`). Optional: a backend
    // older than the field answers without it, and the page then knows nothing
    // (its server's gate stays the authority).
    caller: z.enum(["owner", "visitor"]).optional(),
    resources: z.record(z.string(), z.unknown()),
    tuples: z.record(z.string(), tupleListSchema),
    // The app-scoped preloads (`Resource.Declare`'s `appPreload`) of the app
    // named by `app`, as `tuples`. Their descriptors load with the app's code,
    // not eagerly: the boot hydrates each once registered. Timed under
    // `app:<key>`. Defaulted: a backend older than the field answers without it.
    appTuples: z.record(z.string(), tupleListSchema).default({}),
    timings: z.record(
      z.string(),
      z.object({
        source: bootSnapshotSource,
        workMs: z.number(),
      }),
    ),
  }),
});
