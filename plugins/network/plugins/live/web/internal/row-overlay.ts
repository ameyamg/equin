// The ROW OVERLAY: a write predicted on a collection's rows, drawn by every
// read of that collection at once — each window (a row whose predicted values
// no longer match the window's filter leaves it), each id set, each row read —
// until the server's own rows carry it.
//
// Why here, in `useLive`, and not in a consumer: a write to a row of a
// collection read through windows (a thread marked Done in a mail list) moves
// the row out of some windows and changes it in others, and no consumer holds
// every window. The overlay is keyed by collection, module-level (like the
// send lane), so every mounted read sees the same prediction.
//
// The model is overlay / replay, as `optimistic-mutation`'s: a read draws
// `entries.reduce(apply, serverRows)` and never writes a prediction into the
// cache. Each entry is one write:
//
// - PENDING (its send not acked): it applies to every row it names.
// - ACKED (the server holds the write and has notified its readers): it
//   applies only to row objects this page received BEFORE the ack — a row
//   received after it is the server's answer, which carries the write (or
//   whatever the server decided instead: the server's truth wins). So an
//   acked entry never masks a later change, and lingering is harmless; old
//   acked entries are dropped past a small cap.
//
// Residual window: a frame the server computed before the write but that
// reached the page after the ack shows the old row for one frame, until the
// re-read the write's notify triggered lands. The external arm's notify runs
// before the endpoint answers, so this needs a re-read in flight across the
// write.
//
// Leaving a window. A window's filter is re-decided over the predicted row
// on the columns the write changes ONLY (`columns`), three-valued: a clause on
// any other column is unknown (the server may evaluate it in ways a row cannot
// show — per message, by provider search). A row leaves a window when its
// predicted row is definitely out AND its server row was not already: the
// write is what moved it. It never enters a window by prediction — the
// server's re-read brings it.

import { useSyncExternalStore } from "react";
import {
  testClause,
  type Filter,
  type Filterable,
} from "@plugins/network/plugins/live/plugins/filter/core";

/** One predicted write on some rows of a collection. */
export interface RowPatch {
  /** The rows it predicts, by id. */
  readonly ids: ReadonlySet<string>;
  /**
   * The filterable columns it changes: a window's filter is re-decided on
   * these only. Empty for a write that moves no row between windows.
   */
  readonly columns: ReadonlySet<string>;
  /** The row as the write leaves it: pure, a new object, the id unchanged. */
  readonly apply: (
    row: Readonly<Record<string, unknown>>,
  ) => Record<string, unknown>;
}

/** A pushed patch: mark it acked once the server holds the write, or drop it (the write did not happen). */
export interface RowPatchHandle {
  ack(): void;
  drop(): void;
}

interface Entry {
  readonly patch: RowPatch;
  /** The epoch it was acked at; `null` while pending. */
  ackedAt: number | null;
}

interface Store {
  entries: readonly Entry[];
  readonly listeners: Set<() => void>;
}

/** How many acked entries a collection keeps (they apply only to rows received before their ack). */
const ACKED_KEPT = 200;

const stores = new Map<string, Store>();
const EMPTY: readonly Entry[] = [];

/**
 * The page's ack clock: moved at every ack. A row object is stamped with it
 * when a read first sees it, so "received before the ack" is a comparison.
 */
let epoch = 0;
const seenAt = new WeakMap<object, number>();

/** A row object's receipt: the ack clock when a read first saw it. */
export function objectStamp(row: object): number {
  let at = seenAt.get(row);
  if (at === undefined) {
    at = epoch;
    seenAt.set(row, at);
  }
  return at;
}

/** Each tuple's last frame seen (its `appliedSeq`) and when; bounded, oldest out. */
const frames = new Map<string, { seq: number; at: number }>();
const FRAMES_KEPT = 4096;

/**
 * A tuple frame's receipt: the ack clock when a read first saw the tuple at
 * `appliedSeq` (live-state's per-tuple apply counter, which moves on EVERY
 * applied frame). Per frame, not per row object: structural sharing hands a
 * deep-equal frame back as the same objects, so a row the server put back
 * exactly as it was before a write would otherwise keep its pre-ack stamp
 * and the write's patch would mask it.
 */
export function frameStamp(tupleKey: string, appliedSeq: number): number {
  const seen = frames.get(tupleKey);
  if (seen !== undefined && seen.seq === appliedSeq) return seen.at;
  frames.delete(tupleKey);
  frames.set(tupleKey, { seq: appliedSeq, at: epoch });
  if (frames.size > FRAMES_KEPT) {
    frames.delete(frames.keys().next().value!);
  }
  return epoch;
}

function storeOf(collectionKey: string): Store {
  let store = stores.get(collectionKey);
  if (store === undefined) {
    store = { entries: EMPTY, listeners: new Set() };
    stores.set(collectionKey, store);
  }
  return store;
}

function publish(store: Store, entries: readonly Entry[]): void {
  store.entries = entries;
  for (const l of store.listeners) l();
}

/**
 * Draw `patch` on every read of the collection keyed `collectionKey` from now
 * on. Returns its handle: `ack()` once the server holds the write (rows
 * received after that are the server's), `drop()` when it did not happen.
 */
export function pushRowPatch(
  collectionKey: string,
  patch: RowPatch,
): RowPatchHandle {
  const store = storeOf(collectionKey);
  const entry: Entry = { patch, ackedAt: null };
  publish(store, [...store.entries, entry]);
  return {
    ack: () => {
      if (entry.ackedAt !== null || !store.entries.includes(entry)) return;
      // Every row seen so far was received before this ack.
      epoch += 1;
      entry.ackedAt = epoch - 1;
      const acked = store.entries.filter((e) => e.ackedAt !== null);
      const drop = new Set(
        acked.slice(0, Math.max(0, acked.length - ACKED_KEPT)),
      );
      publish(
        store,
        drop.size === 0
          ? [...store.entries]
          : store.entries.filter((e) => !drop.has(e)),
      );
    },
    drop: () => {
      if (!store.entries.includes(entry)) return;
      publish(
        store,
        store.entries.filter((e) => e !== entry),
      );
    },
  };
}

/** The collection's overlay entries now (the hook's snapshot). */
export function rowPatchesOf(collectionKey: string): readonly Entry[] {
  return stores.get(collectionKey)?.entries ?? EMPTY;
}

/** The collection's overlay entries, re-rendering on every change. */
export function useRowPatches(collectionKey: string): readonly Entry[] {
  const store = storeOf(collectionKey);
  return useSyncExternalStore(
    (l) => {
      store.listeners.add(l);
      return () => store.listeners.delete(l);
    },
    () => store.entries,
    () => store.entries,
  );
}

export type RowPatchEntries = readonly Entry[];

/** The entries that still apply to this row object, oldest first. */
function applying(entries: RowPatchEntries, id: string, at: number): Entry[] {
  let out: Entry[] | null = null;
  for (const e of entries) {
    if (!e.patch.ids.has(id)) continue;
    if (e.ackedAt !== null && at > e.ackedAt) continue;
    (out ??= []).push(e);
  }
  return out ?? [];
}

type Verdict = true | false | "unknown";

/** `filter` over `row`, deciding only clauses on `known` columns (Kleene and / or). */
export function filterVerdict(
  filter: Filter,
  row: Readonly<Record<string, unknown>>,
  known: ReadonlySet<string>,
  filterable: Filterable,
): Verdict {
  if ("and" in filter) {
    let out: Verdict = true;
    for (const f of filter.and) {
      const v = filterVerdict(f, row, known, filterable);
      if (v === false) return false;
      if (v === "unknown") out = "unknown";
    }
    return out;
  }
  if ("or" in filter) {
    let out: Verdict = false;
    for (const f of filter.or) {
      const v = filterVerdict(f, row, known, filterable);
      if (v === true) return true;
      if (v === "unknown") out = "unknown";
    }
    return out;
  }
  if (!known.has(filter.column) || !Object.hasOwn(filterable, filter.column)) {
    return "unknown";
  }
  return testClause(row[filter.column], filter, filterable);
}

/** A window's filter, as the overlay re-decides it. */
export interface OverlayWindow {
  filter: Filter | undefined;
  filterable: Filterable;
}

/**
 * The rows as the overlay draws them: each predicted row in place of the
 * server's, and — with a `window` — a row its writes move out of the window's
 * filter left out. Returns `rows` itself when nothing applies.
 */
export function overlayRows<Row>(
  entries: RowPatchEntries,
  rows: readonly Row[],
  /** A row's key (the collection's `keyOf`). */
  keyOf: (row: Row, index: number) => string,
  /** The window's filter, asked only when a patch applies to a row (`null`: an id read). */
  window: (() => OverlayWindow) | null,
  /**
   * When the page received each row, on the ack clock: a paged read stamps
   * the tuple FRAME it came in ({@link frameStamp}); the default stamps the
   * row object itself.
   */
  stampOf: (row: Row, index: number) => number = (row) =>
    objectStamp(row as object),
): readonly Row[] {
  if (entries.length === 0) return rows;
  let out: Row[] | null = null;
  let win: OverlayWindow | null = null;
  rows.forEach((row, i) => {
    const record = row as Readonly<Record<string, unknown>>;
    const id = keyOf(row, i);
    const apply = applying(entries, id, stampOf(row, i));
    if (apply.length === 0) {
      out?.push(row);
      return;
    }
    out ??= rows.slice(0, i) as Row[];
    let next: Record<string, unknown> = { ...record };
    const columns = new Set<string>();
    for (const e of apply) {
      next = e.patch.apply(next);
      for (const c of e.patch.columns) columns.add(c);
    }
    if (window !== null && columns.size > 0) win ??= window();
    if (win !== null && win.filter !== undefined && columns.size > 0) {
      const after = filterVerdict(win.filter, next, columns, win.filterable);
      const before = filterVerdict(win.filter, record, columns, win.filterable);
      if (after === false && before !== false) return;
    }
    out.push(next as Row);
  });
  return out ?? rows;
}
