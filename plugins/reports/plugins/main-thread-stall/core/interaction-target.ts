import { z } from "zod";

// What an interaction (a click, tap or key press) was aimed at, and where its
// time went — shared by the `slow-interaction` report and by a
// `main-thread-stall` report whose freeze a user interaction started: both
// name the same control the same way, and fingerprint it by the same key.

// What was interacted with, resolved when the event was dispatched (the node is
// often gone by the time its paint is measured: a slow switch remounts the very
// button). Never the app, route or url — the same control is one identity on
// every screen it is drawn on — and never user content: a name is read only
// from an aria-label or a button's own label, a key only as its class.
export const InteractionTargetSchema = z.object({
  // `click` (pointer: tap, click) or `key`.
  kind: z.enum(["click", "key"]),
  // The key class of a keyboard interaction (`Enter`, `Escape`, `ArrowDown`,
  // `Mod+K`, `char` for a printable key alone); null for a pointer one.
  key: z.string().nullable(),
  // The nearest interactive element (`button — Full screen`,
  // `div[role=tab] — Files`, `a`): ui-context's element descriptor.
  element: z.string(),
  // The innermost slot contribution around it (`plugin@slot`), when the
  // composition stamps contributions (the element picker's middleware).
  contribution: z.string().nullable(),
  // The innermost pane it sits in (`plugin#pane:<pane id>`), without position.
  pane: z.string().nullable(),
  // The composing component (`data-ui-owner`'s name, no file:line).
  owner: z.string().nullable(),
});
export type InteractionTarget = z.infer<typeof InteractionTargetSchema>;

// Where the interaction's time went: a partition of its duration, from the
// long animation frames inside it (each script clipped to the interaction).
export const InteractionBreakdownSchema = z.object({
  // JavaScript (event handlers, React render/commit, effects, observers) less
  // the style/layout it forced.
  scriptMs: z.number(),
  // Style and layout forced synchronously by a script reading layout after a
  // DOM write (`forcedStyleAndLayoutDuration`).
  forcedStyleLayoutMs: z.number(),
  // The frame's own style and layout pass, before paint.
  styleLayoutMs: z.number(),
  // Rendering the browser withheld: time inside long frames, before their
  // render step, when the thread ran no script and no task of it blocked
  // (LoAF blockingDuration) — it was free, and no frame was given to it —
  // counted only when the frames prove a throttled renderer (`throttled`:
  // frame after frame waiting, or a render step on the browser's 1 Hz clock).
  // A page cannot cause that; an occluded or off-screen window, an automated
  // browser, a power-throttled renderer does. Each frame keeps its first
  // WITHHELD_SLACK_MS as a normal wait for vsync. Never part of what the page
  // is judged on. Null: filed before it was measured (inside `otherMs`).
  withheldMs: z.number().nullable().default(null),
  // The same free wait for a render step when nothing proves the browser
  // withheld it: the thread was idle and the frame came late, which is the
  // page's own compositor / GPU cost (raster, layers, filters, decodes) or a
  // throttle without a signature — LoAF cannot tell them apart. Part of the
  // page's time; named so it is never read as the top script's. Null: filed
  // before it was measured (inside `otherMs`), or not measurable (a stall).
  frameWaitMs: z.number().nullable().default(null),
  // The rest: paint, compositing, render steps outside scripts, or waiting —
  // time no long frame accounts for.
  otherMs: z.number(),
});
export type InteractionBreakdown = z.infer<typeof InteractionBreakdownSchema>;

/** The target in one line: `click button — Full screen in apps-core#pane:x (Owner)`. */
export function interactionTargetLabel(t: InteractionTarget): string {
  const what = t.kind === "key" ? `key ${t.key ?? "?"} on` : "click";
  const where = t.contribution ?? t.pane;
  return (
    `${what} ${t.element}` +
    (where ? ` in ${where}` : "") +
    (t.owner ? ` (${t.owner})` : "")
  );
}

/**
 * The identity of a target as one string — kind, key class, contribution,
 * pane, owner and element. No app, route, url, durations or tab: the same
 * control is one key wherever it is drawn. Both report kinds fingerprint by it.
 */
export function interactionTargetKey(t: InteractionTarget): string {
  return `${t.kind}${t.key ? `:${t.key}` : ""}|${t.contribution ?? "-"}|${t.pane ?? "-"}|${t.owner ?? "-"}|${t.element}`;
}

/** The layer most of the interaction went to, for one-line summaries. */
export function dominantLayer(b: InteractionBreakdown): {
  layer:
    | "script"
    | "forced style/layout"
    | "style/layout"
    | "withheld rendering"
    | "waiting for a frame"
    | "other";
  ms: number;
} {
  const layers = [
    { layer: "script", ms: b.scriptMs },
    { layer: "forced style/layout", ms: b.forcedStyleLayoutMs },
    { layer: "style/layout", ms: b.styleLayoutMs },
    { layer: "withheld rendering", ms: b.withheldMs ?? 0 },
    { layer: "waiting for a frame", ms: b.frameWaitMs ?? 0 },
    { layer: "other", ms: b.otherMs },
  ] as const;
  return layers.reduce((a, c) => (c.ms > a.ms ? c : a));
}

/**
 * The function a one-line summary names beside its dominant layer: only a
 * layer a script spent — its top function, or what forced the style/layout.
 * Beside a wait (withheld, waiting for a frame, other) or the frame's own
 * style/layout pass, a script's name reads as if it took the time: visitors'
 * 1.4–1.6 s idle waits were filed as `other 1613 ms (H (MessagePort.onmessage))`
 * for a 96 ms script.
 */
export function layerCulprit(
  layer: ReturnType<typeof dominantLayer>["layer"],
  topFunction: string | null,
  forcedBy: string | null,
): string | null {
  if (layer === "forced style/layout") return forcedBy ?? topFunction;
  if (layer === "script") return topFunction;
  return null;
}
