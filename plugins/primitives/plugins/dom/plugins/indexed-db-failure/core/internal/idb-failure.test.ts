import { describe, expect, it } from "bun:test";
import { idbFailureOf, isSuspensionAbort } from "./idb-failure";

/** A WebKit `UnknownError` with `message`. */
function webkitError(message: string): Error {
  const err = new Error(message);
  err.name = "UnknownError";
  return err;
}

/** WebKit's error, as `IDBConnectionProxy::completeOpenDBRequest` raises it. */
function webkitAbort(): Error {
  return webkitError(
    "Version change transaction on cached page is aborted to unblock other connections",
  );
}

describe("isSuspensionAbort", () => {
  it("recognises WebKit's abort of an upgrade answered while the page was cached", () => {
    expect(isSuspensionAbort(webkitAbort())).toBe(true);
  });

  it("recognises a transaction WebKit aborted while the client was suspended", () => {
    // A queued request reaching the server transaction that is gone
    // (report-1795189021-x5spzw: PGlite's IDBFS sync deleting a file).
    for (const message of [
      "Attempt to delete range from database without an in-progress transaction",
      "Attempt to store a record in an object store without an in-progress transaction",
      "Attempt to get records from database without an in-progress transaction",
      "Transaction was aborted while its process was suspended",
      "Connection on cached page closed to unblock other connections",
    ]) {
      expect(isSuspensionAbort(webkitError(message))).toBe(true);
    }
  });

  it("recognises it as the cause of a wrapping error (PGlite's open)", () => {
    const wrapped = new Error("PGlite failed to start", {
      cause: webkitAbort(),
    });
    expect(isSuspensionAbort(wrapped)).toBe(true);
  });

  it("does not take any other IndexedDB failure for it", () => {
    const quota = new Error("The quota has been exceeded.");
    quota.name = "QuotaExceededError";
    expect(isSuspensionAbort(quota)).toBe(false);
    const unknown = new Error("An internal error was encountered");
    unknown.name = "UnknownError";
    expect(isSuspensionAbort(unknown)).toBe(false);
    expect(
      isSuspensionAbort(
        webkitError(
          "Attempt to delete records from an object store in a read-only transaction",
        ),
      ),
    ).toBe(false);
    expect(isSuspensionAbort(null)).toBe(false);
    expect(isSuspensionAbort("Version change")).toBe(false);
  });
});

describe("idbFailureOf", () => {
  const named = (name: string, message = "failed"): Error => {
    const err = new Error(message);
    err.name = name;
    return err;
  };

  it("tells a suspension from the bare UnknownError it also is", () => {
    expect(idbFailureOf(webkitAbort()).kind).toBe("suspended");
  });

  it("takes WebKit's failed read for unavailable storage", () => {
    // equin.ai on Safari, the stall watchdog's read (2026-11-21).
    const message = "Error looking up record in object store by key range";
    expect(idbFailureOf(webkitError(message))).toEqual({
      kind: "unavailable",
      name: "UnknownError",
      message,
    });
  });

  it("takes full or refused storage for unavailable, wrapped or not", () => {
    for (const name of ["QuotaExceededError", "SecurityError"]) {
      expect(idbFailureOf(named(name)).kind).toBe("unavailable");
    }
    const wrapped = new Error("open failed", {
      cause: named("SecurityError"),
    });
    expect(idbFailureOf(wrapped).kind).toBe("unavailable");
  });

  it("leaves the caller's own bugs a fault", () => {
    for (const name of [
      "DataCloneError",
      "DataError",
      "ConstraintError",
      "NotFoundError",
      "VersionError",
      "InvalidStateError",
      "AbortError",
      "TypeError",
    ]) {
      expect(idbFailureOf(named(name))).toEqual({ kind: "fault" });
    }
    expect(idbFailureOf(undefined)).toEqual({ kind: "fault" });
  });

  it("ends on a cause cycle", () => {
    const a = new Error("a");
    a.cause = a;
    expect(idbFailureOf(a)).toEqual({ kind: "fault" });
  });
});
