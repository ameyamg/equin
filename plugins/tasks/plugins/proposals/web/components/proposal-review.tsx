import { useState, type ReactNode } from "react";
import type { FieldsRecord } from "@plugins/fields/core";
import { FieldsForm } from "@plugins/config_v2/plugins/fields/web";
import { useEndpointMutation } from "@plugins/infra/plugins/endpoints/web";
import { Badge } from "@plugins/primitives/plugins/css/plugins/badge/web";
import { Card } from "@plugins/primitives/plugins/css/plugins/card/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { Grid } from "@plugins/primitives/plugins/css/plugins/grid/web";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import {
  Button,
  Textarea,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { InlineText } from "@plugins/primitives/plugins/inline-text/web";
import { RelativeTime } from "@plugins/primitives/plugins/relative-time/web";
import { transient } from "@plugins/primitives/plugins/kept-state/core";
import { useToast } from "@plugins/shell/plugins/notifications/web";
import {
  decideProposal,
  PROPOSAL_NOTE_MAX,
  type DecideProposalBody,
  PROPOSAL_STATE_META,
  type ProposalDelivery,
  type ProposalRow,
  type ProposalState,
} from "../../core";

/** Main's record as the owner reads it now: its values and their version. */
export interface ProposalCurrent {
  readonly values: Readonly<Record<string, unknown>>;
  readonly version: string;
}

export interface ProposalReviewProps {
  proposal: ProposalRow;
  /** The record's fields — the owner's (a feed's declaration). */
  fields: FieldsRecord;
  /** Main's record now; null for a proposed new record. */
  current: ProposalCurrent | null;
  /**
   * Draws one version of the record as the place it is shown draws it (a tip
   * as the site draws it). Null: the review lists the changed fields.
   */
  renderPreview:
    ((values: Readonly<Record<string, unknown>>) => ReactNode) | null;
  /** What the "now" side is called ("On the site now"). */
  nowLabel?: string;
  /**
   * The user decided: an accepted or rejected proposal leaves the open list
   * (and this review with it) — the owner opens what it wants next (an
   * accepted new record).
   */
  onDecided?: (state: ProposalState) => void;
}

type Mode = "idle" | "edit" | "request";

const DELIVERY_WORDS: Record<ProposalDelivery, string> = {
  delivered: "The agent was told.",
  finished: "The agent had already finished: it was not told.",
  "no-agent": "No agent ran on its task: nobody was told.",
  blocked: "The agent could not be resumed: it was not told.",
};

/**
 * An agent's proposal, reviewed where its record is shown: who proposed it
 * and why, what it changes, the record now beside the record after accepting
 * (drawn by the owner), and the answers — Accept, Edit then accept (the
 * owner's own form over a copy), Request changes (a note the agent gets),
 * Reject.
 */
export function ProposalReview({
  proposal,
  fields,
  current,
  renderPreview,
  nowLabel = "Now",
  onDecided,
}: ProposalReviewProps): ReactNode {
  const decide = useEndpointMutation(decideProposal);
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("idle");
  const proposed = afterAccepting(proposal, current);
  const [draft, setDraft] = useState<Record<string, unknown>>(proposed);
  // The keys the user edited in their copy: with the proposal's own, the
  // only keys an accept with edits writes (never one read before a newer edit).
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [note, setNote] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);

  const meta = PROPOSAL_STATE_META[proposal.state];
  const labels = proposal.changed.map((k) => fields[k]?.meta?.label ?? k);
  const movedSince =
    current !== null &&
    proposal.baseVersion !== null &&
    current.version !== proposal.baseVersion;
  const shown = mode === "edit" ? draft : proposed;

  const send = async (body: DecideProposalBody) => {
    if (decide.kind !== "available") return;
    const res = await decide.mutateAsync({ params: { id: proposal.id }, body });
    if (res.kind === "refused") {
      setRefusal(res.message);
      return;
    }
    setRefusal(null);
    setMode("idle");
    // A toast, not a line here: an accepted or rejected proposal leaves the
    // open list, and this review with it.
    toast({
      type: "proposal-decided",
      title:
        res.kind === "decided"
          ? `${PROPOSAL_STATE_META[res.state].label}: ${proposal.note.split(/\r?\n/, 1)[0]}`
          : `Already ${PROPOSAL_STATE_META[res.state].label.toLowerCase()}`,
      description: res.kind === "decided" ? DELIVERY_WORDS[res.delivery] : "",
      category: "confirmations",
      subjectId: proposal.authorTaskId,
    });
    onDecided?.(res.state);
  };
  const editedCopy = () =>
    Object.fromEntries(
      [...new Set([...proposal.changed, ...touched])].map((k) => [k, draft[k]]),
    );

  return (
    <Card>
      <Stack gap="md">
        <Line>
          <Badge variant={meta.variant}>{meta.label}</Badge>
          <Text variant="label">
            {proposal.isNew ? "New, proposed by" : "Proposed by"}
          </Text>
          <InlineText text={proposal.authorTaskId} />
          <Text tone="muted">
            · <RelativeTime date={proposal.createdAt} />
            {proposal.revision > 1 ? ` · v${proposal.revision}` : ""}
          </Text>
        </Line>
        <Text as="p" variant="body" className="whitespace-pre-line">
          {proposal.note}
        </Text>
        <Text variant="caption" tone="muted">
          {proposal.isNew ? "Sets " : "Changes "}
          {labels.join(", ")}
        </Text>
        {proposal.editedOnMainSinceFork && (
          <Text variant="caption" tone="destructive">
            This was edited here after the agent started: check that the changed
            fields do not undo your own edits.
          </Text>
        )}
        {movedSince && (
          <Text variant="caption" tone="destructive">
            Edited here since it was proposed: accepting writes only the fields
            it changes.
          </Text>
        )}
        {proposal.state === "changes-requested" && (
          <Text variant="caption" tone="muted">
            You asked: “{proposal.decisionNote}”. The agent is revising; its
            next version replaces this one.
          </Text>
        )}

        <Grid minCellWidth="18rem" mode="fit">
          {current !== null && (
            <Stack gap="sm">
              <Text variant="eyebrow" tone="muted">
                {nowLabel}
              </Text>
              {renderPreview === null ? (
                <FieldValues
                  fields={fields}
                  values={current.values}
                  keys={proposal.changed}
                />
              ) : (
                renderPreview(current.values)
              )}
            </Stack>
          )}
          <Stack gap="sm">
            <Text variant="eyebrow" tone="muted">
              {mode === "edit"
                ? "After accepting, with your edits"
                : "After accepting"}
            </Text>
            {renderPreview === null ? (
              <FieldValues
                fields={fields}
                values={shown}
                keys={proposal.changed}
              />
            ) : (
              renderPreview(shown)
            )}
          </Stack>
        </Grid>

        {mode === "edit" && (
          <FieldsForm
            fields={fields}
            values={draft}
            onChange={(key, value) => {
              setDraft((d) => ({ ...d, [key]: value }));
              setTouched((t) => new Set(t).add(key));
            }}
          />
        )}
        {mode === "request" && (
          <Textarea
            keep={transient(
              "a change request is a sentence typed and sent at once; it is not kept across a reload",
            )}
            autoFocus
            value={note}
            maxLength={PROPOSAL_NOTE_MAX}
            placeholder="What should change?"
            onChange={(e) => setNote(e.target.value)}
          />
        )}

        <Line>
          {decide.kind === "unavailable" ? (
            <Text variant="caption" tone="muted">
              {decide.message}
            </Text>
          ) : mode === "idle" ? (
            <>
              <Button
                variant="default"
                onClick={() => send({ decision: "accept" })}
              >
                Accept
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setDraft(proposed);
                  setTouched(new Set());
                  setMode("edit");
                }}
              >
                Edit then accept
              </Button>
              <Button variant="outline" onClick={() => setMode("request")}>
                Request changes
              </Button>
              <Fill />
              <Button
                variant="ghost"
                onClick={() => send({ decision: "reject" })}
              >
                Reject
              </Button>
            </>
          ) : mode === "edit" ? (
            <>
              <Button
                variant="default"
                onClick={() =>
                  send({ decision: "accept", values: editedCopy() })
                }
              >
                Accept with my edits
              </Button>
              <Fill />
              <Button variant="ghost" onClick={() => setMode("idle")}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="default"
                disabled={note.trim() === ""}
                onClick={() =>
                  send({ decision: "request-changes", note: note.trim() })
                }
              >
                Send to the agent
              </Button>
              <Fill />
              <Button variant="ghost" onClick={() => setMode("idle")}>
                Cancel
              </Button>
            </>
          )}
        </Line>
        {refusal !== null && (
          <Text as="p" variant="caption" tone="destructive">
            {refusal}
          </Text>
        )}
      </Stack>
    </Card>
  );
}

/**
 * The record as an accept leaves it: main's record with the keys the
 * proposal changes taken from it (what the server writes), or the proposed
 * record whole for a new one.
 */
function afterAccepting(
  proposal: ProposalRow,
  current: ProposalCurrent | null,
): Record<string, unknown> {
  if (current === null) return { ...proposal.values };
  const next: Record<string, unknown> = { ...current.values };
  for (const k of proposal.changed) next[k] = proposal.values[k];
  return next;
}

/** The changed fields as text, for an owner with no preview. */
function FieldValues({
  fields,
  values,
  keys,
}: {
  fields: FieldsRecord;
  values: Readonly<Record<string, unknown>>;
  keys: readonly string[];
}): ReactNode {
  return (
    <Stack gap="sm">
      {keys.map((k) => (
        <Stack key={k} gap="xs">
          <Text variant="caption" tone="muted">
            {fields[k]?.meta?.label ?? k}
          </Text>
          <Text as="p" variant="body" className="whitespace-pre-line">
            {typeof values[k] === "string"
              ? (values[k] as string)
              : JSON.stringify(values[k], null, 2)}
          </Text>
        </Stack>
      ))}
    </Stack>
  );
}
