import { useState, type ReactNode } from "react";
import { useToast } from "@plugins/shell/plugins/notifications/web";
import { useSurfaceShortcuts } from "@plugins/primitives/plugins/shortcuts/web";
import { Button, cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Row } from "@plugins/primitives/plugins/css/plugins/row/web";
import { Surface } from "@plugins/primitives/plugins/css/plugins/surface/web";
import {
  Inset,
  Stack,
} from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { navIcons, symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import type { MailDraft } from "../../core";
import {
  useDraftEditor,
  useEditorView,
  useMailSignature,
  useOpenCompose,
  useStartDraft,
} from "../internal/use-draft";
import { useComposeActions } from "../internal/windows";
import {
  AttachmentList,
  EditorBody,
  EditorFooter,
  SendError,
} from "./draft-fields";

const replyIcon = symbol("reply");
const replyAllIcon = symbol("reply-all");
const forwardIcon = symbol("forward");
const editIcon = symbol("edit");
const popOutIcon = navIcons.expand;

/** What the reply box needs of the thread it ends: its messages, oldest first. */
export type ReplyThread = {
  id: string;
  messages: readonly {
    id: string;
    isDraft: boolean;
    from: { name: string | null; address: string } | null;
    to: readonly { name: string | null; address: string }[];
    cc: readonly { name: string | null; address: string }[];
  }[];
};

const nameOf = (p: { name: string | null; address: string }) =>
  p.name ?? p.address;

/**
 * The foot of the reading pane (the prototype's): "Reply to <sender>" (or
 * "Follow up with <recipient>" on your own message) with Reply all and
 * Forward; a reply opens in place (the editor under the thread, "Open in a
 * window" moving it to a compose window), a forward in a compose window. A
 * thread whose last message is a draft offers "Continue writing" instead.
 * Keys: r reply, a reply all, f forward.
 */
export function ReplyBox({
  thread,
  me,
}: {
  thread: ReplyThread;
  /** The account's address (its own messages are answered as "Follow up"), or null while not known. */
  me: string | null;
}): ReactNode {
  const startDraft = useStartDraft();
  const openCompose = useOpenCompose();
  const toast = useToast();
  const [reply, setReply] = useState<{
    draft: MailDraft;
    kind: "reply" | "reply-all";
  } | null>(null);
  const last = [...thread.messages].reverse().find((m) => !m.isDraft) ?? null;
  const draft = thread.messages.at(-1)?.isDraft
    ? thread.messages.at(-1)!
    : null;
  const mine =
    last?.from != null &&
    me !== null &&
    last.from.address.toLowerCase() === me.toLowerCase();
  const others =
    last === null
      ? 0
      : new Set(
          [...(last.from ? [last.from] : []), ...last.to, ...last.cc]
            .map((p) => p.address.toLowerCase())
            .filter((a) => a !== me?.toLowerCase()),
        ).size;

  const startReply = async (kind: "reply" | "reply-all") => {
    if (last === null) return;
    try {
      const d = await startDraft({
        kind,
        threadId: thread.id,
        messageId: last.id,
      });
      setReply({ draft: d, kind });
    } catch (err) {
      toast({
        type: "mail-compose-failed",
        title: "Could not start the reply",
        description: err instanceof Error ? err.message : String(err),
        category: "other",
        variant: "error",
      });
    }
  };
  const forward = () => {
    if (last !== null)
      void openCompose({
        kind: "forward",
        threadId: thread.id,
        messageId: last.id,
      });
  };
  useSurfaceShortcuts([
    {
      id: "mail.reply",
      keys: "r",
      label: "Reply",
      group: "Mail",
      when: () => last !== null && reply === null,
      handler: () => void startReply("reply"),
    },
    {
      id: "mail.reply-all",
      keys: "a",
      label: "Reply all",
      group: "Mail",
      when: () => last !== null && reply === null,
      handler: () => void startReply("reply-all"),
    },
    {
      id: "mail.forward",
      keys: "f",
      label: "Forward",
      group: "Mail",
      when: () => last !== null,
      handler: forward,
    },
  ]);

  if (reply !== null) {
    return (
      <InlineReply
        key={reply.draft.id}
        draft={reply.draft}
        kind={reply.kind}
        onDone={() => setReply(null)}
      />
    );
  }
  if (draft !== null) {
    return (
      <Inset x="lg" b="lg">
        <Surface level="raised">
          <Row
            icon={<Icon icon={editIcon} />}
            onClick={() =>
              openCompose({
                kind: "continue",
                threadId: thread.id,
                messageId: draft.id,
              })
            }
          >
            <Text tone="muted">Continue writing</Text>
          </Row>
        </Surface>
      </Inset>
    );
  }
  if (last === null) return null;
  const who = mine
    ? last.to.map(nameOf).join(", ") || "the recipients"
    : last.from
      ? nameOf(last.from)
      : "the sender";
  return (
    <Inset x="lg" b="lg">
      <Surface level="raised">
        <Line className="gap-2xs pr-xsm">
          <Fill>
            <Row
              icon={<Icon icon={replyIcon} />}
              onClick={() => startReply("reply")}
            >
              <Text tone="muted">
                {mine ? `Follow up with ${who}` : `Reply to ${who}`}
              </Text>
            </Row>
          </Fill>
          {others > 1 ? (
            <Button variant="ghost" onClick={() => startReply("reply-all")}>
              <Icon icon={replyAllIcon} />
              Reply all
            </Button>
          ) : null}
          <Button variant="ghost" onClick={forward}>
            <Icon icon={forwardIcon} />
            Forward
          </Button>
        </Line>
      </Surface>
    </Inset>
  );
}

/** A reply being written under the thread: who it goes to, the body, the shared footer, and Open in a window. */
function InlineReply({
  draft,
  kind,
  onDone,
}: {
  /** The draft as its start answered it (the seed of the editor). */
  draft: MailDraft;
  kind: "reply" | "reply-all";
  onDone: () => void;
}): ReactNode {
  const editor = useDraftEditor(draft);
  const signature = useMailSignature();
  const view = useEditorView();
  const { open } = useComposeActions();
  return (
    <Inset x="lg" b="lg">
      <Surface level="raised">
        <Stack gap="none">
          <Line className="gap-xsm pt-xsm pr-xsm pl-lg">
            <Icon
              icon={kind === "reply-all" ? replyAllIcon : replyIcon}
              className="size-3.5 text-muted-foreground"
            />
            <Fill>
              <Text variant="caption" tone="muted">
                {kind === "reply-all" ? "Reply all" : "Reply"}
                {draft.replyingTo ? ` to ${draft.replyingTo.name}` : ""}
              </Text>
            </Fill>
            <IconButton
              icon={popOutIcon}
              label="Open in a window"
              onClick={async () => {
                // What is typed is saved first: the window reads the server's draft.
                await editor.save();
                open(draft.id);
                onDone();
              }}
            />
          </Line>
          <EditorBody
            editor={editor}
            signature={signature}
            view={view}
            placeholder="Write a reply"
            className={cn("max-h-[42vh]")}
            bodyClassName={cn("min-h-20")}
            autoFocus
          />
          <AttachmentList editor={editor} />
          <SendError editor={editor} />
          <EditorFooter
            editor={editor}
            signature={signature}
            view={view}
            onSent={onDone}
            onDiscarded={onDone}
          />
        </Stack>
      </Surface>
    </Inset>
  );
}
