import { useCallback } from "react";
import { useLive } from "@plugins/network/plugins/live/web";
import { foldResource } from "@plugins/network/plugins/live/plugins/live-state/web";
import { useToast } from "@plugins/shell/plugins/notifications/web";
import type { TaskId } from "@plugins/tasks/plugins/task-ids/core";
import {
  DECISIONS_PER_TASK_MAX,
  decisionsList,
  type SubmitAnswersResponse,
} from "../../core";
import { isAnswerable, useDecisionDrafts } from "./drafts";

/**
 * What a Submit's answer says once it came back: answers recorded but not
 * typed into their agent are toasted (the turn is retried from the
 * conversation). Shared by the SubmitBar and the section send.
 */
export function useSubmitToasts(): {
  delivered: (response: SubmitAnswersResponse) => void;
  failed: (err: unknown) => void;
} {
  const toast = useToast();
  const delivered = useCallback(
    (response: SubmitAnswersResponse) => {
      for (const d of response.delivered)
        if (d.typingFailed !== null)
          toast({
            type: "task",
            category: "other",
            title: "Answers recorded, not typed into the agent",
            description: `${d.typingFailed} — retry the turn from the agent's conversation.`,
            variant: "error",
          });
    },
    [toast],
  );
  const failed = useCallback(
    (err: unknown) =>
      toast({
        type: "task",
        category: "other",
        title: "Could not submit your answers",
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      }),
    [toast],
  );
  return { delivered, failed };
}

/**
 * One agent's section, sent as soon as it is answered: call the returned
 * function when the user is done with one of `taskId`'s decisions (a pick,
 * Enter in the note, Got it). When every decision of that agent that takes an
 * answer (Needs you and FYI) now holds a drafted one, they all go in one
 * Submit — without waiting on the other agents' sections, which the
 * SubmitBar still sends. Nothing while the task's decisions are not read yet:
 * a section is never judged complete on a partial list.
 */
export function useSendAnsweredSection(taskId: TaskId): () => void {
  const { submitIfAllAnswered, unavailable } = useDecisionDrafts();
  const open = useLive(decisionsList, {
    where: { taskId, tab: { ne: "closed" } },
    limit: DECISIONS_PER_TASK_MAX,
  });
  // The section's decisions once read whole; `null` while loading, and on a
  // failed read (the surface drawing them says so; the SubmitBar still sends).
  const section = foldResource(open, {
    loading: (): string[] | null => null,
    error: () => null,
    ready: (rows) =>
      open.status === "ready" && open.canGrow
        ? null
        : rows.filter(isAnswerable).map((r) => r.id),
  });
  const toasts = useSubmitToasts();
  return useCallback(() => {
    if (unavailable !== null || section === null) return;
    void submitIfAllAnswered(section).then((response) => {
      if (response !== null) toasts.delivered(response);
    }, toasts.failed);
  }, [section, submitIfAllAnswered, unavailable, toasts]);
}
