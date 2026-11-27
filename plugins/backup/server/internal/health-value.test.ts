import { describe, expect, test } from "bun:test";
import { parseCrontab } from "@plugins/infra/plugins/jobs/core";
import { owedAfter } from "./health-value";

describe("owedAfter", () => {
  test("nightly: due at the next 03:00, stale at the one after", () => {
    const started = new Date(Date.UTC(2026, 10, 27, 3, 0, 5));
    expect(owedAfter(parseCrontab("0 3 * * *"), started)).toEqual({
      dueAt: Date.UTC(2026, 10, 28, 3, 0),
      staleAt: Date.UTC(2026, 10, 29, 3, 0),
    });
  });

  test("weekly: the interval comes from the cron itself", () => {
    // 2026-11-27 is a Friday; the cron fires on Sundays.
    const started = new Date(Date.UTC(2026, 10, 27, 12, 0));
    expect(owedAfter(parseCrontab("0 3 * * 0"), started)).toEqual({
      dueAt: Date.UTC(2026, 10, 29, 3, 0),
      staleAt: Date.UTC(2026, 11, 6, 3, 0),
    });
  });

  test("a cron that never fires owes nothing", () => {
    expect(
      owedAfter(parseCrontab("0 0 31 2 *"), new Date(Date.UTC(2026, 0, 1))),
    ).toEqual({ dueAt: null, staleAt: null });
  });
});
