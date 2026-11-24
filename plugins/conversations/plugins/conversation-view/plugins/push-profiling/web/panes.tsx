import {
  Pane,
  PaneChrome,
  defineRoute,
  impliedBy,
  sameAs,
} from "@plugins/primitives/plugins/pane/web";
import { conversationRoute } from "@plugins/conversations/core";
import { agentManagerApp } from "@plugins/apps/plugins/agent-manager/plugins/shell/core";
import { PushProfilingPaneBody } from "./components/push-profiling-pane";

export const convPushProfilingPane = Pane.define({
  route: defineRoute({
    id: "conv-push-profiling",
    segment: "pp;conv",
  }),
  // The conversation it is about — omitted from the URL beside that
  // conversation's own column, written (`;conv=`) anywhere else.
  implied: { conv: impliedBy(conversationRoute, sameAs("convId")) },
  app: agentManagerApp,
  title: "Op Profiling",
  // Conversation-scoped satellite: it stays a column beside its conversation
  // (no promote to a pane of its own).
  chrome: { promote: false },
  component: ConvPushProfilingBody,
});

function ConvPushProfilingBody() {
  const { conv } = convPushProfilingPane.useParams();
  return (
    <PaneChrome pane={convPushProfilingPane}>
      <PushProfilingPaneBody convId={conv} />
    </PaneChrome>
  );
}
