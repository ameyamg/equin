// The watchdog's durable stall records, in IndexedDB — the one store a
// SharedWorker can write that outlives it (the worker dies with the last tab of
// the origin, or with the browser). Written at most a handful of times per
// stall (stall-machine's persist / forget effects), never while idle. Worker-
// safe: raw IndexedDB, and the one pure classifier of its failures.
//
// The records are evidence, not state the watch needs. So when the browser
// takes the storage away — Safari suspending this worker, site data blocked or
// evicted, its backing store failing — the operation answers `unavailable`:
// no record this time, and the watch goes on. Anything else throws.

import { idbFailureOf } from "@plugins/primitives/plugins/dom/plugins/indexed-db-failure/core";
import type { StallRecord } from "./stall-machine";

const STORE = "stalls";

/** One operation's answer; a fault of our own is thrown, never answered. */
export type Stored<T> =
  | { kind: "done"; value: T }
  | {
      kind: "unavailable";
      /** `suspended`, `aborted` by the browser, or its storage `failed`. */
      reason: "suspended" | "aborted" | "failed";
      name: string;
      message: string;
    };

export interface StallStore {
  put(record: StallRecord): Promise<Stored<void>>;
  delete(id: string): Promise<Stored<void>>;
  get(id: string): Promise<Stored<StallRecord | undefined>>;
  all(): Promise<Stored<StallRecord[]>>;
}

/**
 * An error the BROWSER delivered for our work — an open's, a request's or a
 * transaction's error event. Only these are classified: whatever our own code
 * throws synchronously (a bad key, an uncloneable value, a missing store, an
 * exception in the upgrade) is a fault, whatever its name.
 */
class Delivered {
  constructor(
    readonly error: unknown,
    readonly by: "open" | "request" | "transaction",
  ) {}
}

/**
 * The browser's failure as an answer; rethrows ours. A transaction's
 * `AbortError` is the browser's HERE only: each one holds one request and this
 * store aborts none, so only the browser can have.
 */
function unavailableOr(failed: Delivered): Stored<never> {
  const failure = idbFailureOf(failed.error);
  if (failure.kind !== "fault") {
    return {
      kind: "unavailable",
      reason: failure.kind === "suspended" ? "suspended" : "failed",
      name: failure.name,
      message: failure.message,
    };
  }
  const err = failed.error;
  if (
    failed.by !== "open" &&
    err instanceof DOMException &&
    err.name === "AbortError"
  ) {
    return {
      kind: "unavailable",
      reason: "aborted",
      name: err.name,
      message: err.message,
    };
  }
  throw err;
}

function opened(idb: IDBFactory, dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = idb.open(dbName, 1);
    // An exception here aborts the upgrade, and the open then fails with a
    // bare AbortError: kept, so the open fails with what really went wrong.
    let upgradeFault: unknown = null;
    open.onupgradeneeded = () => {
      try {
        open.result.createObjectStore(STORE, { keyPath: "id" });
      } catch (err) {
        upgradeFault = err;
        open.transaction?.abort();
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () =>
      reject(
        upgradeFault ??
          new Delivered(
            open.error ?? new Error("IndexedDB: open failed"),
            "open",
          ),
      );
  });
}

/**
 * Settles with the TRANSACTION: a write whose request succeeded is still lost
 * when the commit fails (how Safari reports a suspension, and a full quota).
 * A request the browser aborted while pending fails with a bare AbortError
 * before its transaction's abort event, which carries the reason: that one is
 * awaited instead.
 */
function committed<T>(tx: IDBTransaction, req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onerror = () => {
      const err = req.error;
      if (err?.name === "AbortError") return;
      reject(
        new Delivered(err ?? new Error("IndexedDB: request failed"), "request"),
      );
    };
    tx.oncomplete = () => resolve(req.result);
    tx.onabort = () =>
      reject(
        new Delivered(
          tx.error ?? new DOMException("the transaction aborted", "AbortError"),
          "transaction",
        ),
      );
  });
}

export function createStallStore(idb: IDBFactory, dbName: string): StallStore {
  // Opened on first use, and again on the next use after a failed open.
  let connection: Promise<IDBDatabase> | null = null;
  const connect = (): Promise<IDBDatabase> => {
    if (connection !== null) return connection;
    const opening = opened(idb, dbName).catch((err: unknown) => {
      connection = null;
      throw err;
    });
    connection = opening;
    return opening;
  };

  /**
   * A transaction on the live connection, its request issued and its events
   * listened to in the same step.
   */
  const issue = async <T>(
    mode: IDBTransactionMode,
    request: (s: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const used = connect();
    let tx: IDBTransaction;
    try {
      tx = (await used).transaction(STORE, mode);
    } catch (err) {
      // `transaction()` raises this only on a connection that is closing, and
      // this store closes none: the browser did (a suspended page's
      // connection, cleared site data, its storage process gone). Opened once
      // more; failing again is a fault.
      if (!(err instanceof DOMException && err.name === "InvalidStateError"))
        throw err;
      if (connection === used) connection = null;
      tx = (await connect()).transaction(STORE, mode);
    }
    return committed(tx, request(tx.objectStore(STORE)));
  };

  const run = async <T>(
    mode: IDBTransactionMode,
    request: (s: IDBObjectStore) => IDBRequest<T>,
  ): Promise<Stored<T>> => {
    try {
      return { kind: "done", value: await issue(mode, request) };
    } catch (err) {
      if (err instanceof Delivered) return unavailableOr(err);
      throw err;
    }
  };

  return {
    put: async (record) => {
      const res = await run("readwrite", (s) => s.put(record));
      return res.kind === "done" ? { kind: "done", value: undefined } : res;
    },
    delete: (id) => run("readwrite", (s) => s.delete(id)),
    get: (id) =>
      run("readonly", (s) => s.get(id) as IDBRequest<StallRecord | undefined>),
    all: () => run("readonly", (s) => s.getAll() as IDBRequest<StallRecord[]>),
  };
}
