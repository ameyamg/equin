import { describe, expect, test } from "bun:test";
import {
  baseName,
  isWithin,
  joinPath,
  nameStemEnd,
  parentPath,
  pathChain,
} from "./paths";
import { formatCount, formatModified, formatSize } from "./format";
import { createDateFormatter } from "@plugins/fields/plugins/date/plugins/format/core/testing";

const US = createDateFormatter({
  clock: "h12",
  dateOrder: "mdy",
  numericDate: "ymd",
});

const HOME_ABS = "/h/me";

describe("paths", () => {
  test("a name's stem ends before its last extension; a dotfile has none", () => {
    expect(nameStemEnd("report.pdf")).toBe(6);
    expect(nameStemEnd("archive.tar.gz")).toBe(11);
    expect(nameStemEnd("Makefile")).toBe(8);
    expect(nameStemEnd(".zshrc")).toBe(6);
    expect(nameStemEnd("")).toBe(0);
  });

  test("join at the root and below", () => {
    expect(joinPath("/", "etc")).toBe("/etc");
    expect(joinPath("~", "Downloads")).toBe("~/Downloads");
    expect(joinPath("/h/me", "x")).toBe("/h/me/x");
  });

  test("base names", () => {
    expect(baseName("~")).toBe("~");
    expect(baseName("/")).toBe("/");
    expect(baseName("~/Projects/equin")).toBe("equin");
  });

  test("parent keeps the form, and home's parent is absolute", () => {
    expect(parentPath("~/Projects/x", HOME_ABS)).toBe("~/Projects");
    expect(parentPath("~/Projects", HOME_ABS)).toBe("~");
    expect(parentPath("~", HOME_ABS)).toBe("/h");
    expect(parentPath("/h", HOME_ABS)).toBe("/");
    expect(parentPath("/", HOME_ABS)).toBeNull();
    // A home at the root (the browser's storage) has no parent.
    expect(parentPath("~/Documents", "/")).toBe("~");
    expect(parentPath("~", "/")).toBeNull();
  });

  test("within", () => {
    expect(isWithin("~/a/b", "~/a")).toBe(true);
    expect(isWithin("~/ab", "~/a")).toBe(false);
    expect(isWithin("/etc", "/")).toBe(true);
  });

  test("chain of crumbs", () => {
    expect(pathChain("~/Projects/x")).toEqual([
      "~",
      "~/Projects",
      "~/Projects/x",
    ]);
    expect(pathChain("/usr/bin")).toEqual(["/", "/usr", "/usr/bin"]);
    expect(pathChain("/")).toEqual(["/"]);
  });
});

describe("format", () => {
  test("decimal sizes", () => {
    expect(formatSize(900)).toBe("900 B");
    expect(formatSize(3400)).toBe("3.4 KB");
    expect(formatSize(24_000)).toBe("24 KB");
    expect(formatSize(1_200_000)).toBe("1.2 MB");
    expect(formatSize(182_000_000)).toBe("182 MB");
    expect(formatSize(4_400_000_000)).toBe("4.4 GB");
  });

  test("counts", () => {
    expect(formatCount(1)).toBe("1 item");
    expect(formatCount(3)).toBe("3 items");
  });

  test("modified, by local calendar day", () => {
    const now = new Date(2026, 9, 2, 15, 0).getTime();
    // Today reads as its time of day, so today's files tell apart.
    const today = (h: number, m: number) =>
      formatModified(new Date(2026, 9, 2, h, m).getTime(), now, US)
        // ICU may space "1:05 PM" with a narrow no-break space.
        .replace(/\s/g, " ");
    expect(today(0, 5)).toBe("12:05 AM");
    expect(today(13, 5)).toBe("1:05 PM");
    expect(
      formatModified(new Date(2026, 9, 1, 23, 59).getTime(), now, US),
    ).toBe("Yesterday");
    expect(formatModified(new Date(2026, 8, 28).getTime(), now, US)).toBe(
      "Sep 28",
    );
    expect(formatModified(new Date(2025, 8, 28).getTime(), now, US)).toBe(
      "Sep 28, 2025",
    );
  });
});
