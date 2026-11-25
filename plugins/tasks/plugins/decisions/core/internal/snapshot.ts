import { z } from "zod";
import { cappedList } from "@plugins/packages/plugins/list-bound/core";
import {
  DECISION_OPTIONS_MAX,
  DECISION_STATES,
  DecisionOptionSchema,
} from "./fields";

/** The history source id a decision's versions are recorded under. */
export const DECISION_HISTORY_SOURCE = "decision";

/**
 * What a version of a decision holds (`history/engine`'s opaque snapshot,
 * typed here so the server writes it and the card's version navigator reads
 * it with one schema): what the decision SAYS — never its thread
 * (append-only on its own) nor who saw it. `closedAt` travels with `state`
 * and `outcome`, so a restored version keeps the table's CHECKs.
 */
export const DecisionSnapshotSchema = z.object({
  label: z.string(),
  state: z.enum(DECISION_STATES),
  stateLabel: z.string().nullable(),
  question: z.string(),
  body: z.string(),
  options: cappedList(DecisionOptionSchema, { max: DECISION_OPTIONS_MAX }),
  outcome: z.string().nullable(),
  closedAt: z.string().nullable(),
});
export type DecisionSnapshot = z.infer<typeof DecisionSnapshotSchema>;
