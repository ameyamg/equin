import { findScrollParent } from "@plugins/primitives/plugins/dom/plugins/auto-scroll/web";
import { revealElement } from "@plugins/primitives/plugins/dom/plugins/scroll-reveal/web";
import { CHAPTERS, isSpan } from "./chapters";
import { all, clamp01, lerp, one } from "./math";
import type { RGB } from "./renderer";
import { mountScene } from "./scene";

/**
 * The page's scroll skeleton: the heading, then a pinned stage (the picture)
 * with the chapter cards scrolling over it and the chapter strip pinned under
 * the site header.
 *
 * Scroll → p. Each card stands for a place on the picture's timeline: the
 * picture is there when the card's centre crosses the middle of the screen,
 * holds while the card is read (HOLD of a screen either side), and moves on as
 * the card leaves. A card with a span of the timeline is sticky: it stays in
 * place while the scroll plays its span, from the moment it sticks to the
 * moment its step lets it go.
 *
 * Everything is read from the PANE's scroll container, never the window: the
 * "screen" is its viewport (`--screen`), and the header is the part of it the
 * site header takes (`--ps-head`). One measure per frame of scrolling; nothing
 * runs here while idle.
 */
export interface PluginSystemScroll {
  /** The pane's viewport, or the page, changed size. */
  resize(): void;
  dispose(): void;
}

const HOLD = 0.14;
/** A held card sticks this far above the middle of the screen (the stylesheet's `.psys-step.is-hold .psys-card`). */
const HOLD_LIFT = 70;
/** The chapter strip's height under the header. */
const STRIP = 34;

/** A `#rrggbb` custom property of the page's palette. */
function paletteColor(root: HTMLElement, name: string): RGB {
  const v = getComputedStyle(root).getPropertyValue(name).trim();
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  if (!m)
    throw new Error(`[plugin-system] ${name} is not a #rrggbb colour: "${v}"`);
  const h = m[1]!;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export function mountPluginSystemScroll(root: HTMLElement): PluginSystemScroll {
  const scroller = findScrollParent(root);
  const page = root.closest<HTMLElement>(".plugin-system-page");
  const zoom = one<HTMLElement>(root, ".psys");
  const stage = one<HTMLElement>(root, ".psys-stage");
  const steps = all<HTMLElement>(root, ".psys-step");
  const cards = steps.map((s) => one<HTMLElement>(s, ".psys-card"));
  const strip = one<HTMLElement>(root, ".psys-strip");
  const segs = all<HTMLButtonElement>(strip, ".psys-strip-seg button");
  const label = one<HTMLElement>(strip, ".psys-strip-label");
  // the layouts the stylesheet switches between
  const narrow = matchMedia("(max-width: 760px)");
  const beside = matchMedia("(min-width: 901px)");

  const screen = () => scroller.clientHeight;
  const scrollerTop = () => scroller.getBoundingClientRect().top;
  let head = 0;

  // the page's measures, as the stylesheet reads them
  function fit() {
    root.style.setProperty("--screen", `${screen()}px`);
    head = Math.max(
      0,
      root.getBoundingClientRect().top - scrollerTop() + scroller.scrollTop,
    );
    root.style.setProperty("--ps-head", `${head}px`);
    // the night also runs under the floating header: the page is pulled up by the header's height
    page?.style.setProperty("--ps-page-head", `${head}px`);
  }
  // the stage is sized from the screen: fit the page's measures before the scene lays itself out in it
  fit();

  const scene = mountScene({
    stage,
    scroller,
    palette: {
      block: paletteColor(root, "--ps-block"),
      swap: paletteColor(root, "--ps-swap"),
      pick: paletteColor(root, "--ps-pick"),
      background: paletteColor(root, "--ps-ground"),
    },
    coveredTop: () => head + STRIP,
    // beside the text the picture is fitted to the width that remains; under it, to the whole stage
    sceneLeft: () => {
      const card = cards[0]!;
      return beside.matches ? card.offsetLeft + card.offsetWidth + 24 : 0;
    },
  });

  const onSeg = (e: MouseEvent) => {
    const i = segs.indexOf(e.currentTarget as HTMLButtonElement);
    revealElement(cards[i], { behavior: "smooth", block: "center" });
  };
  for (const b of segs) b.addEventListener("click", onSeg);

  let lastOn = -1;
  let queued = 0;
  let disposed = false;
  let first = true;
  function measure() {
    queued = 0;
    const top = scrollerTop();
    const s = screen();
    const mid = s / 2;
    const hold = s * HOLD;
    const phone = narrow.matches;
    // [y on screen, p, step]: the picture is at p when y crosses the middle
    const pts: [number, number, number][] = [];
    steps.forEach((st, i) => {
      const P = CHAPTERS[i]!.p;
      const card = cards[i]!;
      if (isSpan(P)) {
        const r = st.getBoundingClientRect();
        const ch = card.offsetHeight;
        // the step's top when the card starts to hold, and its bottom when the card lets go
        const s0 = phone ? s * 0.88 - ch : s * 0.5 - HOLD_LIFT;
        const s1 = phone
          ? s * 0.88 + parseFloat(getComputedStyle(st).paddingBottom)
          : s0 + ch;
        pts.push(
          [r.top - top - s0 + mid, P[0], i],
          [r.bottom - top - s1 + mid, P[1], i],
        );
      } else {
        const r = card.getBoundingClientRect();
        pts.push([r.top - top + r.height / 2, P, i]);
      }
    });
    const L = pts.length - 1;
    let p = pts[L]![1];
    let sp = pts[L]![2];
    if (mid <= pts[0]![0] + hold) {
      p = pts[0]![1];
      sp = pts[0]![2];
    } else
      for (let i = 0; i < L; i++) {
        const A = pts[i]!;
        const B = pts[i + 1]!;
        const a = A[0] + hold;
        const b = B[0] - hold;
        if (mid < a) {
          p = A[1];
          sp = A[2];
          break;
        }
        if (mid < b) {
          const t = (mid - a) / (b - a);
          p = lerp(A[1], B[1], t);
          sp = lerp(A[2], B[2], t);
          break;
        }
      }
    if (first) scene.jump(p);
    else scene.setTarget(p);
    first = false;

    const on = Math.round(sp);
    steps.forEach((st, i) => st.classList.toggle("is-on", i === on));
    // the chapter strip: one segment per chapter, filling as the page passes it
    segs.forEach((b, i) =>
      b.style.setProperty("--fill", clamp01(sp - i + 1).toFixed(3)),
    );
    if (on !== lastOn) {
      lastOn = on;
      label.textContent = CHAPTERS[on]!.name;
    }
    const box = zoom.getBoundingClientRect();
    // the strip is pinned with the stage: it shows once the stage has reached the top, under the header
    strip.classList.toggle(
      "is-live",
      box.top - top < 1 && box.bottom - top > s * 0.5,
    );
  }
  const queue = () => {
    if (!queued && !disposed) queued = requestAnimationFrame(measure);
  };
  scroller.addEventListener("scroll", queue, { passive: true });
  // the cards and labels can still change size after this first measure, with no scroll to tell: web fonts arriving
  void document.fonts.ready.then(() => {
    if (disposed) return;
    scene.remeasure();
    queue();
  });

  measure();
  return {
    resize() {
      fit();
      scene.resize();
      queue();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(queued);
      scroller.removeEventListener("scroll", queue);
      for (const b of segs) b.removeEventListener("click", onSeg);
      scene.dispose();
    },
  };
}
