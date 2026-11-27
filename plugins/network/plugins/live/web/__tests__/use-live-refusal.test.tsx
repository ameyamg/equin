/**
 * useLive over a value that declares `refusals`: a refused read's error arm
 * is `kind: "refused"` with the server's code, typed by the declaration; a
 * code the declaration does not list is a contract mismatch (this tab's
 * bundle does not know it) — `client-outdated`, never a refusal. Harness: a
 * real NotificationsProvider + QueryClient + the real HTTP read
 * (`fetchOverHttp`), with the network `fetch` stubbed to answer the runtime's
 * 422 body.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "@plugins/primitives/plugins/log-channels/web",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    clientLog: () => {},
  }),
);

import { renderHook, waitFor } from "@testing-library/react";
import { z } from "zod";
import { pendingMountSnapshot } from "@plugins/network/plugins/live/plugins/live-state/web";
import {
  createLiveStateHarness,
  type LiveStateHarness,
  resetResourceContractMismatches,
} from "@plugins/network/plugins/live/plugins/live-state/web/testing";
import { liveValue } from "@plugins/network/plugins/live/core";
import { useLive } from "@plugins/network/plugins/live/web";

const Result = z.object({ n: z.number() });

let seq = 0;
const key = () => `test.use-live-refusal.${seq++}`;

function mount<R>(live: LiveStateHarness, useHook: () => R) {
  const notifications = live.notifications;
  // Before the first render: a fresh client would cold-start prime over HTTP.
  vi.spyOn(notifications, "hasEverBeenReady").mockReturnValue(true);
  const rendered = renderHook(useHook, { wrapper: live.Wrapper });
  return rendered;
}

/** The network answers every resource read with the runtime's refusal body. */
function refuseWith(body: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        status: 422,
        ok: false,
        headers: { get: () => null },
        json: async () => ({ reason: "refused", ...body }),
      } as unknown as Response),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetResourceContractMismatches();
});

describe("useLive — a value's declared refusals", () => {
  it("a declared code reaches the error arm as `refused`, typed", async () => {
    const v = liveValue(key(), {
      schema: Result,
      params: ["path"],
      load: "on-demand",
      refusals: z.enum(["missing", "denied"]),
    });
    refuseWith({ code: "missing", detail: "no such file" });
    const { result } = mount(createLiveStateHarness(), () =>
      useLive(v, { path: "/x" }),
    );
    await waitFor(() => expect(result.current.status).toBe("error"));
    const r = result.current;
    if (r.status !== "error") throw new Error("unreachable");
    expect(r.error.kind).toBe("refused");
    expect(r.error.message).toBe("no such file");
    // The code is the declaration's: a surface branches on it.
    const missing: boolean = r.error.code === "missing";
    expect(missing).toBe(true);
  });

  it("a code the declaration does not list is the tab out of date, not a refusal", async () => {
    const v = liveValue(key(), {
      schema: Result,
      load: "on-demand",
      refusals: ["missing"],
    });
    refuseWith({ code: "gone", detail: "it went away" });
    const { result } = mount(createLiveStateHarness(), () => useLive(v));
    await waitFor(() => expect(result.current.status).toBe("error"));
    const r = result.current;
    if (r.status !== "error") throw new Error("unreachable");
    expect(r.error.kind).toBe("client-outdated");
    expect(r.error.code).toBeUndefined();
  });

  it("a value that declares none takes any refusal as a contract mismatch", async () => {
    const v = liveValue(key(), { schema: Result, load: "on-demand" });
    refuseWith({ code: "missing", detail: "no such file" });
    const { result } = mount(createLiveStateHarness(), () => useLive(v));
    await waitFor(() => expect(result.current.status).toBe("error"));
    const r = result.current;
    if (r.status !== "error") throw new Error("unreachable");
    expect(r.error.kind).toBe("client-outdated");
  });

  it("types: the code is the declaration's, and only a declaring value can refuse", () => {
    const declared = liveValue(key(), {
      schema: Result,
      load: "on-demand",
      refusals: ["missing", "too-large"],
    });
    const plain = liveValue(key(), { schema: Result, load: "on-demand" });
    expect(declared.refuse("missing", "m").code).toBe("missing");
    // Never called — the assertions are the `@ts-expect-error`s.
    const useTypeOnly = () => {
      const r = useLive(declared);
      if (r.status === "error") {
        const code: "missing" | "too-large" | undefined = r.error.code;
        void code;
        // @ts-expect-error — "gone" is not one of the declared codes
        void (r.error.code === "gone");
      }
      const p = useLive(plain);
      if (p.status === "error") {
        // A value that declares no refusals is never refused: no code.
        const none: undefined = p.error.code;
        void none;
      }
      // @ts-expect-error — not a declared code
      void declared.refuse("gone", "x");
      // @ts-expect-error — a value that declares no refusals has no `refuse`
      void plain.refuse("missing", "x");
    };
    expect(typeof useTypeOnly).toBe("function");
  });

  // A refusal is the read's answer: the page waits on it no more. Counting
  // it held /agents' page loads "loading" until the ledger's 60 s cap
  // (task-1795742660-dvmhjx: a transcript chip's stat of a path now gone).
  it("a refused read is no longer a pending mount", async () => {
    const v = liveValue(key(), {
      schema: Result,
      params: ["path"],
      load: "on-demand",
      refusals: ["missing"],
    });
    refuseWith({ code: "missing", detail: "no such file" });
    const before = pendingMountSnapshot().pending;
    const { result, unmount } = mount(createLiveStateHarness(), () =>
      useLive(v, { path: "/gone" }),
    );
    expect(pendingMountSnapshot().pending).toBe(before + 1);
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(pendingMountSnapshot().pending).toBe(before);
    expect(pendingMountSnapshot().pendingKeys).not.toContain(v.key);
    unmount();
    expect(pendingMountSnapshot().pending).toBe(before);
  });

  it("a refused tuple of a list read is no longer a pending mount", async () => {
    const v = liveValue(key(), {
      schema: Result,
      params: ["path"],
      load: "on-demand",
      refusals: ["missing"],
    });
    refuseWith({ code: "missing", detail: "no such file" });
    const before = pendingMountSnapshot().pending;
    const { result, unmount } = mount(createLiveStateHarness(), () =>
      useLive(v, [{ path: "/a" }, { path: "/b" }]),
    );
    expect(pendingMountSnapshot().pending).toBe(before + 2);
    await waitFor(() =>
      expect(result.current.map((r) => r.status)).toEqual(["error", "error"]),
    );
    expect(pendingMountSnapshot().pending).toBe(before);
    unmount();
  });

  it("a failure that is no refusal stays a pending mount (it may heal)", async () => {
    const v = liveValue(key(), {
      schema: Result,
      params: ["path"],
      load: "on-demand",
      refusals: ["missing"],
    });
    // An undeclared code: a contract mismatch, not an answer.
    refuseWith({ code: "gone", detail: "it went away" });
    const before = pendingMountSnapshot().pending;
    const { result, unmount } = mount(createLiveStateHarness(), () =>
      useLive(v, { path: "/x" }),
    );
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(pendingMountSnapshot().pending).toBe(before + 1);
    unmount();
    expect(pendingMountSnapshot().pending).toBe(before);
  });
});
