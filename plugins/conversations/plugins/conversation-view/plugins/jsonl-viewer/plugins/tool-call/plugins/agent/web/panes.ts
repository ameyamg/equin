import {
  Pane,
  defineRoute,
  impliedBy,
  sameAs,
} from "@plugins/primitives/plugins/pane/web";
import { conversationRoute } from "@plugins/conversations/core";
import { agentManagerApp } from "@plugins/apps/plugins/agent-manager/plugins/shell/core";
import { AgentReportPaneBody } from "./components/agent-report-pane";

export const agentReportPane = Pane.define({
  route: defineRoute({
    id: "agent-report",
    // `by` is a SubagentRef's key kind: `call` (the parent's Agent tool-use id)
    // or `agent` (the sub-agent's own id). The body parses it.
    segment: "agent-report/:by/:key;conv",
  }),
  // The conversation it is about — omitted from the URL beside that
  // conversation's own column, written (`;conv=`) anywhere else.
  implied: { conv: impliedBy(conversationRoute, sameAs("convId")) },
  app: agentManagerApp,
  component: AgentReportPaneBody,
  title: "Sub-agent",
  // Conversation-scoped satellite: it stays a column beside its conversation
  // (no promote to a pane of its own).
  chrome: { history: false, promote: false },
  useResolve: false,
});
