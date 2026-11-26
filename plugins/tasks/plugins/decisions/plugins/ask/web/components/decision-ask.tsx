import type { MouseEvent, ReactElement } from "react";
import { flushSync } from "react-dom";
import { cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Pin } from "@plugins/primitives/plugins/css/plugins/pin/web";
import { StatusDot } from "@plugins/primitives/plugins/css/plugins/status-dot/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { TextEditor } from "@plugins/primitives/plugins/text-editor/web";
import {
  submitKept,
  useDraft,
} from "@plugins/primitives/plugins/kept-state/web";
import {
  findScrollParent,
  keepInPlace,
} from "@plugins/primitives/plugins/dom/plugins/auto-scroll/web";
import { ResourceErrorInline } from "@plugins/network/plugins/live/plugins/live-state/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { useToast } from "@plugins/shell/plugins/notifications/web";
import { FileLinksWorkspaceProvider } from "@plugins/primitives/plugins/file-links/web";
import {
  AgentThread,
  type StartThreadResult,
} from "@plugins/conversations/plugins/agent-thread/web";
import { useTaskConversations } from "@plugins/tasks/plugins/tasks-core/web";
import type { DecisionRow } from "@plugins/tasks/plugins/decisions/core";
import {
  decisionAskQuestionDraft,
  setChatOpen,
  useChatOpen,
} from "../internal/stores";
import {
  useDecisionChatTask,
  useStartDecisionChat,
} from "../internal/use-decision-chat";

const askIcon = symbol("forum");
const closeIcon = symbol("close");
const sendIcon = symbol("arrow-upward");

/**
 * The chat's toggle, on the right of the answer's editor beside the note's: a
 * dot while the decision has a thread and the chat is closed.
 */
export function DecisionAskToggle({
  decision,
}: {
  decision: DecisionRow;
}): ReactElement {
  const open = useChatOpen(decision.id);
  const task = useDecisionChatTask(decision.id);
  const hasThread = task.status === "ready" && task.data.taskId !== null;
  return (
    // The positioning context the thread dot pins to.
    <Stack as="span" direction="row" gap="none" className="relative">
      <IconButton
        icon={askIcon}
        glyph="small"
        className={cn(!open && "text-muted-foreground")}
        label={
          open
            ? "Hide the chat"
            : `Ask about ${decision.label} — never sent to the agent`
        }
        active={open}
        aria-pressed={open}
        onClick={(e: MouseEvent<HTMLElement>) => {
          // The chat opens ABOVE its toggle: keep the toggle under the
          // pointer, the scroller taking the chat's height in the same frame.
          const button = e.currentTarget;
          keepInPlace(findScrollParent(button), button, () =>
            flushSync(() => setChatOpen(decision.id, !open)),
          );
        }}
      />
      {hasThread && !open && (
        <Pin to="top-right" offset="xs" decorative>
          <StatusDot colorClass="bg-primary" />
        </Pin>
      )}
    </Stack>
  );
}

/** The chat above the answer box, while open: the thread, or the first question. */
export function DecisionAskArea({
  decision,
}: {
  decision: DecisionRow;
}): ReactElement | null {
  const open = useChatOpen(decision.id);
  const task = useDecisionChatTask(decision.id);
  if (!open) return null;
  switch (task.status) {
    case "loading":
      return <Loading label="Loading the chat…" />;
    case "error":
      return (
        <ResourceErrorInline
          error={task.error}
          refetch={task.refetch}
          subject="the chat"
          variant="inline"
        />
      );
    case "ready":
      return task.data.taskId === null ? (
        <FirstQuestion decision={decision} />
      ) : (
        <TaskChat decision={decision} taskId={task.data.taskId} />
      );
  }
}

/** The chat's task: its latest run's thread. */
function TaskChat({
  decision,
  taskId,
}: {
  decision: DecisionRow;
  taskId: string;
}): ReactElement {
  const runs = useTaskConversations(taskId);
  switch (runs.status) {
    case "loading":
      return <Loading label="Loading the chat…" />;
    case "error":
      return (
        <ResourceErrorInline
          error={runs.error}
          refetch={runs.refetch}
          subject="the chat"
          variant="inline"
        />
      );
    case "ready": {
      const latest = runs.data.at(-1);
      return latest === undefined ? (
        <FirstQuestion decision={decision} />
      ) : (
        <Thread decision={decision} conversationId={latest.id} />
      );
    }
  }
}

const close = (decisionId: string) => (
  <IconButton
    icon={closeIcon}
    glyph="small"
    label="Close — the thread stays"
    onClick={() => setChatOpen(decisionId, false)}
  />
);

/** The running chat: the agent's thread with its own reply box, last. */
function Thread({
  decision,
  conversationId,
}: {
  decision: DecisionRow;
  conversationId: string;
}): ReactElement {
  return (
    // The agent reads the main checkout, so the paths it names are main's.
    <FileLinksWorkspaceProvider workspace="main">
      <div className="max-h-[32rem]">
        <AgentThread
          conversationId={conversationId}
          results={[]}
          renderResult={() => null}
          height="hug"
          title={
            <Text variant="caption" tone="muted">
              {`About ${decision.label} · never sent`}
            </Text>
          }
          headerAction={close(decision.id)}
          placeholder={`Ask about ${decision.label}…`}
        />
      </div>
    </FileLinksWorkspaceProvider>
  );
}

/** Sends the first question: the draft is cleared only once the chat started. */
async function sendFirstQuestion(
  kept: Parameters<typeof submitKept>[0],
  question: string,
  ask: (q: string) => Promise<StartThreadResult>,
  onFailed: (message: string) => void,
): Promise<void> {
  await submitKept(kept, async () => {
    const result = await ask(question);
    if (result.kind !== "ok") onFailed(result.message);
    return { ok: result.kind === "ok" };
  });
}

/** Before the chat starts: the first question's box. Sending starts the agent. */
function FirstQuestion({ decision }: { decision: DecisionRow }): ReactElement {
  const question = useDraft(decisionAskQuestionDraft, "", {
    scope: decision.id,
  });
  const [draft, , , draftKept] = question;
  const { ask, blocked } = useStartDecisionChat(decision);
  const toast = useToast();
  const canSend = blocked === null && draft.trim() !== "";

  // A promise, so the send button pends while the chat starts.
  const send = () =>
    sendFirstQuestion(draftKept, draft, ask, (message) =>
      toast({
        type: "decision-ask-start-failed",
        category: "conversations",
        title: "The chat couldn't start",
        description: message,
        variant: "error",
      }),
    );

  return (
    <Stack gap="2xs">
      <Stack direction="row" gap="xs" align="center">
        <Text variant="caption" tone="muted">
          {`Ask Opus about ${decision.label} · never sent to the agent`}
        </Text>
        <Fill />
        {close(decision.id)}
      </Stack>
      <Stack direction="row" gap="xs" align="end">
        <Fill>
          <TextEditor
            keep={question}
            onSubmit={() => {
              if (canSend) void send();
            }}
            submitMode="enter"
            placeholder={blocked ?? `Ask about ${decision.label}…`}
            disabled={blocked !== null}
            autoFocus
            minRows={1}
            maxHeight="8rem"
            namespace={`decision-ask-${decision.id}`}
            ariaLabel={`Ask about ${decision.label}`}
          />
        </Fill>
        <IconButton
          icon={sendIcon}
          label="Ask"
          variant="default"
          disabled={!canSend}
          onClick={send}
        />
      </Stack>
    </Stack>
  );
}
