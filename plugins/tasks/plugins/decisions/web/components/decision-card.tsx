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
import { ComposerField } from "@plugins/primitives/plugins/text-editor/plugins/composer/web";
import {
  UserMessageCard,
  UserMessageText,
} from "@plugins/conversations/plugins/conversation-view/plugins/user-message/web";
import { rowAction } from "@plugins/conversations/plugins/conversation-view/plugins/jsonl-viewer/plugins/row-actions/web";
import {
  RowActions,
  rowActionsAnchor,
} from "@plugins/primitives/plugins/row-actions/web";
import {
  keptField,
  type KeptPart,
} from "@plugins/primitives/plugins/kept-state/core";
import {
  decisionAgent,
  decisionExchanges,
  decisionsList,
  type DecisionExchangeRow,
  type DecisionOption,
  type DecisionRow,
} from "../../core";
import { NewMark } from "./decision-state";
import {
  decisionPresentation,
  type DecisionPresentation,
} from "../internal/presentation";
import {
  PastVersion,
  useDecisionVersions,
  VersionNav,
} from "./decision-versions";
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
 * Once edited, its header steps through its versions (`‹ n / N ›`): a past
 * one shows what the decision said then, read-only, with the thread as it is
 * now.
 *
 * `under`: what the row this card expands beneath already prints beside the
 * decision's label — `"question"` (an open row) or `"outcome"` (a closed
 * row). The card then leaves out the label and that line and draws no box of
 * its own — the row's frame is its box (the list's `frame: "fold"`), so the
 * row is its heading; `null` for a card that stands on its own (the inbox's
 * detail).
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
  const versions = useDecisionVersions(decision.id);
  // The past version shown, null for what the decision says now. Kept per
  // showing: a card opened again starts on the current version.
  const [viewing, setViewing] = useState<string | null>(null);
  const presentation = decisionPresentation(decision);
  const isNew =
    seenBefore === null ||
    (decision.latestAgentAt !== null && decision.latestAgentAt > seenBefore);
  const header = (pill: DecisionPresentation, newMark: boolean) => (
    <Stack direction="row" gap="sm" align="center" wrap>
      {under === null ? (
        <Text variant="code" tone="muted">
          {decision.label}
        </Text>
      ) : null}
      <Badge variant={pill.variant} shape="pill">
        {pill.label}
      </Badge>
      {newMark ? <NewMark /> : null}
      {decision.fromDecisionId !== null ? (
        <FromLabel decisionId={decision.fromDecisionId} />
      ) : null}
      <Text variant="caption" tone="muted">
        <RelativeTime date={decision.openedAt} />
      </Text>
      <Fill />
      <VersionNav versions={versions} viewing={viewing} onView={setViewing} />
    </Stack>
  );
  const thread = (
    <Thread key={decision.id} decision={decision} seenBefore={seenBefore} />
  );
  const body =
    viewing !== null ? (
      // A past version, read-only: what the decision said then (its pill,
      // question, outcome, body and options); the thread is not versioned,
      // so it stays as it is now. Answering is on the current version only.
      <PastVersion decisionId={decision.id} versionId={viewing}>
        {(past, at) => (
          <Stack gap="md">
            {header(
              decisionPresentation({ ...past, unconsumedAnswers: 0 }),
              false,
            )}
            <Stack direction="row" gap="sm" align="center" wrap>
              <Text variant="caption" tone="muted">
                Earlier version, from <RelativeTime date={at} />
              </Text>
              <Button variant="ghost" onClick={() => setViewing(null)}>
                Back to the current version
              </Button>
            </Stack>
            <Text as="h2" variant="heading">
              {past.question}
            </Text>
            {past.outcome !== null ? (
              <Text variant="label">{past.outcome}</Text>
            ) : null}
            {past.body.trim() !== "" ? <Markdown>{past.body}</Markdown> : null}
            {past.options.length > 0 ? (
              <Options options={past.options} draft={null} />
            ) : null}
            {thread}
          </Stack>
        )}
      </PastVersion>
    ) : (
      <Stack gap="md">
        {header(presentation, isNew)}
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
        {thread}
        {decision.state !== "closed" && decision.unconsumedAnswers > 0 ? (
          <Text variant="caption" tone="muted">
            {`Sent to ${decision.taskTitle}. Waiting for it to act on your answer.`}
          </Text>
        ) : null}
        {draft !== undefined && isAnswerable(decision) ? (
          <Answer decision={decision} draft={draft} />
        ) : null}
      </Stack>
    );
  return under === null ? <Card>{body}</Card> : body;
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
  const agent = useLive(decisionAgent, { taskId: decision.taskId });
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
    ready: (a) =>
      a?.finished === true ? (
        <Text variant="caption" tone="muted">
          {`${decision.taskTitle} has finished — your answer will be kept here, not sent.`}
        </Text>
      ) : null,
  });
  const finished = foldResource(agent, {
    loading: () => false,
    error: () => false,
    unavailable: () => false,
    ready: (a) => a?.finished === true,
  });
  const d = draft.value;
  const canClose = decision.state === "fyi" || finished;
  return (
    <Stack gap="xs">
      {agentLine}
      {/* The standard prompt field: a pasted or dropped image or file, the
          "+" picker, and chips (`<ui-context>`, ids) work as in any prompt. */}
      <ComposerField
        keep={keptField(draft, "note")}
        minRows={2}
        maxHeight="16rem"
        namespace={`decision-note-${decision.id}`}
        ariaLabel="Your note"
        placeholder={
          decision.state === "fyi"
            ? "Ask about this…"
            : "Add a note, or ask a question…"
        }
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

/**
 * What the user said in an exchange — the head (their pick, or what kind of
 * note) and their note, drawn as the prompt field wrote it — or null for an
 * agent note.
 */
function userSide(
  e: DecisionExchangeRow,
): { head: string; note: string | null } | null {
  switch (e.kind) {
    case "answer": {
      // The record's own rule (an answer is a pick): a row without one is a broken write.
      if (e.pick === null)
        throw new Error(`decision exchange ${e.id}: an answer without a pick`);
      return { head: `You picked ${e.pick}`, note: e.userText };
    }
    case "recorded":
      return {
        head:
          e.pick === null
            ? "You wrote (not sent)"
            : `You picked ${e.pick} (not sent)`,
        note: e.userText,
      };
    case "question":
      return { head: "You asked", note: e.userText ?? "" };
    case "update":
      return null;
  }
}

/**
 * When one side of an exchange was written, drawn the way a transcript turn
 * draws it: the transcript's own time action, floated at the end of the
 * side's first line and revealed only while the side is hovered — so the
 * side reads as a conversation turn, its text wrapping around the time.
 */
function SideTime({ at }: { at: Date }): ReactElement {
  return (
    <RowActions pin={null} float>
      {rowAction({ kind: "time", at: at.toISOString() })}
    </RowActions>
  );
}

/**
 * One exchange, drawn the way a conversation is: the user's side in the
 * transcript's user-turn card (their pick or kind of note, the note), then
 * the agent's reply or note below it, outside the card — marked new when the
 * user has not seen it. No "You" / "Agent" labels: the card says whose words
 * are whose, as in the transcript. Each side's time shows on hover at its
 * right, as a transcript turn's does.
 */
function Exchange({
  exchange: e,
  seenBefore,
}: {
  exchange: DecisionExchangeRow;
  seenBefore: Date | null;
}): ReactElement {
  const user = userSide(e);
  const unseen =
    e.agentAt !== null && (seenBefore === null || e.agentAt > seenBefore);
  const agent =
    e.agentText !== null ? (
      <Markdown>{e.agentText}</Markdown>
    ) : e.kind === "question" ? (
      <Text variant="caption" tone="muted">
        Waiting for the agent's answer.
      </Text>
    ) : null;
  return (
    <Stack gap="sm">
      {user !== null ? (
        <div className={rowActionsAnchor}>
          <UserMessageCard>
            <div className="flow-root">
              <SideTime at={e.createdAt} />
              <Stack gap="xs">
                <Text variant="label">{user.head}</Text>
                {user.note !== null && user.note !== "" ? (
                  <UserMessageText text={user.note} />
                ) : null}
              </Stack>
            </div>
          </UserMessageCard>
        </div>
      ) : null}
      {agent !== null ? (
        <div className={rowActionsAnchor}>
          <div className="flow-root">
            {/* At rest the new dot holds the line's end; the hover time
                floats in beside it. */}
            {unseen ? (
              <RowActions pin={null} float alwaysVisible>
                <NewMark />
              </RowActions>
            ) : null}
            {e.agentAt !== null ? <SideTime at={e.agentAt} /> : null}
            {agent}
          </div>
        </div>
      ) : null}
    </Stack>
  );
}
