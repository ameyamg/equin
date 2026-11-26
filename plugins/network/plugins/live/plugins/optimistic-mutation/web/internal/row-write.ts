import {
  enqueueOnSendLane,
  pushRowPatch,
  resourceSendLaneKey,
} from "@plugins/network/plugins/live/web";
import type { LiveRowsCollection } from "@plugins/network/plugins/live/core";

/** A write to some rows of a collection, predicted on every read of it (see {@link writeRows}). */
export interface RowWrite<Row, T> {
  /** The rows it changes, by key. */
  ids: readonly string[];
  /**
   * The filterable columns it changes. A window's filter is re-decided over
   * the predicted row on these only, so a row the write moves out of a
   * window leaves it at once; `[]` for a write that moves no row.
   */
  columns: readonly (keyof Row & string)[];
  /** The row as the write leaves it — pure, the same reducer the server applies where one exists. */
  apply: (row: Row) => Row;
  /** The write itself. Resolved: the server holds it (and has notified its readers). */
  send: () => Promise<T>;
}

/**
 * Write rows of a collection read through windows, optimistically: the
 * prediction is drawn by every read of the collection at once — the row
 * changed in place, or gone from each window whose filter it no longer
 * matches (`network/live`'s row overlay) — from this call on, never by
 * writing into the cache. The send joins the collection's send lane, so two
 * writes leave in the order they were made (an undo after its write).
 *
 * Resolved (to the send's answer), the prediction gives way to the
 * server's rows as they arrive.
 * Rejected, it is dropped (the server does not hold the write) and the
 * rejection is returned to the caller, who says so — a write is never
 * reverted silently.
 */
export async function writeRows<Row, T>(
  collection: LiveRowsCollection<Row>,
  write: RowWrite<Row, T>,
): Promise<T> {
  const handle = pushRowPatch(collection.key, {
    ids: new Set(write.ids),
    columns: new Set(write.columns),
    apply: (row) => write.apply(row as Row) as Record<string, unknown>,
  });
  let answer: T;
  try {
    answer = await enqueueOnSendLane(
      resourceSendLaneKey(collection.key, undefined),
      write.send,
    );
  } catch (err) {
    handle.drop();
    throw err;
  }
  handle.ack();
  return answer;
}
