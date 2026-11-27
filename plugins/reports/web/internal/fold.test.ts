import { describe, expect, test } from "bun:test";
import type { ReportBody } from "@plugins/reports/core";
import { createReportFold } from "./fold";

const body = (over: Partial<ReportBody> = {}): ReportBody => ({
  kind: "crash",
  source: "browser-error",
  message: "TypeError: x is undefined",
  data: { errorType: "TypeError", stack: "at frame (a.js:1:1)" },
  url: "http://equin.localhost/home",
  ...over,
});

function harness(opts: { fail?: boolean } = {}) {
  const sent: ReportBody[] = [];
  const timers: (() => void)[] = [];
  const warnings: string[] = [];
  const fold = createReportFold<string>({
    send: (b) => {
      sent.push(b);
      return opts.fail
        ? Promise.reject(new Error("down"))
        : Promise.resolve(`row-${sent.length}`);
    },
    schedule: (fn) => {
      timers.push(fn);
    },
    warn: (m) => warnings.push(m),
  });
  const tick = () => {
    const due = timers.splice(0);
    for (const fn of due) fn();
  };
  return { fold, sent, tick, warnings };
}

describe("createReportFold", () => {
  test("an error every frame is one send at once, then one per window with its count", async () => {
    const h = harness();
    const answers = [];
    for (let i = 0; i < 489; i++) answers.push(h.fold.submit(body()));
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.occurrences).toBeUndefined();
    // Every repeat answers what the first send answered: the same row.
    expect(new Set(await Promise.all(answers))).toEqual(new Set(["row-1"]));

    h.tick();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]!.occurrences).toBe(488);

    // A quiet window ends the fold: the next occurrence is sent at once.
    h.tick();
    expect(h.sent).toHaveLength(2);
    void h.fold.submit(body());
    expect(h.sent).toHaveLength(3);
    expect(h.sent[2]!.occurrences).toBeUndefined();
  });

  test("a single report is sent once and nothing follows", () => {
    const h = harness();
    void h.fold.submit(body());
    h.tick();
    h.tick();
    expect(h.sent).toHaveLength(1);
  });

  test("bodies that differ in anything are never folded together", () => {
    const h = harness();
    void h.fold.submit(body());
    void h.fold.submit(body({ message: "other" }));
    void h.fold.submit(body({ url: "http://equin.localhost/pages" }));
    void h.fold.submit(
      body({ data: { errorType: "TypeError", stack: "at b" } }),
    );
    expect(h.sent).toHaveLength(4);
  });

  test("flush sends held counts now and keeps folding after", () => {
    const h = harness();
    void h.fold.submit(body());
    void h.fold.submit(body());
    void h.fold.submit(body());
    h.fold.flush();
    expect(h.sent.map((b) => b.occurrences)).toEqual([undefined, 2]);
    // The timer armed before the flush does not send its count again.
    void h.fold.submit(body());
    h.tick();
    expect(h.sent.map((b) => b.occurrences)).toEqual([undefined, 2, 1]);
  });

  test("a failed leader: repeats answer null, a failed held send is warned", async () => {
    const h = harness({ fail: true });
    const first = h.fold.submit(body());
    const repeat = h.fold.submit(body());
    expect(first).rejects.toThrow("down");
    expect(await repeat).toBeNull();
    h.tick();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]).toContain("1 folded occurrence(s) not delivered");
  });
});
