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
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { RelativeTime } from "@plugins/primitives/plugins/relative-time/web";
import {
  decisionExchanges,
  decisionsList,
  type DecisionExchangeRow,
  type DecisionOption,
  type DecisionRow,
} from "../../core";
import { NewMark } from "./decision-state";
import { decisionPresentation } from "../internal/presentation";

/**
 * One decision in full — what every surface (the inbox's detail, later the
 * conversation tray and the page block) draws: its label, state pill, new
 * mark, lineage and time; the question; the outcome (or "Split into …") once
 * closed; the markdown body; the options, one sentence each, the recommended
 * one marked; and its thread — the latest exchange shown, the earlier ones
 * folded. Read-only: answering is the SubmitBar's (phase 3).
 */
export function DecisionCard({
  decision,
  seenBefore,
}: {
  decision: DecisionRow;
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
          <Text variant="code" tone="muted">
            {decision.label}
          </Text>
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
        <Text as="h2" variant="heading">
          {decision.question}
        </Text>
        <Outcome decision={decision} />
        {decision.body.trim() !== "" ? (
          <Markdown>{decision.body}</Markdown>
        ) : null}
        {decision.options.length > 0 ? (
          <Options options={decision.options} />
        ) : null}
        <Thread key={decision.id} decision={decision} seenBefore={seenBefore} />
        {decision.state !== "closed" && decision.unconsumedAnswers > 0 ? (
          <Text variant="caption" tone="muted">
            {`Sent to ${decision.taskTitle}. Waiting for it to act on your answer.`}
          </Text>
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

/** A closed decision's outcome, and the decisions split from it (derived from their `from`). */
function Outcome({ decision }: { decision: DecisionRow }): ReactElement | null {
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
  if (decision.outcome === null && splitLine === null) return null;
  return (
    <Stack gap="2xs">
      {decision.outcome !== null ? (
        <Text variant="label">{decision.outcome}</Text>
      ) : null}
      {splitLine}
    </Stack>
  );
}

/** The options, one sentence each; the recommended one says so, quietly. */
function Options({
  options,
}: {
  options: readonly DecisionOption[];
}): ReactElement {
  return (
    <Stack gap="xs">
      {options.map((o) => (
        <Stack key={o.key} direction="row" gap="sm" align="start">
          <Badge mono>{o.key}</Badge>
          <Fill>
            <Text>{o.text}</Text>
          </Fill>
          {o.recommended ? (
            <Text variant="caption" tone="muted">
              Recommended
            </Text>
          ) : null}
        </Stack>
      ))}
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
