import { describe, expect, test } from "bun:test";
import { createDateFormatter } from "./formatter";
import type { DateFormatPrefs } from "./config";

// 2026-11-27 23:17:05 UTC; read in UTC so the test is host-zone independent.
const AT = Date.UTC(2026, 10, 27, 23, 17, 5);
const MIDNIGHT = Date.UTC(2026, 10, 27, 0, 5);
const NOW = new Date(Date.UTC(2026, 11, 1));
const tz = "UTC";

const f = (p: Partial<DateFormatPrefs>) =>
  createDateFormatter({
    clock: "h23",
    dateOrder: "mdy",
    numericDate: "ymd",
    ...p,
  });

describe("clock", () => {
  test("24-hour", () => {
    expect(f({ clock: "h23" }).time(AT, { timeZone: tz })).toBe("23:17");
    expect(f({ clock: "h23" }).time(MIDNIGHT, { timeZone: tz })).toBe("00:05");
    expect(f({ clock: "h23" }).time(AT, { timeZone: tz, seconds: true })).toBe(
      "23:17:05",
    );
  });
  test("12-hour", () => {
    expect(f({ clock: "h12" }).time(AT, { timeZone: tz })).toMatch(
      /^11:17\sPM$/,
    );
  });
  test("24-hour holds under day-first order too", () => {
    expect(f({ dateOrder: "dmy" }).time(AT, { timeZone: tz })).toBe("23:17");
  });
});

describe("date order", () => {
  test("month first", () => {
    expect(f({}).date(AT, { timeZone: tz, now: NOW })).toBe("Nov 27");
    expect(f({}).date(AT, { timeZone: tz, year: "always" })).toBe(
      "Nov 27, 2026",
    );
  });
  test("day first", () => {
    expect(f({ dateOrder: "dmy" }).date(AT, { timeZone: tz, now: NOW })).toBe(
      "27 Nov",
    );
    expect(
      f({ dateOrder: "dmy" }).date(AT, { timeZone: tz, year: "always" }),
    ).toBe("27 Nov 2026");
  });
  test("year auto shows the year only when it differs", () => {
    const nextYear = new Date(Date.UTC(2027, 0, 2));
    expect(f({}).date(AT, { timeZone: tz, now: nextYear })).toBe(
      "Nov 27, 2026",
    );
  });
  test("month alone", () => {
    expect(
      f({}).date(AT, {
        timeZone: tz,
        day: false,
        month: "long",
        year: "always",
      }),
    ).toBe("November 2026");
  });
  test("date and time", () => {
    expect(f({}).dateTime(AT, { timeZone: tz, now: NOW })).toContain("23:17");
    expect(f({}).dateTime(AT, { timeZone: tz, now: NOW })).toContain("Nov 27");
  });
  test("weekday", () => {
    expect(f({}).weekday(AT, "short", tz)).toBe("Fri");
  });
});

describe("numeric dates", () => {
  test("year first", () => {
    expect(f({}).numeric(AT, { timeZone: tz })).toBe("2026-11-27");
    expect(f({}).numeric(AT, { timeZone: tz, time: true })).toBe(
      "2026-11-27 23:17",
    );
  });
  test("month first", () => {
    expect(f({ numericDate: "mdy" }).numeric(AT, { timeZone: tz })).toBe(
      "11/27/2026",
    );
  });
  test("day first", () => {
    expect(f({ numericDate: "dmy" }).numeric(AT, { timeZone: tz })).toBe(
      "27/11/2026",
    );
  });
});
