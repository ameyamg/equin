import {
  Pane,
  PaneChrome,
  defineRoute,
  impliedBy,
  sameAs,
} from "@plugins/primitives/plugins/pane/web";
import { conversationRoute } from "@plugins/conversations/core";
import { agentManagerApp } from "@plugins/apps/plugins/agent-manager/plugins/shell/core";
import { CommitsGraphBody } from "./components/commits-graph-body";

export const convCommitsGraphPane = Pane.define({
  route: defineRoute({
    id: "conv-commits-graph",
    segment: "commits;conv",
  }),
  // The conversation it is about — omitted from the URL beside that
  // conversation's own column, written (`;conv=`) anywhere else.
  implied: { conv: impliedBy(conversationRoute, sameAs("convId")) },
  app: agentManagerApp,
  title: "Commits",
  // Conversation-scoped satellite: it stays a column beside its conversation
  // (no promote to a pane of its own).
  chrome: { promote: false },
  component: ConvCommitsGraphBody,
});

function ConvCommitsGraphBody() {
  const { conv } = convCommitsGraphPane.useParams();
  return (
    <PaneChrome pane={convCommitsGraphPane}>
      <CommitsGraphBody convId={conv} />
    </PaneChrome>
  );
}
