import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import {
  KeepScrollScope,
  useStickyScroll,
} from "@plugins/primitives/plugins/dom/plugins/auto-scroll/web";
import { transient } from "@plugins/primitives/plugins/kept-state/core";
import { writeEntryUnchecked } from "@plugins/primitives/plugins/dom/plugins/web-storage/web/testing";
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

  it("a persisting follower keeps the reader's place itself: the keep stands down", () => {
    function Follower() {
      const { scrollRef, bottomSentinel } = useStickyScroll({
        persist: { key: "f-1", anchorAttr: "data-row" },
      });
      return (
        <Scroll
          keep={site("a.tsx#P#0")}
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
    expect(el.getAttribute("data-scroll-kept")).toBe("sticky:f-1");
  });

  it("a persisting follower stays kept when the scroller's keep re-attaches", () => {
    function Follower() {
      const { scrollRef, bottomSentinel } = useStickyScroll({
        persist: { key: "f-2", anchorAttr: "data-row" },
      });
      return (
        <Scroll
          keep={site("a.tsx#P#1")}
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
      <KeepScrollScope scope="pane-a">
        <Follower />
      </KeepScrollScope>,
    );
    // The keep scope changes under a live follower (a pane instance resolved
    // after mount): the keep attaches again, sees the persisting follower and
    // stands down again — without taking the follower's own mark with it.
    view.rerender(
      <KeepScrollScope scope="pane-b">
        <Follower />
      </KeepScrollScope>,
    );
    const el = view.container.querySelector("[data-scroller]")!;
    expect(el.getAttribute("data-scroll-kept")).toBe("sticky:f-2");
  });

  describe("a follower that does not persist", () => {
    // jsdom lays nothing out: give the scroller room to scroll.
    function sized(el: HTMLElement | null): void {
      if (!el) return;
      Object.defineProperty(el, "scrollHeight", {
        configurable: true,
        value: 2000,
      });
      Object.defineProperty(el, "clientHeight", {
        configurable: true,
        value: 400,
      });
    }
    let handle: { isFollowing: boolean; jumpToBottom: () => void } | null =
      null;
    function Follower() {
      const { scrollRef, bottomSentinel, isFollowing, jumpToBottom } =
        useStickyScroll();
      handle = { isFollowing, jumpToBottom };
      return (
        <Scroll
          keep={site("a.tsx#F#0")}
          ref={(el) => {
            sized(el);
            scrollRef.current = el as HTMLDivElement | null;
          }}
        >
          <div>rows</div>
          {bottomSentinel}
        </Scroll>
      );
    }
    const mount = () =>
      render(
        <KeepScrollScope scope="pane-9">
          <Follower />
        </KeepScrollScope>,
      );
    const scroller = (view: ReturnType<typeof render>) =>
      view.container.querySelector<HTMLElement>("[data-scroller]")!;

    it("stays kept by the scroller's reload keep", () => {
      const el = scroller(mount());
      expect(el.hasAttribute("data-scroll-follows")).toBe(true);
      expect(el.getAttribute("data-scroll-kept")).toBe("pane-9#a.tsx#F#0");
    });

    it("opens at the bottom, following, with nothing saved", () => {
      const el = scroller(mount());
      expect(handle?.isFollowing).toBe(true);
      expect(el.scrollTop).toBe(2000);
    });

    it("after a reload starts parked where the reader left it", async () => {
      // Saved by the page before the reload (another document).
      writeEntryUnchecked("auto-scroll.reload-offsets", "pane-9#a.tsx#F#0", {
        top: 700,
        doc: "the page before the reload",
      });
      const el = scroller(mount());
      expect(handle?.isFollowing).toBe(false);
      // A call site's key waits out the commit before it writes (a microtask).
      await Promise.resolve();
      expect(el.scrollTop).toBe(700);
      // Content arriving keeps it there, and does not pull it to the bottom.
      el.append(document.createElement("div"));
      await Promise.resolve();
      expect(el.scrollTop).toBe(700);
      expect(handle?.isFollowing).toBe(false);
    });

    it("following again ends the restore: arriving content no longer puts the old offset back", async () => {
      writeEntryUnchecked("auto-scroll.reload-offsets", "pane-9#a.tsx#F#0", {
        top: 700,
        doc: "the page before the reload",
      });
      const el = scroller(mount());
      await Promise.resolve();
      expect(el.scrollTop).toBe(700);
      act(() => handle!.jumpToBottom());
      expect(handle?.isFollowing).toBe(true);
      expect(el.scrollTop).toBe(2000);
      // The follower owns the anchoring again: off while it pins the bottom.
      expect(el.style.overflowAnchor).toBe("none");
      // A turn arriving: a restore still pending would put 700 back.
      el.prepend(document.createElement("div"));
      await Promise.resolve();
      expect(el.scrollTop).toBe(2000);
    });
  });
});
