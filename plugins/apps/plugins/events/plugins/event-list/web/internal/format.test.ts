import { describe, expect, test } from "bun:test";
import { createDateFormatter } from "@plugins/fields/plugins/date/plugins/format/core/testing";
import { formatEventWhen, formatPlace, urlHost } from "./format";

const GB = createDateFormatter({
  clock: "h23",
  dateOrder: "dmy",
  numericDate: "ymd",
});

/** Local-calendar construction (never UTC) — the formatter reads local getters. */
const at = (iso: string): Date => new Date(iso);
const NOW = at("2026-08-03T12:00:00");

describe("formatEventWhen", () => {
  test("timed event in the current year", () => {
    expect(formatEventWhen(at("2026-08-13T21:00:00"), false, GB, NOW)).toBe(
      "Thu 13 Aug · 21:00",
    );
  });

  test("all-day event drops the time", () => {
    expect(formatEventWhen(at("2026-08-13T00:00:00"), true, GB, NOW)).toBe(
      "Thu 13 Aug",
    );
  });

  test("another year is spelled out", () => {
    expect(formatEventWhen(at("2027-01-02T09:05:00"), false, GB, NOW)).toBe(
      "Sat, 2 Jan 2027 · 09:05",
    );
  });

  test("an invalid date formats to the empty string, never 'NaN'", () => {
    expect(formatEventWhen(new Date("nope"), false, GB, NOW)).toBe("");
  });
});

describe("formatPlace", () => {
  test("both, one, or neither", () => {
    expect(formatPlace("Fitzroy", "Paris")).toBe("Fitzroy · Paris");
    expect(formatPlace("Fitzroy", null)).toBe("Fitzroy");
    expect(formatPlace(null, "Paris")).toBe("Paris");
    expect(formatPlace(null, null)).toBe(null);
    expect(formatPlace("  ", null)).toBe(null);
  });
});

describe("urlHost", () => {
  test("strips the scheme, path and a leading www.", () => {
    expect(urlHost("https://www.fitzroy-paris.com/soirees")).toBe(
      "fitzroy-paris.com",
    );
    expect(urlHost("https://shotgun.live/events/1")).toBe("shotgun.live");
  });

  test("a non-URL is not a host", () => {
    expect(urlHost("not a url")).toBe(null);
    expect(urlHost("")).toBe(null);
  });
});
