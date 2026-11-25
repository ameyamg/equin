import { useState, type ReactElement } from "react";
import { rowOrStale, useLive } from "@plugins/network/plugins/live/web";
import { ResourceErrorInline } from "@plugins/network/plugins/live/plugins/live-state/web";
import { Markdown } from "@plugins/primitives/plugins/markdown/web";
import { Badge } from "@plugins/primitives/plugins/css/plugins/badge/web";
import { Card } from "@plugins/primitives/plugins/css/plugins/card/web";
import {
  selfClass,
  Stack,
} from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { foldResource } from "@plugins/network/plugins/live/plugins/live-state/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Button } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Row } from "@plugins/primitives/plugins/css/plugins/row/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { RelativeTime } from "@plugins/primitives/plugins/relative-time/web";
import { Textarea } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import {
  keptField,
  type KeptPart,
} from "@plugins/primitives/plugins/kept-state/core";
import {
  decisionAgentFinished,
  decisionExchanges,
  decisionsList,
  type DecisionExchangeRow,
  type DecisionOption,
  type DecisionRow,
} from "../../core";
import { NewMark } from "./decision-state";
import { decisionPresentation } from "../internal/presentation";
import { isAnswerable, type DecisionDraft } from "../internal/drafts";

/**
 * One decision in full — what every surface (the inbox's detail, later the
 * conversation tray and the page block) draws: its label, state pill, new
 * mark, lineage and time; the question; the outcome (or "Split into …") once
 * closed; the markdown body; the options, one sentence each, the recommended
 * one marked; and its thread — the latest exchange shown, the earlier ones
 * folded. Given its `draft`, it is answered in place: the options pick (and
 * unpick), a note goes with the pick or asks a question, an FYI takes "Got
 * it" — all drafts until the SubmitBar sends them.
 *
 * `under`: what the row this card expands beneath already prints beside the
 * decision's label — `"question"` (an open row) or `"outcome"` (a closed
 * row). The card then leaves out the label and that line, so the row is its
 * heading; `null` for a card that stands on its own (the inbox's detail).
 */
export function DecisionCard({
  decision,
  seenBefore,
  draft,
  under,
}: {
  decision: DecisionRow;
  under: "question" | "outcome" | null;
  /** The decision's drafted answer (`useDecisionDrafts().part(id)`); absent: read-only. */
  draft?: KeptPart<DecisionDraft>;
  /**
   * What the new marks compare against: when the user last saw it BEFORE this
   * showing. A surface that marks the decision seen on open passes the
   * `seenAt` it read when it opened, so what was new stays marked while shown.
   */
  seenBefore: Date | null;
}): ReactElement {
  const presentation = decisionPresentation(decision);
  const isNew =
    seenBefore === null ||
    (decision.latestAgentAt !== null && decision.latestAgentAt > seenBefore);
  return (
    <Card>
      <Stack gap="md">
        <Stack direction="row" gap="sm" align="center" wrap>
          {under === null ? (
            <Text variant="code" tone="muted">
              {decision.label}
            </Text>
          ) : null}
          <Badge variant={presentation.variant} shape="pill">
            {presentation.label}
          </Badge>
          {isNew ? <NewMark /> : null}
          {decision.fromDecisionId !== null ? (
            <FromLabel decisionId={decision.fromDecisionId} />
          ) : null}
          <Text variant="caption" tone="muted">
            <RelativeTime date={decision.openedAt} />
          </Text>
        </Stack>
        {under === "question" ? null : (
          <Text as="h2" variant="heading">
            {decision.question}
          </Text>
        )}
        <Outcome decision={decision} showOutcome={under !== "outcome"} />
        {decision.body.trim() !== "" ? (
          <Markdown>{decision.body}</Markdown>
        ) : null}
        {decision.options.length > 0 ? (
          <Options
            options={decision.options}
            draft={draft !== undefined && isAnswerable(decision) ? draft : null}
          />
        ) : null}
        <Thread key={decision.id} decision={decision} seenBefore={seenBefore} />
        {decision.state !== "closed" && decision.unconsumedAnswers > 0 ? (
          <Text variant="caption" tone="muted">
            {`Sent to ${decision.taskTitle}. Waiting for it to act on your answer.`}
          </Text>
        ) : null}
        {draft !== undefined && isAnswerable(decision) ? (
          <Answer decision={decision} draft={draft} />
        ) : null}
      </Stack>
    </Card>
  );
}

/** The decision this one comes from, by its label once read. */
function FromLabel({ decisionId }: { decisionId: string }): ReactElement {
  const from = rowOrStale(useLive(decisionsList, { id: decisionId }));
  return (
    <Text variant="caption" tone="muted">
      {from === undefined ? "from another decision" : `from ${from.label}`}
    </Text>
  );
}

/** How many decisions split from one the card names. */
const SPLIT_SHOWN = 20;

/**
 * A closed decision's outcome (unless its row already prints it), and the
 * decisions split from it (derived from their `from`).
 */
function Outcome({
  decision,
  showOutcome,
}: {
  decision: DecisionRow;
  showOutcome: boolean;
}): ReactElement | null {
  const split = useLive(decisionsList, {
    where: { fromDecisionId: decision.id },
    limit: SPLIT_SHOWN,
  });
  // "Split into" is an addition to the outcome: nothing while it loads.
  const splitLine = foldResource(split, {
    loading: () => null,
    error: (error) => (
      <ResourceErrorInline
        variant="inline"
        subject="the decisions split from it"
        error={error}
        refetch={split.refetch}
      />
    ),
    ready: (rows) =>
      rows.length === 0 ? null : (
        <Text variant="caption" tone="muted">
          {`Split into ${rows.map((d) => d.label).join(", ")}${split.status === "ready" && split.canGrow ? ", and more" : ""}`}
        </Text>
      ),
  });
  const outcome = showOutcome ? decision.outcome : null;
  if (outcome === null && splitLine === null) return null;
  return (
    <Stack gap="2xs">
      {outcome !== null ? <Text variant="label">{outcome}</Text> : null}
      {splitLine}
    </Stack>
  );
}

/**
 * The options, one sentence each; the recommended one says so, quietly. With
 * a draft each is a pick (a second press unpicks it), the chosen one marked
 * "Your pick".
 */
function Options({
  options,
  draft,
}: {
  options: readonly DecisionOption[];
  draft: KeptPart<DecisionDraft> | null;
}): ReactElement {
  return (
    <Stack gap="xs">
      {/* eslint-disable-next-line data-view/no-adhoc-row-list -- a decision's options are a choice control (one pick), not a list of records */}
      {options.map((o, i) => {
        const picked = draft !== null && draft.value.pick === o.key;
        const mark = picked ? (
          <Text variant="caption">Your pick</Text>
        ) : o.recommended ? (
          <Text variant="caption" tone="muted">
            Recommended
          </Text>
        ) : null;
        if (draft === null)
          return (
            <Stack key={o.key} direction="row" gap="sm" align="start">
              <Badge mono>{o.key}</Badge>
              <Fill>
                <Text>{o.text}</Text>
              </Fill>
              {mark}
            </Stack>
          );
        return (
          <Row
            key={o.key}
            selected={picked}
            aria-pressed={picked}
            aria-label={
              i < 9 ? `Pick ${o.key} (key ${i + 1})` : `Pick ${o.key}`
            }
            icon={
              <Badge mono variant={picked ? "primary" : "muted"}>
                {o.key}
              </Badge>
            }
            onClick={() =>
              draft.set((d) => ({ ...d, pick: picked ? null : o.key }))
            }
          >
            <Stack direction="row" gap="sm" align="start">
              <Fill>
                <Text>{o.text}</Text>
              </Fill>
              {mark}
            </Stack>
          </Row>
        );
      })}
    </Stack>
  );
}

/**
 * The answer box: the note (with a pick, or a question without one), "Got
 * it" on an FYI, "Close" on a finished agent's decision, and what the last
 * Submit said when it did not take it. A finished agent is said up front: its
 * answer is kept here, never sent.
 */
function Answer({
  decision,
  draft,
}: {
  decision: DecisionRow;
  draft: KeptPart<DecisionDraft>;
}): ReactElement {
  const agent = useLive(decisionAgentFinished, { taskId: decision.taskId });
  // Said once known; a failed read says so instead.
  const agentLine = foldResource(agent, {
    loading: (): ReactElement | null => null,
    error: (error) => (
      <Text variant="caption" tone="destructive">
        {`Could not read whether its agent has finished: ${error.message}`}
      </Text>
    ),
    unavailable: (message) => (
      <Text variant="caption" tone="muted">
        {message}
      </Text>
    ),
    ready: (done) =>
      done ? (
        <Text variant="caption" tone="muted">
          {`${decision.taskTitle} has finished — your answer will be kept here, not sent.`}
        </Text>
      ) : null,
  });
  const finished = foldResource(agent, {
    loading: () => false,
    error: () => false,
    unavailable: () => false,
    ready: (done) => done,
  });
  const d = draft.value;
  const canClose = decision.state === "fyi" || finished;
  return (
    <Stack gap="xs">
      {agentLine}
      <Textarea
        keep={keptField(draft, "note")}
        rows={2}
        fitContent
        placeholder={
          decision.state === "fyi"
            ? "Ask about this…"
            : "Add a note, or ask a question…"
        }
        aria-label="Your note"
      />
      {canClose || d.close ? (
        <Stack direction="row" gap="sm" align="center">
          <Button
            variant={d.close ? "secondary" : "ghost"}
            aria-pressed={d.close}
            className={selfClass("start")}
            onClick={() => draft.set((p) => ({ ...p, close: !p.close }))}
          >
            {decision.state === "fyi" ? "Got it" : "Close without answering"}
          </Button>
          {d.close ? (
            <Text variant="caption" tone="muted">
              {d.note.trim() === ""
                ? "Closes it on Submit, without telling the agent."
                : "Closes it on Submit; your note is kept here, not sent to the agent."}
            </Text>
          ) : null}
        </Stack>
      ) : null}
      {d.refused !== null ? (
        <Text variant="caption" tone="destructive">
          {`Not taken: ${d.refused}`}
        </Text>
      ) : null}
    </Stack>
  );
}

/** The thread, oldest first: the latest exchange shown, the earlier ones behind one toggle. */
function Thread({
  decision,
  seenBefore,
}: {
  decision: DecisionRow;
  seenBefore: Date | null;
}): ReactElement | null {
  const thread = useLive(decisionExchanges, {
    where: { decisionId: decision.id },
  });
  const [showAll, setShowAll] = useState(false);
  if (thread.status === "loading") return <Loading variant="rows" count={1} />;
  if (thread.status === "error")
    return (
      <ResourceErrorInline
        variant="inline"
        subject="the decision's thread"
        error={thread.error}
        refetch={thread.refetch}
      />
    );
  const exchanges = thread.data;
  if (exchanges.length === 0) return null;
  const shown = showAll ? exchanges : exchanges.slice(-1);
  const earlier = exchanges.length - shown.length;
  return (
    <Stack gap="sm">
      {earlier > 0 ? (
        <Button
          variant="ghost"
          className={selfClass("start")}
          onClick={() => setShowAll(true)}
        >
          {earlier === 1
            ? "1 earlier exchange"
            : `${earlier} earlier exchanges`}
        </Button>
      ) : null}
      {shown.map((e) => (
        <Exchange key={e.id} exchange={e} seenBefore={seenBefore} />
      ))}
    </Stack>
  );
}

/** What the user said in an exchange (their pick, their note) — or null for an agent note. */
function userLine(e: DecisionExchangeRow): string | null {
  switch (e.kind) {
    case "answer": {
      // The record's own rule (an answer is a pick): a row without one is a broken write.
      if (e.pick === null)
        throw new Error(`decision exchange ${e.id}: an answer without a pick`);
      return e.userText === null
        ? `You picked ${e.pick}`
        : `You picked ${e.pick}: ${e.userText}`;
    }
    case "recorded":
      return e.pick === null
        ? `You wrote (not sent): ${e.userText ?? ""}`
        : `You picked ${e.pick} (not sent)${e.userText === null ? "" : `: ${e.userText}`}`;
    case "question":
      return `You asked: ${e.userText ?? ""}`;
    case "update":
      return null;
  }
}

/** One exchange: the user's side, then the agent's reply or note — marked new when the user has not seen it. */
function Exchange({
  exchange: e,
  seenBefore,
}: {
  exchange: DecisionExchangeRow;
  seenBefore: Date | null;
}): ReactElement {
  const user = userLine(e);
  const unseen =
    e.agentAt !== null && (seenBefore === null || e.agentAt > seenBefore);
  return (
    <Card>
      <Stack gap="xs">
        <Stack direction="row" gap="sm" align="center">
          <Text variant="caption" tone="muted">
            {user === null ? "Update" : "You"}
          </Text>
          <Text variant="caption" tone="muted">
            <RelativeTime date={e.agentAt ?? e.createdAt} />
          </Text>
          {unseen ? <NewMark /> : null}
        </Stack>
        {user !== null ? <Text variant="label">{user}</Text> : null}
        {e.agentText !== null ? (
          <Markdown>{e.agentText}</Markdown>
        ) : e.kind === "question" ? (
          <Text variant="caption" tone="muted">
            Waiting for an answer.
          </Text>
        ) : null}
      </Stack>
    </Card>
  );
}
