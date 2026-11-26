import type { ComponentType } from "react";
import { defineRenderSlot } from "@plugins/primitives/plugins/slot-render/web";
import type { DecisionRow } from "../core";

// What sub-plugins add to a DecisionCard answered in place (given a draft).
export const DecisionCardSlots = {
  /** Above the answer box, also on a decision no longer answerable (a closed one). */
  AboveAnswer: defineRenderSlot<{
    component: ComponentType<{ decision: DecisionRow }>;
  }>(),
  /** Beside the answer's editor, on its right: a small icon control. */
  AnswerAction: defineRenderSlot<{
    component: ComponentType<{ decision: DecisionRow }>;
  }>(),
};
