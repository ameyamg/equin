import {
  Pane,
  defineRoute,
  impliedBy,
  sameAs,
} from "@plugins/primitives/plugins/pane/web";
import { conversationRoute } from "@plugins/conversations/core";
import { agentManagerApp } from "@plugins/apps/plugins/agent-manager/plugins/shell/core";
import { ShellOutputPaneBody } from "./components/shell-output-pane";

/**
 * One background shell's live output, beside the conversation that launched
 * it. Keyed by the shell id and that conversation (its own `conv` param,
 * implied by the conversation column to its left); the server resolves the
 * file from that conversation's transcript.
 */
export const shellOutputPane = Pane.define({
  route: defineRoute({ id: "shell-output", segment: "shell/:shellId;conv" }),
  // The conversation it is about — omitted from the URL beside that
  // conversation's own column, written (`;conv=`) anywhere else.
  implied: { conv: impliedBy(conversationRoute, sameAs("convId")) },
  app: agentManagerApp,
  component: ShellOutputPaneBody,
  title: "Shell",
  // Conversation-scoped satellite: it stays a column beside its conversation
  // (no promote to a pane of its own).
  chrome: { history: false, promote: false },
  useResolve: false,
});
