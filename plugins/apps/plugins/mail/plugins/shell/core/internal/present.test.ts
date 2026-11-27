import { describe, expect, it } from "bun:test";
import { createDateFormatter } from "@plugins/fields/plugins/date/plugins/format/core/testing";
import { avatarColor, initials, listTime, shortName } from "./present";

const GB = createDateFormatter({
  clock: "h23",
  dateOrder: "dmy",
  numericDate: "ymd",
});

describe("thread row presentation", () => {
  const now = new Date(2026, 10, 26, 15, 0);

  it("says the time today, Yesterday, the weekday, then the date", () => {
    expect(listTime(new Date(2026, 10, 26, 10, 42), now, GB)).toBe("10:42");
    expect(listTime(new Date(2026, 10, 25, 23, 59), now, GB)).toBe("Yesterday");
    expect(listTime(new Date(2026, 10, 24, 9, 0), now, GB)).toBe("Tue");
    expect(listTime(new Date(2026, 10, 12, 9, 0), now, GB)).toBe("12 Nov");
    expect(listTime(new Date(2025, 10, 12, 9, 0), now, GB)).toBe("12 Nov 2025");
  });

  it("names a person by initials and first name, falling back to the address", () => {
    expect(initials("Maya Chen", "maya@x.com")).toBe("MC");
    expect(initials(null, "maya@x.com")).toBe("M");
    expect(shortName({ name: "Maya Chen", address: "maya@x.com" })).toBe(
      "Maya",
    );
    expect(shortName({ name: null, address: "maya@x.com" })).toBe("maya");
  });

  it("gives one name one colour", () => {
    expect(avatarColor("Maya Chen")).toBe(avatarColor("Maya Chen"));
  });
});
