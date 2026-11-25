import { describe, expect, test } from "bun:test";
import { MESSAGE_LINES_SHOWN } from "./entities";
import {
  GATHER_WINDOW_MS,
  nextMessageAt,
  renderEventLine,
  renderEventMessage,
  renderMoreLine,
} from "./message";

const MIN = 60_000;
const now = new Date("2026-11-14T13:45:00Z");

describe("nextMessageAt", () => {
  const at = (iso: string) => new Date(`2026-11-14T${iso}Z`);
  const gapMs = 10 * MIN;

  test("the first event after a quiet period waits out the gathering window", () => {
    expect(
      nextMessageAt({ lastMessageAt: null, gapMs, firstPendingAt: now, now }),
    ).toEqual(new Date(now.getTime() + GATHER_WINDOW_MS));
    expect(
      nextMessageAt({
        lastMessageAt: at("13:30:00"),
        gapMs,
        firstPendingAt: now,
        now,
      }),
    ).toEqual(new Date(now.getTime() + GATHER_WINDOW_MS));
  });

  test("a later event of the burst keeps the window its first one opened", () => {
    const first = new Date(now.getTime() - 3_000);
    expect(
      nextMessageAt({ lastMessageAt: null, gapMs, firstPendingAt: first, now }),
    ).toEqual(new Date(first.getTime() + GATHER_WINDOW_MS));
  });

  test("once the window is over, it goes at once", () => {
    expect(
      nextMessageAt({
        lastMessageAt: null,
        gapMs,
        firstPendingAt: at("13:44:00"),
        now,
      }),
    ).toEqual(now);
  });

  test("inside the quiet period, it waits for the period's end", () => {
    expect(
      nextMessageAt({
        lastMessageAt: at("13:40:00"),
        gapMs,
        firstPendingAt: at("13:41:00"),
        now,
      }),
    ).toEqual(at("13:50:00"));
  });

  test("nothing waiting and no quiet period: now", () => {
    expect(
      nextMessageAt({
        lastMessageAt: at("13:30:00"),
        gapMs,
        firstPendingAt: null,
        now,
      }),
    ).toEqual(now);
  });
});

describe("renderEventMessage", () => {
  const lines = [
    {
      streamId: "errors",
      kind: "endpoint-errors",
      title: "deadline exceeded",
      ref: "report-1",
      count: 16,
    },
    {
      streamId: "errors",
      kind: "crash",
      title: "Worker exited 134",
      ref: null,
      count: 2,
    },
  ];

  test("one summary line per event, never the whole report", () => {
    expect(renderEventLine(lines[0]!)).toBe(
      "×16 endpoint-errors · deadline exceeded (report-1)",
    );
    expect(renderEventLine(lines[1]!)).toBe("×2 crash · Worker exited 134");
  });

  test("a header counting the events, then the lines", () => {
    const text = renderEventMessage(
      lines,
      () => "Error reports",
      new Date("2026-11-14T13:40:00Z"),
      "sevmsg-1",
    );
    expect(text.split("\n")).toEqual([
      "Error reports — 18 events · 2 distinct since 13:40 UTC",
      "- ×16 endpoint-errors · deadline exceeded (report-1)",
      "- ×2 crash · Worker exited 134",
    ]);
  });

  test("past the shown lines, one +N more line sums the rest by kind and names where to read them", () => {
    const many = Array.from({ length: MESSAGE_LINES_SHOWN + 3 }, (_, i) => ({
      streamId: "errors",
      kind: i % 2 === 0 ? "crash" : "endpoint-errors",
      title: `e${i}`,
      ref: null,
      count: 100 - i,
    }));
    const text = renderEventMessage(
      many,
      () => "Error reports",
      null,
      "sevmsg-9",
    );
    const out = text.split("\n");
    expect(out).toHaveLength(1 + MESSAGE_LINES_SHOWN + 3);
    // Lines 20, 21, 22: counts 80 (crash), 79 (endpoint-errors), 78 (crash).
    expect(out.at(-3)).toBe(
      "- +3 more · 237 events (158 crash, 79 endpoint-errors)",
    );
    expect(out.at(-1)).toBe("Every line: `read_event_message` sevmsg-9");
  });
});

describe("renderMoreLine", () => {
  test("names the most frequent kinds, then how many others", () => {
    const hidden = Array.from({ length: 8 }, (_, i) => ({
      streamId: "s",
      kind: `k${i}`,
      title: "t",
      ref: null,
      count: 8 - i,
    }));
    expect(renderMoreLine(hidden)).toBe(
      "+8 more · 36 events (8 k0, 7 k1, 6 k2, 5 k3, 4 k4, 3 k5, +2 kinds)",
    );
  });
});
