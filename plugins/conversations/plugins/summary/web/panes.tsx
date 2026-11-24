import {
  Pane,
  PaneChrome,
  defineRoute,
  impliedBy,
  sameAs,
} from "@plugins/primitives/plugins/pane/web";
import { conversationRoute } from "@plugins/conversations/core";
import { agentManagerApp } from "@plugins/apps/plugins/agent-manager/plugins/shell/core";
import { SummaryPane } from "./components/summary-pane";

export const convSummaryPane = Pane.define({
  route: defineRoute({
    id: "conv-summary",
    segment: "summary;conv",
  }),
  // The conversation it is about — omitted from the URL beside that
  // conversation's own column, written (`;conv=`) anywhere else.
  implied: { conv: impliedBy(conversationRoute, sameAs("convId")) },
  app: agentManagerApp,
  title: "Summary",
  component: ConvSummaryBody,
  // Conversation-scoped satellite: it stays a column beside its conversation
  // (no promote to a pane of its own).
  chrome: { history: false, promote: false },
});

function ConvSummaryBody() {
  const { conv } = convSummaryPane.useParams();
  return (
    <PaneChrome pane={convSummaryPane} inset="document">
      <SummaryPane convId={conv} />
    </PaneChrome>
  );
}
