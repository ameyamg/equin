import { asPluginId } from "@plugins/framework/plugins/plugin-id/core";
import { useConfigResult } from "@plugins/config_v2/web";
import { foldResource } from "@plugins/network/plugins/live/plugins/live-state/web";
import { normalizeModelChoice } from "@plugins/conversations/plugins/model-provider/core";
import { useStartThread } from "@plugins/conversations/plugins/agent-thread/web";
import { useSubjectTask } from "@plugins/tasks/plugins/task-subject/web";
import type { DecisionRow } from "@plugins/tasks/plugins/decisions/core";
import {
  DECISION_ASK_CATEGORY_ID,
  DECISION_ASK_PROFILE,
  DECISION_ASK_SUBJECT_KIND,
  decisionAskConfig,
} from "../../core";

const subjectOf = (decisionId: string) => ({
  kind: DECISION_ASK_SUBJECT_KIND,
  id: decisionId,
});

/**
 * The decision's chat task, read live by subject: `taskId: null` before the
 * first question (or once its task was dropped). Its conversation is the
 * task's latest run (`useTaskConversations`).
 */
export function useDecisionChatTask(decisionId: string) {
  return useSubjectTask(subjectOf(decisionId));
}

/** Starts the decision's chat with its first question. */
export function useStartDecisionChat(decision: DecisionRow) {
  const config = useConfigResult(decisionAskConfig);
  const model = foldResource(config, {
    loading: () => null,
    error: () => null,
    ready: (c) => normalizeModelChoice(c.model),
  });
  const { start, availability } = useStartThread({
    filedFrom: asPluginId("tasks.decisions.ask"),
    profile: DECISION_ASK_PROFILE,
    categoryId: DECISION_ASK_CATEGORY_ID,
    // Read only once the settings are known: `blocked` holds every send until then.
    model: model ?? "opus",
  });
  const blocked: string | null = !availability.available
    ? availability.message
    : model === null
      ? "Loading settings…"
      : null;
  const ask = (question: string) =>
    start({
      title: `Ask about ${decision.label}: ${decision.question}`,
      prompt: question,
      input: { decisionId: decision.id },
      subject: subjectOf(decision.id),
    });
  return { ask, blocked };
}
