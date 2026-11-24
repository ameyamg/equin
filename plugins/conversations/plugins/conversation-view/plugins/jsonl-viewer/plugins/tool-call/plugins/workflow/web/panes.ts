import {
  Pane,
  defineRoute,
  impliedBy,
  sameAs,
} from "@plugins/primitives/plugins/pane/web";
import { conversationRoute } from "@plugins/conversations/core";
import { agentManagerApp } from "@plugins/apps/plugins/agent-manager/plugins/shell/core";
import { WorkflowNodePaneBody } from "./components/workflow-node-pane";
import { useWorkflowNodeTitle } from "./internal/use-workflow-node";

export const workflowNodePane = Pane.define({
  route: defineRoute({
    id: "workflow-node",
    segment: "workflow-node/:toolUseId/:nodeId;conv",
  }),
  // The conversation it is about — omitted from the URL beside that
  // conversation's own column, written (`;conv=`) anywhere else.
  implied: { conv: impliedBy(conversationRoute, sameAs("convId")) },
  app: agentManagerApp,
  component: WorkflowNodePaneBody,
  // The step's label, read from the step's own params (its conversation too).
  title: { useText: useWorkflowNodeTitle, fallback: "Workflow step" },
  // Conversation-scoped satellite: it stays a column beside its conversation
  // (no promote to a pane of its own).
  chrome: { history: false, promote: false },
  useResolve: false,
});
