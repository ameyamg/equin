import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tracked = vi.hoisted(() => [] as { name: string; props: unknown }[]);
vi.mock("../internal/instance", () => ({
  registerPageSection: () => () => undefined,
  track: (name: string, props: unknown) => tracked.push({ name, props }),
}));

import { observeSectionReach } from "../internal/section-reach";

/** Every IntersectionObserver built, with its options, fed entries by hand. */
interface FakeObserver {
  options: IntersectionObserverInit | undefined;
  callback: IntersectionObserverCallback;
  disconnected: boolean;
}
let observers: FakeObserver[] = [];

beforeEach(() => {
  observers = [];
  tracked.length = 0;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      record: FakeObserver;
      constructor(
        callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit,
      ) {
        this.record = { options, callback, disconnected: false };
        observers.push(this.record);
      }
      observe() {}
      disconnect() {
        this.record.disconnected = true;
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const pastMiddle = () => observers.find((o) => o.options?.rootMargin)!;
const wholly = () => observers.find((o) => o.options?.threshold === 1)!;

function deliver(o: FakeObserver, isIntersecting: boolean, ratio: number) {
  o.callback(
    [
      {
        isIntersecting,
        intersectionRatio: ratio,
      } as IntersectionObserverEntry,
    ],
    {} as IntersectionObserver,
  );
}

describe("section reach", () => {
  it("counts a section whose top passes the middle of the screen", () => {
    observeSectionReach(document.createElement("section"), "landing/layers");
    deliver(pastMiddle(), true, 0.2);
    expect(tracked).toEqual([
      { name: "section_reach", props: { section: "landing/layers" } },
    ]);
  });

  it("counts a short section wholly on screen whose top never gets past the middle (the footer)", () => {
    observeSectionReach(document.createElement("footer"), "landing/footer");
    deliver(wholly(), true, 0.6);
    expect(tracked).toEqual([]);
    deliver(wholly(), true, 1);
    expect(tracked).toEqual([
      { name: "section_reach", props: { section: "landing/footer" } },
    ]);
  });

  it("records once, and stops watching, whichever rule reaches it first", () => {
    observeSectionReach(document.createElement("section"), "landing/hero");
    deliver(wholly(), true, 1);
    deliver(pastMiddle(), true, 1);
    expect(tracked).toHaveLength(1);
    expect(observers.every((o) => o.disconnected)).toBe(true);
  });
});
