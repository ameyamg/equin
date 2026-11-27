import { memo, useLayoutEffect, useRef } from "react";
import { observeSectionReach } from "@plugins/apps/plugins/deploy/plugins/analytics/plugins/collect/web";
import { findScrollParent } from "@plugins/primitives/plugins/dom/plugins/auto-scroll/web";
import { useResizeObserver } from "@plugins/primitives/plugins/dom/plugins/element-size/web";
import { WebsiteHero } from "@plugins/apps/plugins/website/plugins/shell/web";
import { AnimationHost } from "@plugins/reports/plugins/render-loop/web";
import { CHAPTERS, isSpan } from "../internal/chapters";
import {
  mountPluginSystemScroll,
  type PluginSystemScroll,
} from "../internal/scroll";
import "./plugin-system-zoom.css";

/**
 * The plugin system page: the heading, then how equin is put together as one
 * isometric zoom out — a pinned WebGL stage behind eight chapter cards, from a
 * single plugin to the whole system — with a chapter strip pinned under the
 * site header while it is read.
 *
 * React renders the markup once (memoised, no props) and never re-renders it:
 * the scroll skeleton (`internal/scroll.ts`) and the scene (`internal/scene.ts`)
 * own the DOM from mount on, exactly as the prototype's script owned its page.
 *
 * Analytics: each chapter card records `section_reach` as
 * `plugin-system/<key>` when it reaches the upper half of the screen (the
 * heading records `plugin-system/hero` itself).
 */
export function PluginSystemZoom() {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<PluginSystemScroll | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const scroll = mountPluginSystemScroll(root);
    scrollRef.current = scroll;
    const cards = [...root.querySelectorAll<HTMLElement>(".psys-card")];
    const reach = cards.map((el, i) =>
      observeSectionReach(el, `plugin-system/${CHAPTERS[i]!.key}`),
    );
    return () => {
      scrollRef.current = null;
      for (const stop of reach) stop();
      scroll.dispose();
    };
  }, []);

  // the pane's viewport is the page's "screen", and the page's height moves the cards: refit on either
  useResizeObserver(
    () =>
      rootRef.current
        ? [findScrollParent(rootRef.current), rootRef.current]
        : null,
    () => scrollRef.current?.resize(),
  );

  return (
    <div ref={rootRef} className="plugin-system">
      <div className="psys-hero">
        <WebsiteHero
          kind="page"
          lead="Everything is "
          accent="a plugin"
          lede="From a single button to a whole suite of apps: the plugin system, explained."
        />
      </div>
      <ZoomMarkup />
    </div>
  );
}

/** The zoom's static markup. Memoised with no props, so React never touches it after mount. */
const ZoomMarkup = memo(function ZoomMarkup() {
  return (
    <section className="psys">
      <div className="psys-strip-pin">
        <div className="psys-strip">
          <div className="psys-strip-seg">
            {CHAPTERS.map((c) => (
              <button
                key={c.key}
                type="button"
                title={c.name}
                aria-label={c.name}
              />
            ))}
          </div>
          <div className="psys-strip-label" />
        </div>
      </div>
      {/* The scene draws the stage on its own rAF loop: an animation host, so
          the render-loop detector reads its frames as frames, not a loop. */}
      <AnimationHost className="psys-stage" aria-hidden="true" />
      <div className="psys-track">
        {CHAPTERS.map((c) => (
          <section
            key={c.key}
            className={[
              "psys-step",
              c.tall ? "is-long" : "",
              isSpan(c.p) ? "is-hold" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            id={`chapter-${c.key}`}
          >
            <article className="psys-card">
              <h2 className="psys-card-title">{c.title}</h2>
              <p className="psys-card-body">{c.body}</p>
            </article>
          </section>
        ))}
      </div>
    </section>
  );
});
