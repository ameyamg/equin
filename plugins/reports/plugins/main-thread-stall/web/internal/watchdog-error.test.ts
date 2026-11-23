import { describe, expect, it } from "bun:test";
import { crashFieldsOf } from "@plugins/packages/plugins/error-subject/core";
import type { WatchdogFailure } from "./protocol";
import { WatchdogError } from "./watchdog-error";

const scopeOf = (failure: WatchdogFailure) =>
  crashFieldsOf(new WatchdogError(failure)).scope;

describe("WatchdogError", () => {
  const base: WatchdogFailure = {
    op: "persist",
    errorType: "DataError",
    message: "bad key 12",
  };

  it("keeps one cause on one subject", () => {
    expect(scopeOf(base)).toBe(
      "main-thread-stall watchdog › persist › DataError › bad key #",
    );
    expect(scopeOf({ ...base, message: "bad key 99" })).toBe(scopeOf(base));
  });

  it("tells causes apart", () => {
    const others: WatchdogFailure[] = [
      { ...base, op: "adopt" },
      { ...base, errorType: "VersionError" },
      { ...base, message: "no store" },
    ];
    for (const other of others) expect(scopeOf(other)).not.toBe(scopeOf(base));
  });
});
