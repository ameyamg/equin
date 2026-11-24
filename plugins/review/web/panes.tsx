import { useState } from "react";
import {
  Pane,
  PaneChrome,
  defineRoute,
  impliedBy,
  sameAs,
  PaneMessage,
} from "@plugins/primitives/plugins/pane/web";
import { conversationRoute } from "@plugins/conversations/core";
import { agentManagerApp } from "@plugins/apps/plugins/agent-manager/plugins/shell/core";
import {
  Inset,
  Stack,
} from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { ResourceErrorInline } from "@plugins/network/plugins/live/plugins/live-state/web";
import { Scroll } from "@plugins/primitives/plugins/css/plugins/scroll/web";
import { RowView, useLive } from "@plugins/network/plugins/live/web";
import { Placeholder } from "@plugins/primitives/plugins/css/plugins/placeholder/web";
import { useConversationById } from "@plugins/conversations/web";
import { pushRows } from "@plugins/tasks/plugins/tasks-core/core";
import { Review } from "./slots";
import { type Source, SourceTabs, groupPushes } from "./source";

export const convReviewPane = Pane.define({
  title: "Review",
  route: defineRoute({
    id: "conv-review",
    segment: "review;conv",
  }),
  // The conversation it is about — omitted from the URL beside that
  // conversation's own column, written (`;conv=`) anywhere else.
  implied: { conv: impliedBy(conversationRoute, sameAs("convId")) },
  app: agentManagerApp,
  // Conversation-scoped satellite: it stays a column beside its conversation
  // (no promote to a pane of its own).
  chrome: { promote: false },
  component: ConvReviewBody,
});

function ConvReviewBody() {
  const convId = convReviewPane.useParams().conv;
  const conversation = useConversationById(convId);
  const [source, setSource] = useState<Source>({ kind: "working" });

  const body = <Review.Host conversationId={convId} source={source} />;
  return (
    <PaneChrome pane={convReviewPane}>
      <RowView
        row={conversation}
        subject="the conversation"
        fallback={
          // The conversation (and so its attempt) is not known yet: its push
          // tabs are not either. The sections render their own loading state.
          <Stack gap="none" className="h-full">
            <SourceTabs
              source={source}
              onChange={setSource}
              pushGroups="pending"
            />
            <Scroll axis="both" fill>
              {body}
            </Scroll>
          </Stack>
        }
        missing={
          <PaneMessage>
            <Placeholder>This conversation no longer exists.</Placeholder>
          </PaneMessage>
        }
      >
        {(conv) => (
          <Stack gap="none" className="h-full">
            <AttemptSourceTabs
              attemptId={conv.attemptId}
              source={source}
              onChange={setSource}
            />
            <Scroll axis="both" fill>
              {body}
            </Scroll>
          </Stack>
        )}
      </RowView>
    </PaneChrome>
  );
}

// The source tabs once the attempt is known: one tab per push of THIS attempt,
// read from the `pushes` collection filtered to it (a filter, not a slice of a
// global recent window, so an arbitrarily old attempt keeps its pushes).
function AttemptSourceTabs({
  attemptId,
  source,
  onChange,
}: {
  attemptId: string;
  source: Source;
  onChange: (next: Source) => void;
}) {
  const pushesQ = useLive(pushRows, { where: { attemptId } });
  switch (pushesQ.status) {
    case "loading":
      return (
        <SourceTabs source={source} onChange={onChange} pushGroups="pending" />
      );
    case "error":
      // The pushes as last seen keep their tabs; never seen, the strip says the
      // read failed (the Review body below still shows the working tree).
      if (pushesQ.stale !== undefined) {
        return (
          <SourceTabs
            source={source}
            onChange={onChange}
            pushGroups={groupPushes(pushesQ.stale)}
          />
        );
      }
      return (
        <Inset x="sm" y="xs" className="border-b border-border">
          <ResourceErrorInline
            variant="inline"
            subject="this attempt's pushes"
            error={pushesQ.error}
            refetch={pushesQ.refetch}
          />
        </Inset>
      );
    case "ready":
      return (
        <SourceTabs
          source={source}
          onChange={onChange}
          pushGroups={groupPushes(pushesQ.data)}
        />
      );
  }
}
