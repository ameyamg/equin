import { index, pgTable, timestamp } from "drizzle-orm/pg-core";
import { parsedJson } from "@plugins/database/plugins/sql-column/server";
import { externalIdColumn } from "@plugins/ids/server";
import { RecordingSaveOutcomeSchema } from "../../core";

/**
 * What each recording's save came to, by recording id: written once by the
 * machine half's save job when it ends (saved, or failed for good), read as
 * the `recorder.save` live value. The video itself is a file; this row only
 * tells whoever waits on the save where it landed. Kept a week
 * (`recorderSavesRetention`): a wait never outlives a save by that long.
 */
export const _recorderSaves = pgTable(
  "recorder_saves",
  {
    id: externalIdColumn("id", {
      reason:
        "a recording's id is the UUID its files in the Recordings folder are named by (.<id>.partial.mp4), minted at create",
    }),
    outcome: parsedJson("outcome", RecordingSaveOutcomeSchema).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  // The retention sweep's age predicate.
  (t) => [index("recorder_saves_created_at_idx").on(t.createdAt)],
);
