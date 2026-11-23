import { describe, expect, test } from "bun:test";
import {
  awakeBetween,
  clockStamp,
  isSleepStamp,
  sleptBetween,
  stampBefore,
} from "./stamp";

const s = (asleepMs: number, boot = "B") => ({ boot, asleepMs });

describe("sleptBetween", () => {
  test("the difference of one boot's stamps", () => {
    expect(sleptBetween(s(100), s(900))).toBe(800);
  });
  test("cannot tell across a reboot or without a stamp", () => {
    expect(sleptBetween(s(100), s(900, "C"))).toBeNull();
    expect(sleptBetween(null, s(900))).toBeNull();
    expect(sleptBetween(s(100), null)).toBeNull();
  });
  test("read jitter never goes negative", () => {
    expect(sleptBetween(s(100.0002), s(100))).toBe(0);
  });
});

describe("awakeBetween", () => {
  test("a 934 s nap inside a 16 min span leaves the awake time", () => {
    const span = awakeBetween(
      clockStamp(0, s(5_000)),
      clockStamp(960_000, s(5_000 + 934_000)),
    );
    expect(span).toEqual({
      wallMs: 960_000,
      sleptMs: 934_000,
      awakeMs: 26_000,
    });
  });
  test("where the sleep cannot be told, the wall clock judges", () => {
    expect(awakeBetween(clockStamp(0, null), clockStamp(5_000, s(9)))).toEqual({
      wallMs: 5_000,
      sleptMs: null,
      awakeMs: 5_000,
    });
  });
  test("a backward span (to before from) takes its sleep out toward zero", () => {
    // Agent started at 0, a 1 h nap, the checkout ended after it.
    expect(
      awakeBetween(clockStamp(3_602_000, s(3_600_000)), clockStamp(0, s(0))),
    ).toEqual({ wallMs: -3_602_000, sleptMs: 3_600_000, awakeMs: -2_000 });
  });
  test("a wall clock stepped back with no sleep between: the wall span", () => {
    expect(
      awakeBetween(clockStamp(1_000, s(5)), clockStamp(400, s(5))),
    ).toEqual({ wallMs: -600, sleptMs: 0, awakeMs: -600 });
  });
  test("a sleep is never more than the span (a wall clock stepped back)", () => {
    expect(
      awakeBetween(clockStamp(1_000, s(0)), clockStamp(1_500, s(2_000))),
    ).toEqual({ wallMs: 500, sleptMs: 500, awakeMs: 0 });
  });
});

describe("stampBefore", () => {
  test("a sleep between the instant and the reading is not in its stamp", () => {
    const start = stampBefore(clockStamp(940_000, s(945_000)), 0, 1_000);
    expect(start).toEqual(clockStamp(0, s(6_000)));
  });
  test("no sleep in between: the reading's own sleep", () => {
    expect(stampBefore(clockStamp(1_000, s(7)), 0, 1_000.4)).toEqual(
      clockStamp(0, s(7)),
    );
  });
  test("without a sleep clock there is none to give", () => {
    expect(stampBefore(clockStamp(9, null), 2, 7)).toEqual(clockStamp(2, null));
  });
});

test("isSleepStamp", () => {
  expect(isSleepStamp(s(1))).toBe(true);
  expect(isSleepStamp({ boot: "B" })).toBe(false);
  expect(isSleepStamp(null)).toBe(false);
});
