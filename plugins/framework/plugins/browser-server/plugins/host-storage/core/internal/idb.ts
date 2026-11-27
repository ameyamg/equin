// The few IndexedDB calls this plugin makes, as promises. Kept to what it
// needs: one object store of entries keyed by [store, key], read whole at open
// and written one transaction per change.

import { idbFailureOf } from "@plugins/primitives/plugins/dom/plugins/indexed-db-failure/core";
import {
  ConnectionClosedByBrowserError,
  StorageUnavailableError,
} from "./errors";

export function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

/** Resolves when `tx` commits; rejects with its error when it aborts. */
export function idbDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => {
      // `onabort` follows with the same error.
    };
  });
}

/**
 * A connection to one database, as this plugin holds it: transactions and its
 * own close, nothing else — so every transaction goes through the one place
 * that knows whether the connection was closed HERE.
 */
export interface IdbConnection {
  /**
   * `db.transaction`, except on a connection the browser closed itself:
   * throws `ConnectionClosedByBrowserError` instead of a bare
   * `InvalidStateError` ("The database connection is closing").
   */
  transaction(
    stores: string | readonly string[],
    mode?: IDBTransactionMode,
  ): IDBTransaction;
  /** Close it; nothing may use it after. */
  close(): void;
}

/**
 * Open (creating) `name` with the given object stores.
 *
 * The browser may close a connection on its own ("forcibly close" in the
 * IndexedDB spec): WebKit does when the storage process serving it goes away
 * (iOS reclaims it from a backgrounded page: "Connection to Indexed Database
 * server lost"), and when a versionchange reaches a suspended page
 * (`IDBConnectionProxy::fireVersionChangeEvent`: "Connection on cached page
 * closed to unblock other connections"); any engine may when the site's data
 * is cleared. The connection is then close-pending at once — its `close`
 * event follows as a later task — so `transaction()` throws
 * `InvalidStateError`. That is the only `InvalidStateError` it can throw on a
 * connection that is neither being upgraded (never used during
 * `onupgradeneeded` here) nor closed by its holder, so one on a connection
 * this side never closed is the browser's close, named as such.
 */
export async function idbConnect(
  name: string,
  objectStores: readonly string[],
): Promise<IdbConnection> {
  const db = await unavailableAsTyped(name, idbOpen(name, objectStores));
  let closedHere = false;
  db.onclose = () =>
    console.warn(
      `[host-storage] the browser closed IndexedDB ${name} under this worker`,
    );
  return {
    transaction(stores, mode) {
      try {
        return db.transaction(stores as string | string[], mode);
      } catch (err) {
        if (
          !closedHere &&
          err instanceof DOMException &&
          err.name === "InvalidStateError"
        ) {
          throw new ConnectionClosedByBrowserError(name, err);
        }
        throw err;
      }
    },
    close() {
      closedHere = true;
      db.close();
    },
  };
}

/** Open (creating) `name` with the given object stores. */
function idbOpen(
  name: string,
  objectStores: readonly string[],
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      for (const s of objectStores) {
        if (!req.result.objectStoreNames.contains(s))
          req.result.createObjectStore(s);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error(`IndexedDB: could not open ${name}`));
    req.onblocked = () =>
      reject(
        new Error(
          `IndexedDB: opening ${name} is blocked by an older connection that will not close`,
        ),
      );
  });
}

/**
 * `opening`, except that the browser refusing to open `name` (its own storage
 * failed or refused this context: `idbFailureOf`'s `unavailable`) rejects
 * `StorageUnavailableError`. Only an OPEN is read so: nothing was written yet,
 * so the storage can still be served from memory. A failure later (a
 * transaction) stays the error it is.
 */
async function unavailableAsTyped<T>(
  name: string,
  opening: Promise<T>,
): Promise<T> {
  try {
    return await opening;
  } catch (err) {
    const failure = idbFailureOf(err);
    if (failure.kind === "unavailable") {
      throw new StorageUnavailableError(
        name,
        `${failure.name}: ${failure.message}`,
        err,
      );
    }
    throw err;
  }
}

/**
 * Whether the browser opens `name`, without creating it or changing it: an
 * existing database opens as it is (no version, so never upgraded) and is
 * closed at once; an absent one's creation is aborted. Rejects
 * `StorageUnavailableError` when the browser refuses (the open itself, before
 * any upgrade: WebKit opens the database's file first), and any other error
 * as it is.
 *
 * What `open.ts` asks of PGlite's IDBFS database before it touches anything:
 * PGlite opens it later, inside the boot, where a refusal could no longer be
 * served from memory.
 */
export function idbProbeOpen(name: string): Promise<void> {
  return unavailableAsTyped(
    name,
    new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(name);
      let absent = false;
      req.onupgradeneeded = () => {
        absent = true;
        req.transaction!.abort();
      };
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => {
        if (absent) resolve();
        else
          reject(req.error ?? new Error(`IndexedDB: could not open ${name}`));
      };
    }),
  );
}
