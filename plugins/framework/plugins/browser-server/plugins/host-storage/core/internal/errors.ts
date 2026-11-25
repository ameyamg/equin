import { HostRefusedError } from "@plugins/framework/plugins/browser-server/core";

/**
 * The storage belongs to newer code than this worker's: its stored data was
 * migrated (or seeded) by a newer build, or a newer build's worker holds it.
 * Booting would run old code over the new schema, so the host refuses
 * (`{ kind: "outdated" }`), and the tab asks for a reload — which loads the
 * newer build.
 */
export class StorageNewerThanCodeError extends HostRefusedError {
  constructor(detail: string) {
    super({ kind: "outdated" }, detail);
    this.name = "StorageNewerThanCodeError";
  }
}

/**
 * The browser closed a connection this worker held and never closed itself
 * (`idb.ts`'s `idbConnect` says when). Not a fault of this code: the browser
 * reclaimed it — WebKit's storage process gone under a backgrounded page, a
 * versionchange reaching a suspended one, the site's data cleared.
 */
export class ConnectionClosedByBrowserError extends Error {
  constructor(database: string, cause: unknown) {
    super(
      `[host-storage] the browser closed IndexedDB ${database} under this worker (it was never closed here)`,
    );
    this.name = "ConnectionClosedByBrowserError";
    this.cause = cause;
  }
}

/** Whether `err`, or an error in its `cause` chain, is the browser closing a connection (`ConnectionClosedByBrowserError`). */
export function isClosedByBrowser(err: unknown): boolean {
  const seen = new Set<unknown>();
  for (let e: unknown = err; e != null && !seen.has(e);) {
    if (e instanceof ConnectionClosedByBrowserError) return true;
    seen.add(e);
    e = typeof e === "object" && "cause" in e ? e.cause : null;
  }
  return false;
}

/**
 * The boot was cut short by the browser — it suspended the page
 * (`isSuspensionAbort`), or closed the storage's connection under it
 * (`isClosedByBrowser`) — not by a fault: the host declines
 * (`{ kind: "interrupted" }`) and the page starts it again on a fresh worker.
 * The storage is left as its last committed transaction left it — a
 * database never created, a lifecycle record still `seeding` (which the next
 * open wipes and seeds again), or a booted one short of the write that was
 * cut, as after a tab closed mid-write.
 */
export class BootInterruptedError extends HostRefusedError {
  constructor(cause: unknown) {
    super(
      { kind: "interrupted" },
      "the browser cut the storage's IndexedDB work short (it suspended the page — back/forward cache, a background tab — or closed the connection under it)",
    );
    this.name = "BootInterruptedError";
    this.cause = cause;
  }
}
