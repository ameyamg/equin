import { useMemo, useState } from "react";
import {
  EndpointError,
  getEndpointErrorMessage,
  useEndpointMutation,
} from "@plugins/infra/plugins/endpoints/web";
import {
  mergeReviewFields,
  type MergeFieldChoice,
  type MergeFieldOutcome,
} from "@plugins/config_v2/core";
import {
  DataView,
  defineDataView,
  type FieldDef,
} from "@plugins/primitives/plugins/data-view/web";
import { Button, cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { rigidClass } from "@plugins/primitives/plugins/css/plugins/rigid/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { yieldClass } from "@plugins/primitives/plugins/css/plugins/yield/web";
import { Scroll } from "@plugins/primitives/plugins/css/plugins/scroll/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { RelativeTime } from "@plugins/primitives/plugins/relative-time/web";
import { DeveloperMark } from "@plugins/audience/plugins/developer-mark/web";
import { useToast } from "@plugins/shell/plugins/notifications/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import {
  acknowledgeAutoMerge,
  placementNotes,
  placementSummary,
  resolveAutoMergeField,
  undoAutoMerge,
  type AutoMergeStateView,
} from "../../core";
import { useAnnounceRefused } from "./undo-refused";
import {
  ReviewActionContext,
  ReviewItemActions,
  type ReviewRow,
} from "./review-actions";

const REVIEW_VIEW = defineDataView("config_v2.auto-merge.review");
const mergeIcon = symbol("merge");
const ACTION_CLASS = cn("bg-info/20 hover:bg-info/30");

const OUTCOMES: { value: MergeFieldOutcome; label: string }[] = [
  { value: "took-new", label: "Took new default" },
  { value: "kept-yours", label: "Kept yours" },
  { value: "same-change", label: "Same change" },
  { value: "yours-won", label: "Yours won" },
  { value: "combined", label: "Combined" },
  { value: "removed", label: "Removed" },
  { value: "renamed", label: "Renamed" },
  { value: "carried", label: "Carried from old key" },
];

/** Why the merge decided what it did, per outcome — the outcome cell's title. */
const OUTCOME_REASON: Record<MergeFieldOutcome, string> = {
  "took-new": "Only the update changed it, so the new default is taken.",
  "kept-yours": "Only you changed it, so your value is kept.",
  "same-change": "You and the update changed it the same way.",
  "yours-won": "You and the update changed it differently; your value is kept.",
  combined:
    "You and the update both changed it; the merge combined the two below the field.",
  removed:
    "The update removed this field; your value no longer applies and was dropped.",
  renamed: "The update renamed this field; your value moved to its new key.",
  carried:
    "The update renamed a field you changed to this key; your value was carried over.",
};

const NOTE_LABEL: Record<ReviewRow["notes"][number]["kind"], string> = {
  "yours-won": "yours won at",
  "removed-dropped": "dropped",
  "removed-renamed": "moved",
};

type ReviewState = "none" | MergeFieldChoice | "edited";
const REVIEW_STATES: { value: ReviewState; label: string }[] = [
  { value: "none", label: "Not reviewed" },
  { value: "keep", label: "Kept" },
  { value: "mine", label: "Used mine" },
  { value: "new-default", label: "Used new default" },
  { value: "edited", label: "Edited since" },
];

function shown(value: unknown): string {
  if (value === undefined) return "—";
  const text = JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

function valueCell(value: unknown) {
  return (
    <Text
      variant="code"
      title={value === undefined ? "absent" : JSON.stringify(value, null, 2)}
    >
      {shown(value)}
    </Text>
  );
}

const FIELDS: FieldDef<ReviewRow>[] = [
  {
    id: "key",
    label: "Field",
    primary: true,
    value: (r) => r.key,
    cell: (r) => (
      <Stack gap="2xs">
        <Text variant="code">{r.key}</Text>
        {r.notes.map((n) => (
          <Text key={`${n.kind}:${n.at}`} variant="caption" tone="muted">
            {NOTE_LABEL[n.kind]} {n.at}
          </Text>
        ))}
        {r.placement.map((text) => (
          <Text key={text} variant="caption" tone="muted">
            {text}
          </Text>
        ))}
      </Stack>
    ),
  },
  {
    id: "base",
    label: "Old default",
    value: (r) => shown(r.base),
    cell: (r) => valueCell(r.base),
  },
  {
    id: "yours",
    label: "Yours",
    value: (r) => shown(r.yours),
    cell: (r) => valueCell(r.yours),
  },
  {
    id: "theirs",
    label: "New default",
    value: (r) => shown(r.theirs),
    cell: (r) => valueCell(r.theirs),
  },
  {
    id: "result",
    label: "Result",
    value: (r) => shown(r.result),
    cell: (r) => valueCell(r.result),
  },
  {
    id: "outcome",
    label: "Outcome",
    type: "enum",
    options: OUTCOMES,
    value: (r) => r.outcome,
    cell: (r) => (
      <Text title={OUTCOME_REASON[r.outcome]}>
        {OUTCOMES.find((o) => o.value === r.outcome)?.label}
      </Text>
    ),
  },
  {
    id: "review",
    label: "Review",
    type: "enum",
    options: REVIEW_STATES,
    value: (r): ReviewState =>
      r.editedSince ? "edited" : (r.resolution?.choice ?? "none"),
  },
];

/**
 * The developer's review of one config's automatic merge, above its fields in
 * Settings → Config: when it merged and where it stands, Undo merge (the
 * normal conflict back) and Mark reviewed, then every field the merge touched
 * as a table — the old default, your value, the new default and the result,
 * the outcome and why (its title), the review choice so far — each with Keep,
 * Use mine and Use new default.
 *
 * Shown for a current merge and one the user edited since (whose edited
 * fields refuse a choice); nothing once undone or superseded.
 */
export function AutoMergeReview({
  storePath,
  scopeId,
  state,
}: {
  storePath: string;
  scopeId: string | undefined;
  state: NonNullable<AutoMergeStateView>;
}) {
  const { record, status, editedFields } = state;
  const target = { storePath, ...(scopeId ? { scopeId } : {}) };
  const toast = useToast();
  const announceRefused = useAnnounceRefused();
  const undo = useEndpointMutation(undoAutoMerge, {
    onSuccess: ({ refused }) => announceRefused(refused),
  });
  const ack = useEndpointMutation(acknowledgeAutoMerge);
  const [pending, setPending] = useState<{
    field: string;
    choice: MergeFieldChoice;
  } | null>(null);
  // Refusals are answered here, naming the field (the global toast cannot).
  const resolve = useEndpointMutation(resolveAutoMergeField, {
    meta: { suppressError: true },
  });
  const resolveMutateAsync = resolve.mutateAsync;

  const rows = useMemo<ReviewRow[]>(() => {
    const placed = placementNotes(record.placement);
    return mergeReviewFields(record).map((f) => ({
      ...f,
      editedSince: editedFields.includes(f.key),
      placement: placed.filter((p) => p.field === f.key).map((p) => p.text),
    }));
  }, [record, editedFields]);
  const placement = placementSummary(record.placement);
  const actions = useMemo<ReviewActionContext>(
    () => ({
      pending,
      resolve: (field, choice) => {
        setPending({ field, choice });
        void resolveMutateAsync({
          body: {
            storePath,
            ...(scopeId ? { scopeId } : {}),
            recordId: record.id,
            field,
            choice,
          },
        })
          .catch((err: unknown) => {
            if (!(err instanceof EndpointError)) throw err;
            toast({
              type: "config-auto-merge-review",
              category: "other",
              title: `Review choice on "${field}" refused`,
              description: getEndpointErrorMessage(err),
              variant: "error",
            });
          })
          .finally(() => setPending(null));
      },
    }),
    [pending, resolveMutateAsync, toast, storePath, scopeId, record.id],
  );
  const reviewed = record.acknowledgedAt !== undefined;

  return (
    <Stack
      gap="sm"
      // Gives below the table's content width: the table scrolls inside it
      // instead of pushing the detail pane wider.
      className={cn(
        "rounded-md border border-info/30 bg-info/5 px-md py-sm",
        yieldClass("x"),
      )}
    >
      <Stack direction="row" gap="sm" align="center" wrap>
        <Icon
          icon={mergeIcon}
          className={cn("size-4 text-info", rigidClass())}
        />
        <Fill as="span">
          <Text variant="body">
            Auto-merged <RelativeTime date={new Date(record.mergedAt)} /> ·{" "}
            {rows.length} field{rows.length === 1 ? "" : "s"} touched
            {status === "edited" && " · edited since"}
            {reviewed && " · reviewed"}
          </Text>{" "}
          <DeveloperMark />
        </Fill>
        <Button
          variant="ghost"
          className={ACTION_CLASS}
          loading={undo.isPending}
          disabled={status !== "current"}
          tooltip={
            status === "current"
              ? "Put the pre-merge override back: the config is a conflict again."
              : "You changed this config since the merge; Undo would discard that change."
          }
          onClick={() => undo.mutate({ body: { targets: [target] } })}
        >
          Undo merge
        </Button>
        {!reviewed && (
          <Button
            variant="ghost"
            className={ACTION_CLASS}
            loading={ack.isPending}
            onClick={() =>
              ack.mutate({ body: { ...target, recordId: record.id } })
            }
          >
            Mark reviewed
          </Button>
        )}
      </Stack>
      {placement !== null && (
        <Text variant="caption" tone="muted">
          {placement}
        </Text>
      )}
      <ReviewActionContext.Provider value={actions}>
        <Scroll axis="x">
          <DataView<ReviewRow>
            storageKey={REVIEW_VIEW}
            rows={rows}
            fields={FIELDS}
            rowKey={(r) => r.key}
            views={["table"]}
            density="compact"
            searchAccessor={(r) => r.key}
            itemActions={ReviewItemActions}
            emptyState="The merge changed no field."
          />
        </Scroll>
      </ReviewActionContext.Provider>
    </Stack>
  );
}
