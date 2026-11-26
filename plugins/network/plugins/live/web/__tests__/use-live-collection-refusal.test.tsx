/**
 * useLive over a collection that declares `refusals`: a refused window read
 * (the head page) is the error arm with `kind: "refused"` and the server's
 * code, typed by the declaration — read through the real HTTP path
 * (`fetchOverHttp`, network `fetch` stubbed to the runtime's 422 body), so
 * the window descriptor's own `refusals` is what lets the code through; a
 * code the collection does not list is the tab out of date. Not retried: the
 * read asks once. The same through a viewport read.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "@plugins/primitives/plugins/log-channels/web",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    clientLog: () => {},
  }),
);

import { act, renderHook, waitFor } from "@testing-library/react";
import { intField } from "@plugins/fields/plugins/int/plugins/config/core";
import { textField } from "@plugins/fields/plugins/text/plugins/config/core";
import { queryKeyFor } from "@plugins/network/plugins/live/plugins/live-state/web";
import {
  createLiveStateHarness,
  type LiveStateHarness,
  resetResourceContractMismatches,
} from "@plugins/network/plugins/live/plugins/live-state/web/testing";
import { liveCollection } from "@plugins/network/plugins/live/core";
import { useLive } from "../internal/use-live";
import { mintVisibleRange } from "../internal/visible-range";

const FIELDS = {
  title: textField({ label: "Title" }),
};
const CARRY = { id: textField(), rank: intField() };

let seq = 0;
const SPEC = {
  fields: FIELDS,
  carry: { fields: CARRY },
  id: "id",
  sortable: ["rank"],
  default: { orderBy: [["rank", "asc"]], limit: 2 },
  maxLimit: 4,
} as const;
const key = () => `test.use-live-collection-refusal.${seq++}`;
/** A collection whose source may refuse a window (the Mail threads' codes). */
const threads = () =>
  liveCollection(key(), {
    ...SPEC,
    refusals: ["not-connected", "offline-not-cached"],
  });
/** The same collection, declaring none. */
const plainThreads = () => liveCollection(key(), SPEC);

/** The network answers every resource read with the runtime's refusal body. */
function refuseWith(body: Record<string, unknown>) {
  const fetch = vi.fn(() =>
    Promise.resolve({
      status: 422,
      ok: false,
      headers: { get: () => null },
      json: async () => ({ reason: "refused", ...body }),
    } as unknown as Response),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** Read the head page's tuple over HTTP, as a `sub-error` makes the client do. */
async function readHead(
  live: LiveStateHarness,
  key: string,
  params: Record<string, string>,
) {
  await act(async () => {
    await live.queryClient
      .getQueryCache()
      .find({ queryKey: queryKeyFor(key, params), exact: true })!
      .fetch()
      .catch((err: unknown) => {
        if (!(err instanceof Error)) throw err;
      });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetResourceContractMismatches();
});

describe("useLive — a collection's declared refusals", () => {
  it("a refused window is the error arm, `refused`, its code typed — and never retried", async () => {
    const c = threads();
    const fetch = refuseWith({
      code: "not-connected",
      detail: "Connect your Gmail account",
    });
    const live = createLiveStateHarness();
    vi.spyOn(live.notifications, "hasEverBeenReady").mockReturnValue(true);
    const { result } = renderHook(() => useLive(c), { wrapper: live.Wrapper });
    expect(result.current.status).toBe("loading");
    await readHead(live, c.key, c.window.defaultParams);
    await waitFor(() => expect(result.current.status).toBe("error"));
    const r = result.current;
    if (r.status !== "error") throw new Error("unreachable");
    expect(r.error.kind).toBe("refused");
    expect(r.error.message).toBe("Connect your Gmail account");
    const code: "not-connected" | "offline-not-cached" | undefined =
      r.error.code;
    expect(code).toBe("not-connected");
    // @ts-expect-error — "gone" is not one of the declared codes
    void (r.error.code === "gone");
    // One read, no retry: the same question gets the same answer.
    await act(async () => {
      await new Promise((res) => setTimeout(res, 20));
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("a viewport read's refused head is its error arm the same way", async () => {
    const c = threads();
    refuseWith({ code: "offline-not-cached", detail: "Offline" });
    const live = createLiveStateHarness();
    vi.spyOn(live.notifications, "hasEverBeenReady").mockReturnValue(true);
    const viewport = mintVisibleRange({ kind: "measuring" });
    const { result } = renderHook(() => useLive(c, {}, { viewport }), {
      wrapper: live.Wrapper,
    });
    await readHead(live, c.key, c.window.defaultParams);
    await waitFor(() => expect(result.current.status).toBe("error"));
    const r = result.current;
    if (r.status !== "error") throw new Error("unreachable");
    expect(r.error.kind).toBe("refused");
    const offline: boolean = r.error.code === "offline-not-cached";
    expect(offline).toBe(true);
  });

  it("a code the collection does not list is the tab out of date, not a refusal", async () => {
    const c = threads();
    refuseWith({ code: "gone", detail: "it went away" });
    const live = createLiveStateHarness();
    vi.spyOn(live.notifications, "hasEverBeenReady").mockReturnValue(true);
    const { result } = renderHook(() => useLive(c), { wrapper: live.Wrapper });
    await readHead(live, c.key, c.window.defaultParams);
    await waitFor(() => expect(result.current.status).toBe("error"));
    const r = result.current;
    if (r.status !== "error") throw new Error("unreachable");
    expect(r.error.kind).toBe("client-outdated");
    expect(r.error.code).toBeUndefined();
  });

  it("a collection that declares none takes any refusal as a contract mismatch", async () => {
    const c = plainThreads();
    refuseWith({ code: "not-connected", detail: "Connect" });
    const live = createLiveStateHarness();
    vi.spyOn(live.notifications, "hasEverBeenReady").mockReturnValue(true);
    const { result } = renderHook(() => useLive(c), { wrapper: live.Wrapper });
    await readHead(live, c.key, c.window.defaultParams);
    await waitFor(() => expect(result.current.status).toBe("error"));
    const r = result.current;
    if (r.status !== "error") throw new Error("unreachable");
    expect(r.error.kind).toBe("client-outdated");
    // Its error arm is typed as it always was.
    const code: string | undefined = r.error.code;
    void code;
  });
});
