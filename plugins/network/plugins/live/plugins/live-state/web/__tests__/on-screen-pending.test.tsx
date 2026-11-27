/**
 * A read off screen holds no page: under an `OnScreenScope` that says off
 * screen, a read still waiting for its value is not a pending mount — for
 * `useResource` and each tuple of `useResources` — and it counts again once
 * its scope is back on screen while it still waits. Nested scopes AND.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock(
  "@plugins/primitives/plugins/log-channels/web",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    clientLog: () => {},
  }),
);

import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { z } from "zod";
import {
  OnScreenScope,
  pendingMountSnapshot,
  queryKeyFor,
  useResource,
  useResources,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import { createLiveStateHarness } from "../testing";
import {
  registerResourceDescriptor,
  type ResourceDescriptor,
} from "@plugins/network/plugins/live/plugins/live-state/core";

let seq = 0;
const descriptor = (): ResourceDescriptor<number[], { n: string }> => {
  const d: ResourceDescriptor<number[], { n: string }> = {
    key: `test.on-screen-pending.${seq++}`,
    schema: z.array(z.number()),
    validateParams: () => {},
  };
  registerResourceDescriptor(d as ResourceDescriptor<unknown>);
  return d;
};

const pendingOf = (key: string) =>
  pendingMountSnapshot().pendingKeys.filter((k) => k.startsWith(key)).length;

function scoped(
  live: ReturnType<typeof createLiveStateHarness>,
  outer: () => boolean,
  inner: () => boolean,
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <live.Wrapper>
        <OnScreenScope onScreen={outer()}>
          <OnScreenScope onScreen={inner()}>{children}</OnScreenScope>
        </OnScreenScope>
      </live.Wrapper>
    );
  };
}

describe("OnScreenScope and pending mounts", () => {
  it("an off-screen useResource is not pending, and is again once on screen", () => {
    const d = descriptor();
    const live = createLiveStateHarness();
    let onScreen = false;
    const { rerender } = renderHook(() => useResource(d, { n: "a" }), {
      wrapper: scoped(
        live,
        () => true,
        () => onScreen,
      ),
    });
    expect(pendingOf(d.key)).toBe(0);
    onScreen = true;
    rerender();
    expect(pendingOf(d.key)).toBe(1);
    act(() => {
      live.queryClient.setQueryData(queryKeyFor(d.key, { n: "a" }), [1]);
    });
    rerender();
    expect(pendingOf(d.key)).toBe(0);
  });

  it("a scope on screen inside one off screen is off screen", () => {
    const d = descriptor();
    const live = createLiveStateHarness();
    renderHook(() => useResource(d, { n: "a" }), {
      wrapper: scoped(
        live,
        () => false,
        () => true,
      ),
    });
    expect(pendingOf(d.key)).toBe(0);
  });

  it("useResources counts none of its tuples while off screen", () => {
    const d = descriptor();
    const live = createLiveStateHarness();
    let onScreen = false;
    const { rerender } = renderHook(
      () => useResources(d, [{ n: "a" }, { n: "b" }]),
      {
        wrapper: scoped(
          live,
          () => onScreen,
          () => true,
        ),
      },
    );
    expect(pendingMountSnapshot().pendingKeys.join()).not.toContain(d.key);
    onScreen = true;
    rerender();
    expect(pendingMountSnapshot().pendingKeys).toContain(`${d.key}×2`);
  });
});
