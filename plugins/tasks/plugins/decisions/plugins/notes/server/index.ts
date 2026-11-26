import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { deleteDecisionNote, upsertDecisionNote } from "../shared";
import { decisionNoteRowsServed } from "./internal/resource";
import {
  handleDeleteDecisionNote,
  handleUpsertDecisionNote,
} from "./internal/routes";

export default {
  description:
    "The user's private note on a decision (decisions_ext_notes, one per decision): the decision-notes live rows and the PUT / DELETE routes that save it. Never sent to the agent.",
  contributions: [...decisionNoteRowsServed.declare],
  httpRoutes: {
    [upsertDecisionNote.route]: handleUpsertDecisionNote,
    [deleteDecisionNote.route]: handleDeleteDecisionNote,
  },
} satisfies ServerPluginDefinition;
