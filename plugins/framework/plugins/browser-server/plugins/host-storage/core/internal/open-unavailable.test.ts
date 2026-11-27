/**
 * A persistent storage whose IndexedDB the browser will not open — iOS
 * Safari's `UnknownError` "Unable to open database file on disk"
 * (report-1795766338-jy60yr): the open falls back to memory, filled from its
 * snapshot, says so (`memoryOnly`), and releases the storage's lock. A
 * failure that is not the browser's storage (a bug of ours) still fails.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { encodeHostSnapshot } from "./snapshot";
import { openHostStorage } from "./open";
import { StorageUnavailableError } from "./errors";
import { idbConnect, idbProbeOpen } from "./idb";

const TAKEN_AT = 1_790_000_000_000;

async function snapshotRef() {
  const file = await encodeHostSnapshot({
    takenAt: TAKEN_AT,
    migrations: ["m1"],
    database: new Blob([new Uint8Array([1, 2, 3])]),
    stores: { notes: [["a", { at: TAKEN_AT }]] },
  });
  return {
    version: "v1",
    takenAt: TAKEN_AT,
    load: () => Promise.resolve(file),
  };
}

/** Every open the fake browser was asked for, by name. */
let opened: string[];
/** What an open of each name answers: an error, or an upgrade-then-success. */
let answer: (name: string) => DOMException | "upgrade" | "open";
/** Locks currently held, by name. */
let held: Set<string>;

const savedIdb = globalThis.indexedDB;
const savedLocks = Object.getOwnPropertyDescriptor(navigator, "locks");

beforeEach(() => {
  opened = [];
  held = new Set();
  globalThis.indexedDB = {
    open(name: string) {
      opened.push(name);
      const req: Record<string, unknown> = {};
      queueMicrotask(() => {
        const a = answer(name);
        if (a instanceof DOMException) {
          req.error = a;
          (req.onerror as () => void)();
        } else if (a === "upgrade") {
          // An absent database: the probe aborts its creation.
          let aborted = false;
          req.transaction = { abort: () => (aborted = true) };
          req.result = { objectStoreNames: { contains: () => false } };
          (req.onupgradeneeded as () => void)();
          expect(aborted).toBe(true);
          req.error = new DOMException("aborted", "AbortError");
          (req.onerror as () => void)();
        } else {
          req.result = { close() {} };
          (req.onsuccess as () => void)();
        }
      });
      return req;
    },
  } as unknown as IDBFactory;
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      query: () => Promise.resolve({}),
      async request(
        name: string,
        _opts: unknown,
        cb: () => Promise<void>,
      ): Promise<void> {
        held.add(name);
        try {
          await cb();
        } finally {
          held.delete(name);
        }
      },
    },
  });
});
afterEach(() => {
  globalThis.indexedDB = savedIdb;
  if (savedLocks === undefined)
    delete (navigator as unknown as Record<string, unknown>).locks;
  else Object.defineProperty(navigator, "locks", savedLocks);
});

const spec = async () => ({
  kind: "persistent" as const,
  name: "demo-workspace",
  migrations: ["m1"],
  start: { snapshot: await snapshotRef(), whenOutdated: "reset" as const },
  identity: { build: "b1", worker: "demo@1" },
  onSuperseded: () => Promise.resolve(),
});

const diskRefusal = () =>
  new DOMException("Unable to open database file on disk", "UnknownError");

describe("openHostStorage where the browser will not open IndexedDB", () => {
  test("PGlite's database refused: served from memory, said so, lock released", async () => {
    answer = (name) => (name.startsWith("/pglite/") ? diskRefusal() : "open");
    const storage = await openHostStorage(await spec());
    expect(storage.kind).toBe("memory");
    expect(storage.memoryOnly).toEqual({
      why: "storage-unavailable",
      error: "UnknownError: Unable to open database file on disk",
    });
    expect(storage.origin).toEqual({
      kind: "snapshot",
      replacedOutdated: false,
    });
    expect(storage.databaseStart.from).toBe("snapshot");
    // Probed first: the stores were never opened, nothing written.
    expect(opened).toEqual(["/pglite/equin-host--demo-workspace--db"]);
    await Promise.resolve();
    expect(held.size).toBe(0);
    await storage.close();
  });

  test("the stores' database refused: the same", async () => {
    answer = (name) =>
      name.startsWith("/pglite/") ? "upgrade" : diskRefusal();
    const storage = await openHostStorage(await spec());
    expect(storage.memoryOnly?.why).toBe("storage-unavailable");
    expect(opened).toEqual([
      "/pglite/equin-host--demo-workspace--db",
      "equin-host--demo-workspace--stores",
    ]);
  });

  test("a failure that is not the browser's storage still fails", async () => {
    answer = () => new DOMException("bad version", "VersionError");
    expect(openHostStorage(await spec())).rejects.toThrow("bad version");
  });
});

describe("idb opens", () => {
  test("a refused open is a StorageUnavailableError naming the database", async () => {
    answer = () => diskRefusal();
    expect(idbProbeOpen("x")).rejects.toBeInstanceOf(StorageUnavailableError);
    expect(idbConnect("y", ["entries"])).rejects.toThrow(
      "the browser would not open IndexedDB y: UnknownError: Unable to open database file on disk",
    );
  });

  test("the probe neither creates an absent database nor fails on it", async () => {
    answer = () => "upgrade";
    await idbProbeOpen("x");
  });
});
