import { describe, expect, it } from "bun:test";
import type { StallRecord } from "./stall-machine";
import { createStallStore } from "./stall-store";

const RECORD = { id: "s1", owner: "w1" } as unknown as StallRecord;
const unknown = (message: string) => new DOMException(message, "UnknownError");

/** An IndexedDB that fails where told to, once each. */
function fakeIdb() {
  const fail: {
    open?: Error;
    transaction?: Error;
    request?: Error;
    /** The requests succeed and the transaction then aborts (null: no error). */
    commit?: Error | null;
    /** The request call itself throws (our own bug), whatever its name. */
    sync?: Error;
    /** A fresh database: the upgrade runs, and createObjectStore throws this. */
    upgrade?: Error;
  } = {};
  let opens = 0;
  const take = <K extends keyof typeof fail>(key: K) => {
    const err = fail[key];
    delete fail[key];
    return err;
  };

  const db = {
    transaction() {
      const closing = take("transaction");
      if (closing) throw closing;
      const request = (result: unknown) => () => {
        const thrown = take("sync");
        if (thrown) throw thrown;
        const req: Record<string, unknown> = {};
        queueMicrotask(() => {
          const err = take("request");
          if (err) {
            req.error = err;
            (req.onerror as () => void)();
            return;
          }
          req.result = result;
          const aborted = take("commit");
          if (aborted !== undefined) {
            tx.error = aborted;
            tx.onabort?.();
          } else tx.oncomplete?.();
        });
        return req;
      };
      const tx = {
        error: null as Error | null,
        onabort: undefined as (() => void) | undefined,
        oncomplete: undefined as (() => void) | undefined,
        objectStore: () => ({
          get: request(RECORD),
          getAll: request([RECORD]),
          put: request("s1"),
          delete: request(undefined),
        }),
      };
      return tx;
    },
  };

  const idb = {
    open() {
      opens++;
      const req: Record<string, unknown> = {};
      queueMicrotask(() => {
        const upgrade = take("upgrade");
        if (upgrade) {
          let aborted = false;
          req.result = {
            createObjectStore: () => {
              throw upgrade;
            },
          };
          req.transaction = { abort: () => (aborted = true) };
          (req.onupgradeneeded as () => void)();
          if (!aborted) throw new Error("the upgrade was not aborted");
          req.error = new DOMException("upgrade aborted", "AbortError");
          (req.onerror as () => void)();
          return;
        }
        const err = take("open");
        req.error = err;
        req.result = db;
        (req[err ? "onerror" : "onsuccess"] as () => void)();
      });
      return req;
    },
  };
  const store = createStallStore(idb as unknown as IDBFactory, "test");
  return { store, fail, opens: () => opens };
}

describe("stall store", () => {
  it("answers Safari's failed read as unavailable, and reads the next time", async () => {
    const { store, fail } = fakeIdb();
    const message = "Error looking up record in object store by key range";
    fail.request = unknown(message);
    expect(await store.get("s1")).toEqual({
      kind: "unavailable",
      reason: "failed",
      name: "UnknownError",
      message,
    });
    expect(await store.get("s1")).toEqual({ kind: "done", value: RECORD });
  });

  it("never calls a write done whose commit a suspension cut short", async () => {
    const { store, fail } = fakeIdb();
    fail.commit = unknown(
      "Transaction was aborted while its process was suspended",
    );
    expect(await store.put(RECORD)).toMatchObject({
      kind: "unavailable",
      reason: "suspended",
    });
  });

  it("answers a transaction the browser aborted with no error", async () => {
    const { store, fail } = fakeIdb();
    fail.commit = null;
    expect(await store.delete("s1")).toMatchObject({
      kind: "unavailable",
      reason: "aborted",
    });
  });

  it("opens again after an open the browser refused", async () => {
    const { store, fail, opens } = fakeIdb();
    fail.open = new DOMException("site data blocked", "SecurityError");
    expect(await store.all()).toMatchObject({ kind: "unavailable" });
    expect(await store.all()).toEqual({ kind: "done", value: [RECORD] });
    expect(opens()).toBe(2);
  });

  it("replaces a connection the browser closed", async () => {
    const { store, fail, opens } = fakeIdb();
    await store.all();
    fail.transaction = new DOMException("closing", "InvalidStateError");
    expect(await store.all()).toEqual({ kind: "done", value: [RECORD] });
    expect(opens()).toBe(2);
  });

  it("throws a failed upgrade's own error, never an absorbed AbortError", () => {
    const { store, fail } = fakeIdb();
    fail.upgrade = new DOMException("store exists", "ConstraintError");
    expect(store.all()).rejects.toThrow("store exists");
  });

  it("throws what our request throws synchronously, whatever its name", () => {
    const { store, fail } = fakeIdb();
    fail.sync = unknown("The serialized value is too large");
    expect(store.put(RECORD)).rejects.toThrow("too large");
  });

  it("throws its own faults", () => {
    const { store, fail } = fakeIdb();
    fail.request = new DOMException("cannot clone", "DataCloneError");
    expect(store.put(RECORD)).rejects.toThrow("cannot clone");
  });
});
