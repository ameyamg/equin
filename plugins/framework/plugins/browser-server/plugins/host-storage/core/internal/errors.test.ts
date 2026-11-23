import { describe, expect, it } from "bun:test";
import { HostRefusedError } from "@plugins/framework/plugins/browser-server/core";
import { BootInterruptedError } from "./errors";

describe("BootInterruptedError", () => {
  it("is declined as an interruption, carrying the browser's error", () => {
    const cause = new Error(
      "Version change transaction on cached page is aborted to unblock other connections",
    );
    const err = new BootInterruptedError(cause);
    expect(err).toBeInstanceOf(HostRefusedError);
    expect(err.refusal).toEqual({ kind: "interrupted" });
    expect(err.cause).toBe(cause);
  });
});
