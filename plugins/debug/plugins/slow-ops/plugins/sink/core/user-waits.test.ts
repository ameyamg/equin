import { afterEach, describe, expect, test } from "bun:test";
import {
  __resetUserWaits,
  beginUserWait,
  onUserWaitSettled,
  userWaitDuring,
} from "./user-waits";

afterEach(() => __resetUserWaits());

describe("user waits", () => {
  test("an item overlapping a pending wait is during it", () => {
    const now = Date.now();
    const w = beginUserWait("page-load", now - 3_000);
    expect(userWaitDuring(now - 1_000, now)).toEqual({
      id: w.id,
      kind: "page-load",
      open: true,
    });
    // Ended before the wait began: not during it.
    expect(userWaitDuring(now - 10_000, now - 4_000)).toBeUndefined();
  });

  test("an ended wait still claims an item inside it, not one after it", () => {
    const now = Date.now();
    const w = beginUserWait("live-again", now - 5_000);
    w.end();
    expect(userWaitDuring(now - 4_000, now - 3_000)?.id).toBe(w.id);
    expect(userWaitDuring(now + 1_000, now + 2_000)).toBeUndefined();
  });

  test("a cancelled wait (hidden tab, machine sleep) holds nothing", () => {
    const now = Date.now();
    const w = beginUserWait("page-load", now - 3_000);
    w.cancel();
    expect(userWaitDuring(now - 1_000, now)).toBeUndefined();
  });

  test("ids are unique per wait", () => {
    const now = Date.now();
    const a = beginUserWait("page-load", now);
    const b = beginUserWait("page-load", now);
    expect(a.id).not.toBe(b.id);
  });

  test("a wait says whether it is still open, and tells when it settles", () => {
    const now = Date.now();
    let told = 0;
    const off = onUserWaitSettled(() => {
      told += 1;
    });
    const a = beginUserWait("page-load", now - 1_000);
    expect(userWaitDuring(now - 500, now)?.open).toBe(true);
    a.end();
    expect(userWaitDuring(now - 500, now)?.open).toBe(false);
    a.end(); // once
    const b = beginUserWait("live-again", now + 10_000);
    b.cancel();
    b.cancel(); // once
    expect(told).toBe(2);
    off();
  });
});
