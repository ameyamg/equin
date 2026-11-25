import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  BootInterruptedError,
  ConnectionClosedByBrowserError,
  isClosedByBrowser,
} from "./errors";
import { idbConnect } from "./idb";

// A connection as an engine keeps it: close-pending once closed (by its holder
// or by the browser), `transaction()` then throwing InvalidStateError.
class FakeDb {
  closePending = false;
  onclose: (() => void) | null = null;
  objectStoreNames = { contains: () => true };
  transaction(): IDBTransaction {
    if (this.closePending) {
      throw new DOMException(
        "Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.",
        "InvalidStateError",
      );
    }
    return {} as IDBTransaction;
  }
  close(): void {
    this.closePending = true;
  }
  /** What the browser does when it forcibly closes the connection. */
  forciblyClose(): void {
    this.closePending = true;
    queueMicrotask(() => this.onclose?.());
  }
}

let db: FakeDb;
const saved = globalThis.indexedDB;
beforeEach(() => {
  db = new FakeDb();
  globalThis.indexedDB = {
    open: () => {
      const req: Record<string, unknown> = { result: db };
      queueMicrotask(() => (req.onsuccess as () => void)());
      return req;
    },
  } as unknown as IDBFactory;
});
afterEach(() => {
  globalThis.indexedDB = saved;
});

describe("idbConnect", () => {
  it("names a connection the browser closed (report-1795442130-96l08u)", async () => {
    const conn = await idbConnect("stores", ["entries"]);
    conn.transaction("entries");
    db.forciblyClose();
    let thrown: unknown;
    try {
      conn.transaction("entries", "readwrite");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ConnectionClosedByBrowserError);
    expect((thrown as Error).cause).toBeInstanceOf(DOMException);
    // A boot cut short by it is declined as an interruption, not a crash.
    expect(isClosedByBrowser(new Error("boot failed", { cause: thrown }))).toBe(
      true,
    );
    expect(new BootInterruptedError(thrown).refusal).toEqual({
      kind: "interrupted",
    });
  });

  it("leaves a use after its own close as the caller's bug", async () => {
    const conn = await idbConnect("stores", ["entries"]);
    conn.close();
    let thrown: unknown;
    try {
      conn.transaction("entries");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(DOMException);
    expect(isClosedByBrowser(thrown)).toBe(false);
  });
});
