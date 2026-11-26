import { Core } from "@plugins/framework/plugins/web-sdk/core";
import {
  sendEndpointRequest,
  readEndpointResponse,
} from "@plugins/infra/plugins/endpoints/core";
import { recordPagePrincipal } from "@plugins/framework/plugins/principal/web";
import { pageTransport } from "@plugins/primitives/plugins/networking/plugins/page-transport/web";
import { recordBootSpan } from "@plugins/primitives/plugins/perfs/plugins/boot-trace/web";
import { report } from "@plugins/reports/web";
import { bootSnapshot } from "../../core";
import {
  HEAD_REQUEST_GLOBAL,
  type HeadRequest,
} from "../../shared/head-request";
import { hydrateAppTuples, hydrateBootSnapshot } from "./hydrate";

/**
 * The snapshot request the shell's head started (`server/internal/head-request.ts`),
 * taken once: a second boot in the same page (Retry after a failed boot) asks
 * afresh rather than re-reading a consumed body. `absent` when the shell was
 * served without the head fragment — a backend that never published its
 * document head, or a page that is not the gateway's shell — and the boot task
 * then sends the request itself, as it did before the head started it.
 */
function takeHeadRequest():
  { kind: "taken"; request: HeadRequest } | { kind: "absent" } {
  const value: unknown = Reflect.get(globalThis, HEAD_REQUEST_GLOBAL);
  if (value === undefined) return { kind: "absent" };
  Reflect.deleteProperty(globalThis, HEAD_REQUEST_GLOBAL);
  if (
    typeof value !== "object" ||
    value === null ||
    !("response" in value) ||
    !(value.response instanceof Promise) ||
    !("startMs" in value) ||
    typeof value.startMs !== "number" ||
    ("app" in value && value.app !== null && typeof value.app !== "string")
  ) {
    throw new Error(
      `boot-snapshot: globalThis.${HEAD_REQUEST_GLOBAL} is not the head script's request`,
    );
  }
  return {
    kind: "taken",
    request: {
      response: value.response as Promise<Response>,
      startMs: value.startMs,
      // A shell whose head an older backend published names no app.
      app: "app" in value ? (value.app as string | null) : null,
    },
  };
}

/**
 * The app the page's first boot asked for (the head request's `?app=`),
 * kept so a second boot in the same page (Retry) asks for the same one. A
 * page whose shell carried no head request asks for none — its app's own
 * preloads then load with the app, as without them.
 */
let bootApp: string | null = null;

/** A boot-snapshot problem, filed as a crash (see the two call sites). */
function reportBootSnapshotProblem(errorType: string, summary: string): void {
  // The crash collector's window error listener is NOT mounted yet during the boot
  // window (RenderCoreRoot mounts after the boot tasks settle), so a queueMicrotask
  // throw would only reach the console. report() is a direct keepalive POST that
  // files a deduped crash task regardless of mount state.
  void report({
    kind: "crash",
    source: "boot-snapshot",
    message: summary,
    url: window.location.href,
    userAgent: navigator.userAgent,
    // Matches the crash kind's CrashPayloadSchema (errorType + stack). No real
    // Error is thrown here, so we synthesize a minimal stack for fingerprinting.
    data: { errorType, stack: new Error(summary).stack ?? null },
  });
}

function reportHydrateFailed(failed: readonly string[]): void {
  const more = failed.length > 5 ? ` (+${failed.length - 5} more)` : "";
  const summary = `boot-snapshot: hydrate failed for ${failed.slice(0, 5).join("; ")}${more}`;
  console.error(`[boot-snapshot] ${summary}`);
  reportBootSnapshotProblem("BootSnapshotHydrateFailed", summary);
}

function reportMissing(missing: readonly string[]): void {
  const summary = `boot-snapshot: unresolved descriptor key(s): ${missing.join(", ")}`;
  console.error(
    `[boot-snapshot] no descriptor registered for: ${missing.join(", ")}`,
  );
  reportBootSnapshotProblem("BootSnapshotUnresolvedDescriptor", summary);
}

// Boot-readiness task: fetch every boot-critical resource in ONE request and seed the
// live-state cache before first paint (no `pending` flash, no WS round-trip).
//
// The snapshot ships ONLY boot-critical resources (the single source is the shared
// descriptor's `preload`, which `Resource.Declare` derives) and omits any whose loader failed this
// boot, so ITS KEYS are the authoritative set to hydrate (`hydrateBootSnapshot`). A
// snapshot key with no registered descriptor means a boot-critical resource whose
// descriptor was not in the eager web import graph — a real bug, surfaced loudly rather
// than silently lost.
export async function runBootSnapshot(): Promise<void> {
  // Boot belongs to the page: the snapshot always hydrates from the page's own
  // server. A substrate read of live itself (it seeds the cache `useLive`
  // reads), so it is the transport's raw fetch, kept on the contract: the
  // request built and the reply decoded by the endpoint's own codec. Normally
  // the shell's head already sent that same request at t0; only its reply is
  // read here.
  const head = takeHeadRequest();
  if (head.kind === "taken") bootApp = head.request.app;
  const reqStart =
    head.kind === "taken" ? head.request.startMs : performance.now();
  const { caller, resources, tuples, appTuples, timings } =
    await readEndpointResponse(
      bootSnapshot,
      await (head.kind === "taken"
        ? head.request.response
        : sendEndpointRequest(
            pageTransport.fetch,
            bootSnapshot,
            {},
            {
              query: bootApp === null ? {} : { app: bootApp },
            },
          )),
    );
  // Who the page's server takes this page for, recorded before anything
  // renders: a deployed site's visitor page then never sends a write its
  // server only takes from the owner.
  if (caller !== undefined) recordPagePrincipal(caller);
  const reqMs = performance.now() - reqStart;
  recordBootSpan({
    id: "boot-snapshot",
    phase: "boot-tasks",
    label: "Boot snapshot fetch",
    startMs: reqStart,
    durationMs: reqMs,
  });
  for (const key of [
    ...Object.keys(resources),
    ...Object.keys(tuples),
    ...Object.keys(appTuples).map((k) => `app:${k}`),
  ]) {
    const t = timings[key];
    recordBootSpan({
      id: `res:${key}`,
      phase: "resources",
      label: key,
      startMs: reqStart,
      durationMs: reqMs,
      workMs: t?.workMs,
      detail: t?.source,
    });
  }
  const { missing, failed } = hydrateBootSnapshot({ resources, tuples });
  // The "first commit after boot snapshot" instant (FIRST_DATA_COMMIT_ID) is
  // armed by App itself, right before it swaps the boot screen for the app: the
  // boot screen commits too (its elapsed clock), so "the next commit after this
  // hydrate" would no longer be App's first real render.
  if (failed.length) reportHydrateFailed(failed);
  if (missing.length) reportMissing(missing);
  // The app's own preloads: hydrated as their app's code registers them,
  // before the first frame (the boot holds for the app's code).
  hydrateAppTuples(appTuples, {
    app: bootApp,
    onMissing: reportMissing,
    onFailed: reportHydrateFailed,
  });
}

// `block`: without the snapshot the app has no boot-critical data. A stalled or
// failing snapshot shows App's boot error state (and files a client report)
// rather than painting an app whose every read is a stand-in.
export const bootSnapshotTask = Core.Boot({
  label: "Boot snapshot",
  ifUnavailable: "block",
  run: runBootSnapshot,
});
