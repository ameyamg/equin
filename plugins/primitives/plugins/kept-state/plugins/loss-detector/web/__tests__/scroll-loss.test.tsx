import { render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  installStorage,
  QuotaStorage,
} from "@plugins/primitives/plugins/dom/plugins/web-storage/web/testing";
import { Scroll } from "@plugins/primitives/plugins/css/plugins/scroll/web";
import { KeepScrollScope } from "@plugins/primitives/plugins/dom/plugins/auto-scroll/web";
import { transient } from "@plugins/primitives/plugins/kept-state/core";
import {
  judgeScroller,
  watchScrollLoss,
  type ScrollLoss,
} from "../internal/scroll-loss";

beforeAll(() => {
  installStorage("local", new QuotaStorage());
  installStorage("session", new QuotaStorage());
});

afterEach(() => {
  vi.useRealTimers();
});

/** jsdom lays nothing out: give a box the geometry a browser would. */
function box(
  el: HTMLElement,
  g: { clientHeight: number; scrollHeight?: number; scrollTop?: number },
): void {
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    value: g.clientHeight,
  });
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    value: g.scrollHeight ?? g.clientHeight,
  });
  el.scrollTop = g.scrollTop ?? 0;
}

/** A pane 800 px tall holding one `<Scroll>` with the given props. */
function pane(scroll: React.ReactNode) {
  const { container } = render(
    <div data-pane-id="files">
      <KeepScrollScope scope="t:1/p:abc">{scroll}</KeepScrollScope>
    </div>,
  );
  const paneEl = container.querySelector<HTMLElement>("[data-pane-id]")!;
  box(paneEl, { clientHeight: 800 });
  const el = container.querySelector<HTMLElement>("[data-scroller]")!;
  return el;
}

describe("judgeScroller", () => {
  it("flags a pane's main scroller scrolled away from its top that nothing keeps", () => {
    const el = pane(
      <Scroll data-ui-owner="FilePreview@plugins/x/web/file-preview.tsx:402">
        <p>body</p>
      </Scroll>,
    );
    box(el, { clientHeight: 800, scrollHeight: 4000, scrollTop: 1200 });
    expect(judgeScroller(el)).toEqual({
      pane: "files",
      uiOwner: "FilePreview@plugins/x/web/file-preview.tsx:402",
      offset: "top 1200 of 4000",
    } satisfies ScrollLoss);
  });

  it("passes a scroller at its top", () => {
    const el = pane(<Scroll>body</Scroll>);
    box(el, { clientHeight: 800, scrollHeight: 4000, scrollTop: 0 });
    expect(judgeScroller(el)).toBeNull();
  });

  it("passes a scroller kept by name in its keep scope", () => {
    const el = pane(<Scroll keep="file-preview">body</Scroll>);
    expect(el.getAttribute("data-scroll-kept")).toBe("t:1/p:abc#file-preview");
    box(el, { clientHeight: 800, scrollHeight: 4000, scrollTop: 1200 });
    expect(judgeScroller(el)).toBeNull();
  });

  it("passes a scroller transient by its own say", () => {
    const el = pane(
      <Scroll keep={transient("a picker's list opens at its top")}>
        body
      </Scroll>,
    );
    box(el, { clientHeight: 800, scrollHeight: 4000, scrollTop: 1200 });
    expect(judgeScroller(el)).toBeNull();
  });

  it("passes a scroller smaller than half its pane (not the pane's main scroller)", () => {
    const el = pane(<Scroll>body</Scroll>);
    box(el, { clientHeight: 300, scrollHeight: 4000, scrollTop: 1200 });
    expect(judgeScroller(el)).toBeNull();
  });

  it("passes a scroller outside every pane", () => {
    const { container } = render(<Scroll>body</Scroll>);
    const el = container.querySelector<HTMLElement>("[data-scroller]")!;
    box(el, { clientHeight: 800, scrollHeight: 4000, scrollTop: 1200 });
    expect(judgeScroller(el)).toBeNull();
  });

  it("passes a follower at its bottom, flags one parked above it", () => {
    const el = pane(<Scroll>body</Scroll>);
    el.setAttribute("data-scroll-follows", "");
    box(el, { clientHeight: 800, scrollHeight: 4000, scrollTop: 3200 });
    expect(judgeScroller(el)).toBeNull();
    el.scrollTop = 1000;
    expect(judgeScroller(el)?.offset).toBe("top 1000 of 4000");
  });

  it("does not mark a sideways scroller a scroller", () => {
    const { container } = render(<Scroll axis="x">body</Scroll>);
    expect(container.querySelector("[data-scroller]")).toBeNull();
  });
});

describe("watchScrollLoss", () => {
  it("reports a scroller once it settles, once per place", () => {
    vi.useFakeTimers();
    const el = pane(
      <Scroll data-ui-owner="Body@plugins/x/web/body.tsx:1">body</Scroll>,
    );
    box(el, { clientHeight: 800, scrollHeight: 4000, scrollTop: 0 });
    const losses: ScrollLoss[] = [];
    const stop = watchScrollLoss((loss) => losses.push(loss));

    el.scrollTop = 600;
    el.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(100);
    // Still scrolling: nothing judged yet.
    el.dispatchEvent(new Event("scroll"));
    expect(losses).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(losses.map((l) => l.offset)).toEqual(["top 600 of 4000"]);

    el.scrollTop = 900;
    el.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(1000);
    expect(losses).toHaveLength(1);
    stop();
  });

  it("ignores scrolls of an element that is not a <Scroll>", () => {
    vi.useFakeTimers();
    const { container } = render(
      <div data-pane-id="p">
        <div className="overflow-auto">body</div>
      </div>,
    );
    const el = container.querySelector<HTMLElement>(".overflow-auto")!;
    box(el, { clientHeight: 800, scrollHeight: 4000, scrollTop: 600 });
    const losses: ScrollLoss[] = [];
    const stop = watchScrollLoss((loss) => losses.push(loss));
    el.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(1000);
    expect(losses).toEqual([]);
    stop();
  });
});

describe("two live scrollers sharing a keep name", () => {
  it("throws at the second's attach", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <KeepScrollScope scope="t:1/p:abc">
          <Scroll keep="list">a</Scroll>
          <Scroll keep="list">b</Scroll>
        </KeepScrollScope>,
      ),
    ).toThrow(/Two live scrollers keep their offset under "t:1\/p:abc#list"/);
    vi.restoreAllMocks();
  });

  it("lets one scroller take a name its predecessor released", () => {
    const { rerender, container } = render(
      <KeepScrollScope scope="t:1/p:xyz">
        <Scroll key="a" keep="list">
          a
        </Scroll>
      </KeepScrollScope>,
    );
    rerender(
      <KeepScrollScope scope="t:1/p:xyz">
        <Scroll key="b" keep="list">
          b
        </Scroll>
      </KeepScrollScope>,
    );
    expect(container.querySelector("[data-scroll-kept]")?.textContent).toBe(
      "b",
    );
  });
});
