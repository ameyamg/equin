import { _decisions } from "@plugins/tasks/plugins/decisions/server";
import { defineExtension } from "@plugins/infra/plugins/entity-extensions/server";
import { decisionNotesShape } from "../../core";

// Growth bound: one row per decision at most (its key is the decision),
// cascading with it.
export const decisionNotes = defineExtension(
  _decisions,
  "notes",
  decisionNotesShape,
);
export const _decisionNotesTable = decisionNotes.table;
