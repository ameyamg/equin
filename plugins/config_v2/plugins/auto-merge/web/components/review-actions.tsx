import { createContext, useContext, type ReactElement } from "react";
import {
  defineItemActions,
  type ItemActionProps,
} from "@plugins/primitives/plugins/data-view/web";
import { Button } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import {
  sameFieldValue,
  type MergeFieldChoice,
  type MergeReviewField,
} from "@plugins/config_v2/core";

/** A row of the review: one field the merge touched, and whether the user changed it since. */
export interface ReviewRow extends MergeReviewField {
  editedSince: boolean;
}

/** Per-field actions of the automatic-merge review. */
export const ReviewItemActions = defineItemActions<ReviewRow>();

/**
 * What a field action needs beyond its row: how to send a choice, and which
 * choice is in flight. The review provides it around its table.
 */
export interface ReviewActionContext {
  resolve: (field: string, choice: MergeFieldChoice) => void;
  pending: { field: string; choice: MergeFieldChoice } | null;
}

export const ReviewActionContext = createContext<ReviewActionContext | null>(
  null,
);

function useReviewAction(): ReviewActionContext {
  const ctx = useContext(ReviewActionContext);
  if (ctx === null) {
    throw new Error(
      "an automatic-merge review action rendered outside the review table",
    );
  }
  return ctx;
}

const EDITED_SINCE =
  "You changed this field since the merge; a review choice would discard that change.";

function ChoiceButton({
  row,
  choice,
  label,
  offWhen,
}: {
  row: ReviewRow;
  choice: MergeFieldChoice;
  label: string;
  /** Why the choice would change nothing (or cannot apply), when it would not. */
  offWhen: string | null;
}): ReactElement {
  const { resolve, pending } = useReviewAction();
  const why = row.editedSince ? EDITED_SINCE : offWhen;
  const mine = pending?.field === row.key && pending.choice === choice;
  return (
    <Button
      variant="ghost"
      // One choice at a time: the review answers a refusal by its field.
      disabled={why !== null || (pending !== null && !mine)}
      tooltip={why ?? undefined}
      loading={mine}
      onClick={(e) => {
        e.stopPropagation();
        resolve(row.key, choice);
      }}
    >
      {label}
    </Button>
  );
}

/** Keep — the merge's decision on this field is right. */
export function KeepFieldAction({
  row,
}: ItemActionProps<ReviewRow>): ReactElement {
  return <ChoiceButton row={row} choice="keep" label="Keep" offWhen={null} />;
}

/** Use mine — the field goes back to the user's pre-merge value. */
export function UseMineFieldAction({
  row,
}: ItemActionProps<ReviewRow>): ReactElement {
  const offWhen =
    row.outcome === "removed"
      ? "The update removed this field; your value no longer applies."
      : sameFieldValue(row.result, row.yours)
        ? "The result already holds your value."
        : null;
  return (
    <ChoiceButton row={row} choice="mine" label="Use mine" offWhen={offWhen} />
  );
}

/** Use new default — the field takes the update's new default. */
export function UseNewDefaultFieldAction({
  row,
}: ItemActionProps<ReviewRow>): ReactElement {
  const offWhen = sameFieldValue(row.result, row.theirs)
    ? "The result already holds the new default."
    : null;
  return (
    <ChoiceButton
      row={row}
      choice="new-default"
      label="Use new default"
      offWhen={offWhen}
    />
  );
}
