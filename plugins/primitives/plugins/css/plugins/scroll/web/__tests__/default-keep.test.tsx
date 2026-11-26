import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  KeepScrollScope,
  useStickyScroll,
} from "@plugins/primitives/plugins/dom/plugins/auto-scroll/web";
import { transient } from "@plugins/primitives/plugins/kept-state/core";
import { PopupSurface } from "@plugins/primitives/plugins/overlay/plugins/popup-open/web";
import type { ScrollSite } from "../../core";
import { Scroll } from "../index";

// A SCROLLER IS KEPT BY DEFAULT, UNDER ITS CALL SITE.
//
// The build writes `keep={{ kind: "site", site }}` on every `<Scroll>` written
// without one (`vite/index.ts`); jsdom runs no build pass, so these tests write
// the stamp as the build would.

const site = (s: string): ScrollSite => ({ kind: "site", site: s });

function keptKeys(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll("[data-scroller]")].map((el) =>
    el.getAttribute("data-scroll-kept"),
  );
}

afterEach(() => cleanup());

// The follower watches its bottom sentinel; jsdom has no IntersectionObserver,
// and nothing here scrolls.
vi.stubGlobal(
  "IntersectionObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  },
);

describe("Scroll's default keep", () => {
  it("keeps under its call site in the scope", () => {
    const view = render(
      <KeepScrollScope scope="pane-1">
        <Scroll keep={site("a.tsx#A#0")} />
      </KeepScrollScope>,
    );
    expect(keptKeys(view.container)).toEqual(["pane-1#a.tsx#A#0"]);
  });

  it("one call site rendered more than once in a scope keeps nothing, and throws nothing", () => {
    function Rows({ n }: { n: number }) {
      return (
        <KeepScrollScope scope="pane-2">
          {Array.from({ length: n }, (_, i) => (
            <Scroll key={i} keep={site("a.tsx#Rows#0")} />
          ))}
        </KeepScrollScope>
      );
    }
    const view = render(<Rows n={1} />);
    // Alone, it keeps.
    expect(keptKeys(view.container)).toEqual(["pane-2#a.tsx#Rows#0"]);
    // A second instance: neither can be told apart across a reload.
    view.rerender(<Rows n={3} />);
    expect(keptKeys(view.container)).toEqual([null, null, null]);
    // And it stays so for the document, even back to one.
    view.rerender(<Rows n={1} />);
    expect(keptKeys(view.container)).toEqual([null]);
  });

  it("a call site in a popup keeps nothing; a written name still does", () => {
    const view = render(
      <KeepScrollScope scope="pane-3">
        <PopupSurface>
          <Scroll keep={site("a.tsx#Picker#0")} />
          <Scroll keep="named" />
        </PopupSurface>
      </KeepScrollScope>,
    );
    expect(keptKeys(view.container)).toEqual([null, "pane-3#named"]);
    // Says so, for the dev loss detector.
    expect(
      view.container
        .querySelector("[data-scroller]")
        ?.getAttribute("data-scroller"),
    ).toMatch(/popup/);
  });

  it("a written name is still one scroller's: a second throws", () => {
    expect(() =>
      render(
        <KeepScrollScope scope="pane-1">
          <Scroll keep="list" />
          <Scroll keep="list" />
        </KeepScrollScope>,
      ),
    ).toThrow(/Two live scrollers keep their offset/);
  });

  it("transient, sideways, or outside a scope keeps nothing", () => {
    const view = render(
      <>
        <KeepScrollScope scope="pane-1">
          <Scroll keep={transient("a picker list")} />
          <Scroll axis="x" keep={site("a.tsx#A#1")} />
        </KeepScrollScope>
        <Scroll keep={site("a.tsx#A#2")} />
      </>,
    );
    expect(keptKeys(view.container)).toEqual([null, null]);
    expect(view.container.querySelectorAll("[data-scroll-kept]")).toHaveLength(
      0,
    );
  });

  it("a stick-to-bottom follower on the scroller takes its offset over", () => {
    function Follower() {
      const { scrollRef, bottomSentinel } = useStickyScroll();
      return (
        <Scroll
          keep={site("a.tsx#F#0")}
          ref={(el) => {
            scrollRef.current = el as HTMLDivElement | null;
          }}
        >
          <div>rows</div>
          {bottomSentinel}
        </Scroll>
      );
    }
    const view = render(
      <KeepScrollScope scope="pane-1">
        <Follower />
      </KeepScrollScope>,
    );
    const el = view.container.querySelector("[data-scroller]")!;
    expect(el.hasAttribute("data-scroll-follows")).toBe(true);
    expect(el.hasAttribute("data-scroll-kept")).toBe(false);
  });
});
