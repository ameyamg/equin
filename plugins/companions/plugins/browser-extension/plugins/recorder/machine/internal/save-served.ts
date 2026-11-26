import { eq } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { serveValue } from "@plugins/network/plugins/live/machine";
import { recordingSave } from "../../core";
import { _recorderSaves } from "../../server";

// A recording's save: its row once the save job ended, `pending` until then.
// Read while a relay waits on one save (a handful at once at most), so a write
// to any row re-reading every waiting save is nothing.
export const recordingSaveServed = serveValue(recordingSave, {
  source: "db",
  reads: {
    tables: [_recorderSaves],
    reason:
      "one recording's save outcome, written once by the save job when it ends",
  },
  loader: async ({ id }) => {
    const [row] = await db
      .select({ outcome: _recorderSaves.outcome })
      .from(_recorderSaves)
      .where(eq(_recorderSaves.id, id));
    return row === undefined ? { state: "pending" as const } : row.outcome;
  },
});
