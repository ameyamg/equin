import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Contribution } from "@plugins/framework/plugins/web-sdk/core";
import type { SlotHandle } from "@plugins/framework/plugins/slot-declaration/core";
import type { ConfigDescriptor } from "@plugins/config_v2/core";
import { useLayoutOrder } from "../internal/use-layout-order";

/**
 * `useLayoutOrder` (what `useSlotOrder` reads) is a read: each arm of the
 * slot's config read comes through as the same arm of the order — never the raw
 * contributions standing in for a layout that is not known yet.
 */

const refetch = () => Promise.resolve();
// Hoisted with the mock: one registry, the same identity on every render.
const OVERFLOW_TYPES = vi.hoisted(
  () => new Map([["overflow", { type: "overflow", overflow: true }]]),
);
const error = new Error("boom");
type Doc = { items?: unknown[] };
let config:
  | { status: "loading"; refetch: typeof refetch }
  | { status: "ready"; data: Doc; refetch: typeof refetch }
  | { status: "error"; error: Error; stale?: Doc; refetch: typeof refetch } = {
  status: "loading",
  refetch,
};

vi.mock("@plugins/config_v2/web", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useConfigResult: () => config,
  useSetConfig: () => () => {},
}));

vi.mock("@plugins/reorder/plugins/node-types/web", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useReorderNodeTypes: () => OVERFLOW_TYPES,
}));

vi.mock("../internal/descriptors", () => ({
  reorderDescriptors: new Map([["test.slot", {} as ConfigDescriptor]]),
}));

const slot = { id: "test.slot" } as unknown as SlotHandle;
const contributions = ["a", "b", "c"].map(
  (id) => ({ _pluginId: "test.plugin", id }) as unknown as Contribution,
);
const LAYOUT = [
  "test.plugin:c",
  { item: "test.plugin:b", hidden: true },
  "test.plugin:a",
];

function idsOf(
  list:
    readonly { contribution: Contribution; overflow: boolean }[] | undefined,
): string[] {
  return (list ?? []).map(
    (p) => (p.contribution as unknown as { id: string }).id,
  );
}

function run() {
  return renderHook(() => useLayoutOrder(slot, contributions));
}

describe("useLayoutOrder", () => {
  it("is loading while the config document is", () => {
    config = { status: "loading", refetch };
    expect(run().result.current.status).toBe("loading");
  });

  it("is the layout order, hidden dropped, once ready", () => {
    config = { status: "ready", data: { items: LAYOUT }, refetch };
    const r = run().result.current;
    expect(r.status).toBe("ready");
    expect(idsOf(r.status === "ready" ? r.data : undefined)).toEqual([
      "c",
      "a",
    ]);
  });

  it("marks the members of an overflow node, at their place", () => {
    config = {
      status: "ready",
      data: {
        items: [
          "test.plugin:c",
          { type: "overflow", id: "more", items: ["test.plugin:a"] },
          "test.plugin:b",
        ],
      },
      refetch,
    };
    const r = run().result.current;
    expect(r.status === "ready" ? r.data : undefined).toEqual([
      { contribution: contributions[2], overflow: false },
      { contribution: contributions[0], overflow: true },
      { contribution: contributions[1], overflow: false },
    ]);
  });

  it("carries the last-known layout on an error with stale", () => {
    config = { status: "error", error, stale: { items: LAYOUT }, refetch };
    const r = run().result.current;
    expect(r.status).toBe("error");
    expect(idsOf(r.status === "error" ? r.stale : undefined)).toEqual([
      "c",
      "a",
    ]);
  });

  it("never falls back to the raw order on an error with nothing known", () => {
    config = { status: "error", error, refetch };
    const r = run().result.current;
    expect(r.status).toBe("error");
    expect(r.status === "error" ? r.stale : "not-error").toBeUndefined();
  });

  it("keeps its identity across renders with the same inputs", () => {
    config = { status: "ready", data: { items: LAYOUT }, refetch };
    const { result, rerender } = run();
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
