import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { useNear } from "../internal/use-near";

/** The one observer the hook builds; `show(on)` reports its target on or off screen. */
class FakeIntersectionObserver {
  static live: FakeIntersectionObserver | null = null;
  target: Element | null = null;
  constructor(public cb: IntersectionObserverCallback) {
    FakeIntersectionObserver.live = this;
  }
  observe(el: Element): void {
    this.target = el;
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  show(on: boolean): void {
    const entry = {
      target: this.target,
      isIntersecting: on,
    } as unknown as IntersectionObserverEntry;
    act(() => this.cb([entry], this as unknown as IntersectionObserver));
  }
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  FakeIntersectionObserver.live = null;
});

function Box() {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNear(ref);
  return <div ref={ref}>{near ? "near" : "far"}</div>;
}

describe("useNear", () => {
  it("is false until observed, then follows the box both ways", () => {
    render(<Box />);
    expect(screen.getByText("far")).toBeTruthy();
    const io = FakeIntersectionObserver.live!;
    expect(io.target).not.toBeNull();
    io.show(true);
    expect(screen.getByText("near")).toBeTruthy();
    io.show(false);
    expect(screen.getByText("far")).toBeTruthy();
  });
});
