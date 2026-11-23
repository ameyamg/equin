// What an IndexedDB failure is ABOUT, read from the error alone: the browser
// stepping in (it suspended this context, its own storage failed or refused)
// or the caller's own code. Plain functions, no import: a self-contained
// worker bundle (the main-thread-stall watchdog) inlines it.

/**
 * What WebKit raises in a context whose IndexedDB work it cut short because
 * the context's process or page was SUSPENDED (a page in the back/forward
 * cache, a background tab's process) while that work stood in the way of
 * another context on the same database (another tab, its worker). WebCore
 * spells each case with its own text, all `UnknownError`:
 * - an open whose upgrade (always so when it creates the database) is
 *   answered while the context is suspended: the upgrade is aborted
 *   (`IDBConnectionProxy::completeOpenDBRequest`, report-1795070221-uzvq63);
 * - a connection a versionchange event reaches while the context is
 *   suspended: closed on its behalf (`IDBConnectionProxy::fireVersionChangeEvent`);
 * - a transaction in progress that blocks another client's while its client
 *   is suspended: aborted on the server
 *   (`UniqueIDBDatabase::abortInProgressTransactionsOfSuspendedClientsIfNeeded`).
 *   The client learns it only once it runs again: its commit fails with
 *   "Transaction was aborted while its process was suspended", and each
 *   request it still had queued reaches a server transaction that is gone —
 *   "Attempt to <op> without an in-progress transaction"
 *   (`SQLiteIDBBackingStore`; PGlite's IDBFS sync deleting a removed file,
 *   report-1795189021-x5spzw).
 * What was cut short never committed (an IndexedDB transaction is atomic),
 * so the data is as it stood before it.
 */
const SUSPENSION_ABORTS: ReadonlyArray<(message: string) => boolean> = [
  (m) =>
    m.includes(
      "Version change transaction on cached page is aborted to unblock other connections",
    ),
  (m) =>
    m.includes("Connection on cached page closed to unblock other connections"),
  (m) => m.includes("Transaction was aborted while its process was suspended"),
  (m) => /^Attempt to .+ without an in-progress transaction$/.test(m),
];

/**
 * The error names by which the browser says ITS storage failed or refused,
 * whatever the caller asked:
 * - `UnknownError` — the spec's "failed for reasons unrelated to the database
 *   itself": WebKit's backing-store failures ("Error looking up record in
 *   object store by key range", SQLite I/O), a database the browser lost;
 * - `QuotaExceededError` — the origin's storage is full or was evicted;
 * - `SecurityError` — the browser refuses this context storage (site data
 *   blocked, some private modes, a sandboxed frame).
 */
const UNAVAILABLE_NAMES: ReadonlySet<string> = new Set([
  "UnknownError",
  "QuotaExceededError",
  "SecurityError",
]);

/** At most this many links of a `cause` chain are read (a cycle ends too). */
const MAX_CHAIN = 8;

/** What an IndexedDB failure is about. */
export type IdbFailure =
  /** WebKit cut this context's work short while it was suspended (`isSuspensionAbort`). */
  | { kind: "suspended"; name: string; message: string }
  /** The browser's own storage failed or refused this context. */
  | { kind: "unavailable"; name: string; message: string }
  /** Anything else — a bad key, an uncloneable value, a missing store: the caller's bug. */
  | { kind: "fault" };

function fieldOf(e: unknown, key: "name" | "message"): string | null {
  if (typeof e !== "object" || e === null || !(key in e)) return null;
  const v = (e as Record<string, unknown>)[key];
  return typeof v === "string" ? v : null;
}

/**
 * What `err` (or an error in its `cause` chain — PGlite's open wraps the
 * request's error) says about the IndexedDB work that failed. A suspension
 * wins over a bare name: it is `UnknownError` too, and says more.
 */
export function idbFailureOf(err: unknown): IdbFailure {
  let unavailable: IdbFailure | null = null;
  const seen = new Set<unknown>();
  for (let e: unknown = err; e != null && !seen.has(e);) {
    if (seen.size >= MAX_CHAIN) break;
    seen.add(e);
    const message = fieldOf(e, "message") ?? "";
    const name = fieldOf(e, "name") ?? "Error";
    if (SUSPENSION_ABORTS.some((matches) => matches(message))) {
      return { kind: "suspended", name, message };
    }
    if (unavailable === null && UNAVAILABLE_NAMES.has(name)) {
      unavailable = { kind: "unavailable", name, message };
    }
    e = typeof e === "object" && "cause" in e ? e.cause : null;
  }
  return unavailable ?? { kind: "fault" };
}

/**
 * Whether `err` (or an error in its `cause` chain) is WebKit cutting this
 * context's IndexedDB work short because it was suspended — whichever
 * database it was.
 */
export function isSuspensionAbort(err: unknown): boolean {
  return idbFailureOf(err).kind === "suspended";
}
