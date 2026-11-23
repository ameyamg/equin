import { describe, expect, test } from "bun:test";
import type { StallFrame } from "../../core";
import {
  INTERACTION,
  attribute,
  frameClaimed,
  judgeInteraction,
  longestEntry,
  onRenderClock,
  ownEnd,
  pageOwnMs,
  phasesOf,
  throttled,
  withheldOf,
  type RawFrame,
  type RawScript,
} from "./interaction-judge";

const stub: StallFrame = {
  startedAt: 0,
  durationMs: 0,
  blockingDurationMs: 0,
  renderStartMs: null,
  styleAndLayoutStartMs: null,
  scripts: [],
};

const script = (
  start: number,
  duration: number,
  label: string,
  forced = 0,
): RawScript => ({ start, duration, forced, label });

// A long frame whose tasks blocked throughout (the usual slow frame) unless
// `render` says when its render step began and how long it blocked.
const frame = (
  start: number,
  end: number,
  scripts: RawScript[],
  styleAndLayoutStart = 0,
  render: { renderStart: number; blocking: number } = {
    renderStart: 0,
    blocking: end - start,
  },
): RawFrame => ({
  start,
  end,
  styleAndLayoutStart,
  ...render,
  scripts,
  frame: stub,
});

describe("attribute", () => {
  test("the four layers partition the window, forced layout named", () => {
    // 1000 → 1600: a click handler 100 ms, a commit 300 ms of which 250 forced
    // layout, then the frame's own style/layout 120 ms.
    const a = attribute(
      { start: 1000, end: 1600 },
      [
        frame(
          1000,
          1580,
          [
            script(1010, 100, "onClick (BUTTON.onclick)"),
            script(1110, 300, "commitRoot (MessagePort.onmessage)", 250),
          ],
          1460,
        ),
      ],
      1000,
    );
    expect(a.breakdown).toEqual({
      scriptMs: 150,
      forcedStyleLayoutMs: 250,
      styleLayoutMs: 120,
      withheldMs: 0,
      frameWaitMs: 0,
      otherMs: 80,
    });
    expect(a.forcedBy).toBe("commitRoot (MessagePort.onmessage)");
    expect(a.topFunction).toBe("commitRoot (MessagePort.onmessage)");
    expect(a.frames).toHaveLength(1);
  });

  test("scripts are clipped to the window, their forced layout pro rata", () => {
    const a = attribute(
      { start: 1000, end: 1200 },
      [frame(800, 1200, [script(800, 400, "long (setTimeout)", 200)])],
      1000,
    );
    // Half the script is inside: 200 ms, 100 of it forced.
    expect(a.breakdown.forcedStyleLayoutMs).toBe(100);
    expect(a.breakdown.scriptMs).toBe(100);
    expect(a.breakdown.otherMs).toBe(0);
  });

  test("a ResizeObserver callback inside the style/layout pass is script, not counted twice", () => {
    const a = attribute(
      { start: 0, end: 400 },
      [
        frame(
          0,
          400,
          [script(200, 100, "(anonymous) (ResizeObserverCallback)", 60)],
          100,
        ),
      ],
      0,
    );
    expect(a.breakdown).toEqual({
      scriptMs: 40,
      forcedStyleLayoutMs: 60,
      styleLayoutMs: 200,
      withheldMs: 0,
      frameWaitMs: 0,
      otherMs: 100,
    });
  });

  test("frames outside the window are ignored; nothing attributed is all other", () => {
    const a = attribute(
      { start: 1000, end: 1300 },
      [frame(0, 900, [script(0, 900, "earlier (setTimeout)", 500)])],
      1000,
    );
    expect(a.breakdown).toEqual({
      scriptMs: 0,
      forcedStyleLayoutMs: 0,
      styleLayoutMs: 0,
      withheldMs: 0,
      frameWaitMs: 0,
      otherMs: 300,
    });
    expect(a.topFunction).toBeNull();
    expect(a.forcedBy).toBeNull();
    expect(a.frames).toEqual([]);
  });
});

// The frames of real reports, on the performance clock (ms from the frame the
// interaction began in), as the tab held them.
describe("withheld rendering", () => {
  // report-1795095421-0r9u4n (equin.ai, macOS Chrome): a row click, 2280 ms to
  // its paint, three ~1 s frames tiling it with blocking 0 — the thread ran
  // ~100 ms of script, then waited ~280–980 ms per frame for a render step
  // the browser gave it about once a second.
  const throttledFrames: RawFrame[] = [
    frame(
      0,
      1013,
      [
        script(615, 27, "H (MessagePort.onmessage)", 16),
        script(658, 26, "runQueued (TimerHandler:setTimeout)", 5),
        script(691, 22, "runQueued (TimerHandler:setTimeout)", 4),
      ],
      996,
      { renderStart: 994, blocking: 0 },
    ),
    frame(1014, 1998, [], 1998, { renderStart: 1995, blocking: 0 }),
    frame(
      2000,
      2824,
      [script(2017, 28, "(anonymous) (TimerHandler:setTimeout)")],
      2823,
      { renderStart: 2818, blocking: 0 },
    ),
  ];
  const w0r9u4n = { start: 545, end: 545 + 2280 };

  test("a throttled renderer's free waits are withheld, not the page's", () => {
    expect(throttled(throttledFrames)).toBe(true);
    const a = attribute(w0r9u4n, throttledFrames, 545);
    // Frame 1 from the click (545) to its render (994): 449 − 75 script − 50;
    // frame 2: 981 − 50; frame 3: 818 − 28 − 50.
    expect(a.breakdown.withheldMs).toBe(324 + 931 + 740);
    expect(a.breakdown.scriptMs + a.breakdown.forcedStyleLayoutMs).toBe(103);
    // The page spent ~280 ms of the 2280: recorded, not a severe click.
    const own = pageOwnMs(2280, a.breakdown);
    expect(own).toBe(285);
    expect(judgeInteraction(own, 1, false)).toBe("record");
  });

  test("a frame whose tasks blocked keeps its time — a real slow click is still reported", () => {
    // report-1795081021-dfpksi: one 1544 ms frame, blocking 1494, 1540 ms of
    // script before its render step.
    const busy = frame(
      0,
      1544,
      [script(0, 1540, "onClick (BUTTON.onclick)")],
      1544,
      { renderStart: 1544, blocking: 1494 },
    );
    expect(withheldOf(busy, { start: 0, end: 1552 })).toBe(0);
    const a = attribute({ start: 0, end: 1552 }, [busy], 0);
    expect(a.breakdown.withheldMs).toBe(0);
    expect(judgeInteraction(pageOwnMs(1552, a.breakdown), 1, false)).toBe(
      "report",
    );
  });

  test("a chain of short tasks is script, not withheld", () => {
    // 20 × 40 ms tasks (none blocks) before the render: the page's own work.
    const scripts = Array.from({ length: 20 }, (_, i) =>
      script(i * 40, 40, "step (setTimeout)"),
    );
    const f = frame(0, 820, scripts, 800, { renderStart: 800, blocking: 0 });
    expect(withheldOf(f, { start: 0, end: 820 })).toBe(0);
  });

  test("a vsync's wait is not withheld", () => {
    const f = frame(0, 120, [script(0, 80, "x (setTimeout)")], 118, {
      renderStart: 118,
      blocking: 30,
    });
    expect(withheldOf(f, { start: 0, end: 120 })).toBe(0);
  });

  test("one suppressed frame is the page's own — a view transition awaiting its update", () => {
    // A 1.4 s frame, blocking 0, a 60 ms commit, its render step held until
    // the update resolved: the same shape as one throttled frame, but alone.
    const held = frame(0, 1400, [script(20, 60, "flushSync (click)")], 1395, {
      renderStart: 1390,
      blocking: 0,
    });
    expect(throttled([held])).toBe(false);
    const a = attribute({ start: 0, end: 1408 }, [held], 0);
    expect(a.breakdown.withheldMs).toBe(0);
    // The free wait is named, and stays the page's: 1390 − 60 script − 50.
    expect(a.breakdown.frameWaitMs).toBe(1280);
    expect(a.breakdown.otherMs).toBe(1408 - 60 - 5 - 1280);
    expect(judgeInteraction(pageOwnMs(1408, a.breakdown), 1, false)).toBe(
      "report",
    );
  });

  test("counted from the handlers' start, never inside the input delay", () => {
    const a = attribute(w0r9u4n, throttledFrames, 845);
    // Frame 1 from 845 (after its last script) to its render: 149 − 50.
    expect(a.breakdown.withheldMs).toBe(99 + 931 + 740);
  });

  test("not measured without the frames' every script (the stall path)", () => {
    const a = attribute(w0r9u4n, throttledFrames, null);
    expect(a.breakdown.withheldMs).toBeNull();
    expect(a.breakdown.frameWaitMs).toBeNull();
  });
});

// One long free wait alone looks the same whether the browser withheld the
// frame or the page's own compositor / GPU work held it — unless its render
// step came on the browser's 1 Hz clock. Real visitor frames (equin.ai),
// performance clock, ms from the click.
describe("the browser's render clock", () => {
  // report-1795138820-4se9ex (Windows Chrome, /demo/at/agents): a short frame
  // rendered at +68, the next began 11 ms after it and waited free ~840 ms for
  // a render step at +1034 — 966 ms after the last one.
  const clocked: RawFrame[] = [
    frame(1, 71, [script(9, 7, "sg (DIV.onclick)")], 71, {
      renderStart: 68,
      blocking: 0,
    }),
    frame(
      82,
      1059,
      [
        script(82, 40, "H (MessagePort.onmessage)", 16),
        script(125, 49, "runQueued (TimerHandler:setTimeout)", 16),
        script(1048, 11, "(anonymous) (ResizeObserverCallback)", 6),
      ],
      1035,
      { renderStart: 1034, blocking: 24 },
    ),
    frame(1065, 1115, [], 1115, { renderStart: 1115, blocking: 0 }),
  ];

  test("one long free wait on the 1 s clock is withheld — the page's own share is recorded only", () => {
    expect(onRenderClock(clocked[1]!, clocked)).toBe(true);
    expect(throttled(clocked)).toBe(true);
    const a = attribute({ start: 0, end: 1096 }, clocked, 3);
    // Frame 1: 65 − 7 script − 50; frame 2: 839 − 50.
    expect(a.breakdown.withheldMs).toBe(8 + 789);
    expect(a.breakdown.frameWaitMs).toBe(0);
    const own = pageOwnMs(1093, a.breakdown);
    expect(own).toBe(296);
    expect(judgeInteraction(own, 1, false)).toBe("record");
  });

  test("off the clock it stays the page's — named as a frame wait, still reported", () => {
    // report-1795199821-710zfl (Windows Chrome, /demo/at/sonata): the same
    // shape, but the render step came 758 ms after the last one.
    const off: RawFrame[] = [
      frame(
        -16,
        383,
        [
          script(-16, 10, "sg (DIV.onclick)"),
          script(245, 11, "H (MessagePort.onmessage)"),
        ],
        383,
        { renderStart: 377, blocking: 0 },
      ),
      frame(
        390,
        1175,
        [
          script(976, 54, "H (MessagePort.onmessage)", 25),
          script(1138, 12, "(anonymous) (ResizeObserverCallback)", 6),
          script(1151, 16, "(anonymous) (ResizeObserverCallback)", 11),
        ],
        1136,
        { renderStart: 1135, blocking: 44 },
      ),
    ];
    expect(onRenderClock(off[1]!, off)).toBe(false);
    expect(throttled(off)).toBe(false);
    const a = attribute({ start: 0, end: 1168 }, off, 0);
    expect(a.breakdown.withheldMs).toBe(0);
    // Frame 1 from the click (its handler ran before): 377 − 11 script − 50;
    // frame 2: 647 − 50.
    expect(a.breakdown.frameWaitMs).toBe(316 + 597);
    expect(judgeInteraction(pageOwnMs(1168, a.breakdown), 1, false)).toBe(
      "report",
    );
  });

  test("with no frame just before it, one long wait is not proven", () => {
    // report-1795412123-gfakfw (Windows Chrome, /demo files → Back): one
    // 2063 ms frame begun before the click, its render step at +1676.
    const alone = frame(
      -352,
      1711,
      [
        script(41, 96, "H (MessagePort.onmessage)", 34),
        script(1677, 28, "(anonymous) (ResizeObserverCallback)", 8),
      ],
      1677,
      { renderStart: 1676, blocking: 81 },
    );
    expect(throttled([alone])).toBe(false);
    const a = attribute({ start: 0, end: 1744 }, [alone], 1);
    expect(a.breakdown.withheldMs).toBe(0);
    expect(a.breakdown.frameWaitMs).toBeGreaterThan(1400);
    // What is left: the 81 ms its tasks blocked, a vsync's slack, the tail.
    expect(a.breakdown.otherMs).toBeLessThan(200);
  });

  test("the frame before may precede the interaction", () => {
    // Performance-clock times (positive); the click at 1000.
    const before = frame(600, 700, [], 700, {
      renderStart: 690,
      blocking: 0,
    });
    const waited = frame(705, 1700, [], 1700, {
      renderStart: 1695,
      blocking: 0,
    });
    expect(onRenderClock(waited, [before, waited])).toBe(true);
    expect(throttled([waited], [before, waited])).toBe(true);
    expect(throttled([waited])).toBe(false);
  });

  test("not against a frame before it that never rendered — no clock to measure from", () => {
    // A long task with no render step, then one frame GPU work held ~1 s.
    const task = frame(0, 120, [
      script(0, 120, "onMessage (MessagePort.onmessage)"),
    ]);
    const held = frame(125, 1100, [], 1100, { renderStart: 1095, blocking: 0 });
    expect(onRenderClock(held, [task, held])).toBe(false);
    expect(throttled([task, held])).toBe(false);
  });

  test("the clock's slack is ± 50 ms", () => {
    const before = frame(0, 100, [], 100, { renderStart: 90, blocking: 0 });
    const at = (render: number) =>
      frame(100, render + 5, [], render + 5, {
        renderStart: render,
        blocking: 0,
      });
    expect(onRenderClock(at(1140), [before, at(1140)])).toBe(true);
    expect(onRenderClock(at(1141), [before, at(1141)])).toBe(false);
    expect(onRenderClock(at(1040), [before, at(1040)])).toBe(true);
    expect(onRenderClock(at(1039), [before, at(1039)])).toBe(false);
  });

  test("not when an unseen frame could have rendered between them", () => {
    const before = frame(0, 100, [], 100, { renderStart: 90, blocking: 0 });
    // Begun 40 ms after the last frame ended: room for a short frame between.
    const waited = frame(140, 1095, [], 1095, {
      renderStart: 1090,
      blocking: 0,
    });
    expect(onRenderClock(waited, [before, waited])).toBe(false);
  });
});

describe("judgeInteraction", () => {
  test("severe reports at once", () => {
    expect(judgeInteraction(INTERACTION.SEVERE_MS, 1, false)).toBe("report");
  });
  test("under the severe bar, reported once its target recurs", () => {
    expect(judgeInteraction(400, 1, false)).toBe("record");
    expect(judgeInteraction(400, INTERACTION.RECUR_COUNT - 1, false)).toBe(
      "record",
    );
    expect(judgeInteraction(400, INTERACTION.RECUR_COUNT, false)).toBe(
      "report",
    );
  });
  test("under the recurrence bar, only recorded however often", () => {
    expect(judgeInteraction(250, 10, false)).toBe("record");
  });
  test("a freeze of stall size is the stall detector's report", () => {
    expect(judgeInteraction(6000, 1, false)).toBe("record");
    // Event Timing measured it just under the bar, but a long frame inside it
    // reached it: the stall detector files it (naming this interaction).
    expect(judgeInteraction(4990, 1, true)).toBe("record");
  });
});

describe("frameClaimed", () => {
  test("a long frame overlapping a slow interaction is the interaction's", () => {
    const slow = [{ start: 1000, end: 2200 }];
    expect(frameClaimed({ start: 1100, end: 2100 }, slow)).toBe(true);
    expect(frameClaimed({ start: 3000, end: 4200 }, slow)).toBe(false);
  });
});

describe("Event Timing entries", () => {
  const entry = (name: string, duration: number) => ({
    name,
    startTime: 100,
    duration,
    processingStart: 130,
    processingEnd: 180,
    interactionId: 7,
  });
  test("the longest entry stands for the interaction", () => {
    expect(
      longestEntry([
        entry("pointerdown", 208),
        entry("click", 504),
        entry("pointerup", 496),
      ]).name,
    ).toBe("click");
  });
  test("phases", () => {
    expect(phasesOf(entry("click", 504))).toEqual({
      inputDelayMs: 30,
      processingMs: 50,
      presentationDelayMs: 424,
    });
  });
});

describe("ownEnd", () => {
  // Alt+N as Playwright sends it: keydown Alt (no work), then keydown N (opens
  // a window) 0.2 ms later, both presented by one 88 ms frame.
  const alt = {
    name: "keydown",
    startTime: 868.9,
    duration: 88,
    processingStart: 869.1,
    processingEnd: 869.4,
    interactionId: 2500,
  };
  const nHandlers = 869.6;
  test("a later input's handlers in the same frame end this entry's own time", () => {
    expect(ownEnd(alt, [869.3, nHandlers])).toBe(nHandlers);
  });
  test("with no later input, its own time runs to its paint", () => {
    expect(ownEnd(alt, [869.3])).toBe(868.9 + 88);
  });
  test("an input after the paint, or before its handlers ended, is not inside it", () => {
    expect(ownEnd(alt, [700, 869.2, 2000])).toBe(868.9 + 88);
  });
});
