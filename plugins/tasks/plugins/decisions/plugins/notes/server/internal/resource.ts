import { serveCollection } from "@plugins/network/plugins/live/server";
import { decisionNoteRows } from "../../core";
import { decisionNotes } from "./tables";

export const decisionNoteRowsServed = serveCollection(decisionNoteRows, {
  from: decisionNotes,
});
