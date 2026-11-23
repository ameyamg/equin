import {
  rowAction,
  type RowAction,
} from "@plugins/conversations/plugins/conversation-view/plugins/jsonl-viewer/plugins/row-actions/web";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import type { JsonlEvent } from "@plugins/conversations/plugins/transcript-source/core";
import { conversationPane } from "@plugins/conversations/plugins/conversation-view/web";
import { useStorageScope } from "@plugins/primitives/plugins/dom/plugins/web-storage/web";
import { useTranscriptEvents } from "@plugins/conversations/plugins/conversation-view/plugins/jsonl-viewer/web";
import { useGoBackToMessage } from "@plugins/conversations/plugins/conversation-view/plugins/rewind/web";
import {
  restoreAnswerDraft,
  restoreAnswerDraftFromRecord,
} from "./answer-draft";
import { AskUserQuestionInputSchema, type Question } from "./answer-model";
import { findAnswerTurn } from "./question-state";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";

const callSplitIcon = symbol("call-split");
const historyIcon = symbol("history");
const undoIcon = symbol("undo");

/**
 * Row action on an answered question: go back to just before the answer was
 * sent, and reopen the question's form with the previous answer filled in —
 * either here (the agent forgets everything since) or in a new conversation.
 * Same glyph and menu as the rewind on the user's own messages.
 *
 * The answer is either the tool's real result (answered through the live
 * form) or an ordinary user turn this plugin hides from the transcript (sent
 * after the agent stopped asking). Neither is a row the transcript's own
 * per-message rewind shows on, so the question's row is the only place that
 * can offer it.
 */
function useChangeAnswersAction(event: JsonlEvent): RowAction | null {
  const { convId } = conversationPane.useParams();
  const storage = useStorageScope();
  // The transcript this row is drawn in: a window of a long conversation
  // still holds every event after this call, which is where its answer is.
  const events = useTranscriptEvents();
  const answer = findAnswer(event, events);
  const { available, busy, run } = useGoBackToMessage({
    convId,
    uuid: answer?.uuid,
    // The removed answer goes back in the form, not in the prompt editor.
    onBack: (targetConvId, answerText) => {
      if (answer === null || event.kind !== "tool-call") return;
      answer.restore(storage, targetConvId, event.toolUseId, answerText);
    },
  });
  if (answer === null || !available) return null;

  return {
    kind: "button",
    icon: historyIcon,
    label: "Change answers",
    popup: (trigger) => (
      <DropdownMenu>
        <DropdownMenuTrigger render={trigger} />
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={busy} onClick={() => void run("rewind")}>
            <Icon icon={undoIcon} />
            Rewind and answer again
          </DropdownMenuItem>
          <DropdownMenuItem disabled={busy} onClick={() => void run("fork")}>
            <Icon icon={callSplitIcon} />
            Answer again in a fork
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  };
}

/**
 * Where this question's answer is, and how to put it back in a reopened form —
 * or `null` when the row is not an answered question set. The answer is either
 * an ordinary user turn (its text is the serialized answer) or the tool's
 * result (its structured record is the answer).
 */
function findAnswer(
  event: JsonlEvent,
  events: JsonlEvent[] | undefined,
): {
  uuid: string | undefined;
  restore: (
    storage: ReturnType<typeof useStorageScope>,
    targetConvId: string,
    toolUseId: string,
    answerText: string,
  ) => void;
} | null {
  if (event.kind !== "tool-call" || event.name !== "AskUserQuestion") {
    return null;
  }
  // A call whose input is not a question set (the model got it wrong) asked
  // nothing, so there is no answer to change; its card is the generic one.
  const input = AskUserQuestionInputSchema.safeParse(event.input);
  if (!input.success) return null;
  const questions: Question[] = input.data.questions;
  const answerTurn = findAnswerTurn(events, event.toolUseId);
  if (answerTurn != null) {
    return {
      uuid: answerTurn.uuid,
      restore: (storage, targetConvId, toolUseId, answerText) =>
        restoreAnswerDraft(
          storage,
          targetConvId,
          toolUseId,
          questions,
          answerText,
        ),
    };
  }
  const record = event.result?.questionAnswer;
  const answerUuid = event.result?.answerUuid;
  if (record == null || answerUuid == null) return null;
  return {
    uuid: answerUuid,
    restore: (storage, targetConvId, toolUseId) =>
      restoreAnswerDraftFromRecord(
        storage,
        targetConvId,
        toolUseId,
        questions,
        record,
      ),
  };
}

export function ChangeAnswersAction({ event }: { event: JsonlEvent }) {
  return rowAction(useChangeAnswersAction(event));
}
