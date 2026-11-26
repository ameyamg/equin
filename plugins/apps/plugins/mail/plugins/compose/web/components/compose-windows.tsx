import { useEffect, useState, type ReactNode } from "react";
import { useLive } from "@plugins/network/plugins/live/web";
import { matchResource } from "@plugins/network/plugins/live/plugins/live-state/web";
import { useFetchEndpoint } from "@plugins/infra/plugins/endpoints/web";
import { useToast } from "@plugins/shell/plugins/notifications/web";
import { useSurfaceShortcuts } from "@plugins/primitives/plugins/shortcuts/web";
import { Button } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { Pin } from "@plugins/primitives/plugins/css/plugins/pin/web";
import { Surface } from "@plugins/primitives/plugins/css/plugins/surface/web";
import {
  Inset,
  Stack,
} from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import {
  mailDraft,
  undoSendMailDraft,
  type MailDraft,
  type MailDraftId,
} from "../../core";
import {
  useDraftEditor,
  useMailSignature,
  useOpenCompose,
} from "../internal/use-draft";
import {
  ComposeStore,
  useComposeActions,
  type ComposeWindow,
} from "../internal/windows";
import {
  AttachmentList,
  SignatureBlock,
  BodyField,
  EditorFooter,
  HeaderFields,
  SendError,
} from "./draft-fields";

const minimizeIcon = symbol("remove");
const expandIcon = symbol("expand-less");
const closeIcon = symbol("close");

/** How long "Message sent" stays once a send lands. */
const SENT_SHOWN_MS = 4_000;

/**
 * The compose state of one Mail surface (its open windows, its outbox): the
 * layout wraps everything that opens compose — the list, the reader — and
 * the `ComposeLayer` that draws it.
 */
export function ComposeProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return <ComposeStore.Provider>{children}</ComposeStore.Provider>;
}

/**
 * Mail's compose layer, drawn over the whole surface: the open compose
 * windows (bottom right, the prototype's: a title bar to minimise, the header
 * fields, the body, Send / Attach / Discard) and the outbox pill — "Sending…"
 * with Undo for the undo-send delay of every send made from this surface,
 * then "Message sent". The `c` key opens a new message.
 */
export function ComposeLayer(): ReactNode {
  const { windows, sending } = ComposeStore.useStore();
  const openCompose = useOpenCompose();
  useSurfaceShortcuts([
    {
      id: "mail.compose",
      keys: "c",
      label: "Compose a new message",
      group: "Mail",
      handler: () => void openCompose({ kind: "new" }),
    },
  ]);
  return (
    <>
      {windows.length > 0 ? (
        <Pin
          to="bottom-right"
          offset="none"
          layer="overlay"
          className="pointer-events-none"
        >
          <Inset r="xl">
            <Line className="gap-md">
              {windows.map((w) => (
                <ComposeWindowView key={w.id} window={w} />
              ))}
            </Line>
          </Inset>
        </Pin>
      ) : null}
      {sending.length > 0 ? (
        <Pin
          to="bottom"
          offset="xl"
          layer="overlay"
          className="pointer-events-none"
        >
          <Stack gap="xsm" align="center">
            {sending.map((id) => (
              <OutboxPill key={id} id={id} />
            ))}
          </Stack>
        </Pin>
      ) : null}
    </>
  );
}

type Frame = (
  title: string,
  onClose: () => unknown,
  body: ReactNode,
) => ReactNode;

function ComposeWindowView({
  window: w,
}: {
  window: ComposeWindow;
}): ReactNode {
  const read = useLive(mailDraft, { id: w.id });
  const { close, toggleMinimized } = useComposeActions();
  const frame: Frame = (title, onClose, body) => (
    <Surface
      level="overlay"
      as="section"
      aria-label={title}
      className="pointer-events-auto w-[min(520px,calc(100vw-3rem))] rounded-b-none whitespace-normal"
    >
      <Stack gap="none">
        <Line className="h-10 gap-2xs pr-xsm pl-lg">
          <Fill>
            <Text variant="label" className="font-label-strong">
              {title}
            </Text>
          </Fill>
          <IconButton
            icon={w.minimized ? expandIcon : minimizeIcon}
            label={w.minimized ? "Expand" : "Minimise"}
            onClick={() => toggleMinimized(w.id)}
          />
          <IconButton
            icon={closeIcon}
            label="Save and close"
            onClick={onClose}
          />
        </Line>
        {w.minimized ? null : body}
      </Stack>
    </Surface>
  );
  return matchResource(read, {
    loading: () =>
      frame(
        "New message",
        () => close(w.id),
        <Inset pad="lg">
          <Loading variant="rows" count={4} />
        </Inset>,
      ),
    error: (err) =>
      frame(
        "Draft",
        () => close(w.id),
        <Inset pad="lg">
          <Text tone="muted">{err.message}</Text>
        </Inset>,
      ),
    ready: (draft) => (
      <ComposeEditor key={draft.id} draft={draft} frame={frame} />
    ),
  });
}

function ComposeEditor({
  draft,
  frame,
}: {
  draft: MailDraft;
  frame: Frame;
}): ReactNode {
  const editor = useDraftEditor(draft);
  const signature = useMailSignature();
  const { close } = useComposeActions();
  const toast = useToast();
  const title =
    editor.content.subject.trim() !== ""
      ? editor.content.subject
      : "New message";
  const saveAndClose = async () => {
    const kept = await editor.close();
    close(draft.id);
    if (kept === "kept") {
      toast({
        type: "mail-draft-saved",
        title: "Draft saved",
        description: "",
        category: "confirmations",
      });
    }
  };
  return frame(
    title,
    saveAndClose,
    <>
      <HeaderFields editor={editor} />
      <BodyField
        editor={editor}
        className="h-56 border-t border-border"
        autoFocus={editor.content.to !== ""}
      />
      <SignatureBlock editor={editor} signature={signature} />
      <AttachmentList editor={editor} />
      <SendError editor={editor} />
      <EditorFooter
        editor={editor}
        signature={signature}
        onSent={() => close(draft.id)}
        onDiscarded={() => close(draft.id)}
      />
    </>,
  );
}

/**
 * One send from this surface in the outbox: "Sending…" with Undo until it
 * goes (Undo reopens the draft in a window), then "Message sent" for a few
 * seconds; a send given up reopens the draft, its reason shown in the window
 * (the server records it in the bell: `mail.send`'s onDead).
 */
function OutboxPill({ id }: { id: MailDraftId }): ReactNode {
  const read = useLive(mailDraft, { id });
  return matchResource(read, {
    loading: () => null,
    // Gone (discarded from another tab): nothing to show, settled.
    error: () => <PillOutcome id={id} outcome="gone" sendError={null} />,
    ready: (d) =>
      d.state === "queued" || d.state === "sending" ? (
        <SendingPill id={id} queued={d.state === "queued"} />
      ) : (
        <PillOutcome
          id={id}
          outcome={d.state === "sent" ? "sent" : "back"}
          sendError={d.sendError}
        />
      ),
  });
}

/** What a send became: sent (shown a moment), back to the draft (reopened when it failed), or gone. */
function PillOutcome({
  id,
  outcome,
  sendError,
}: {
  id: MailDraftId;
  outcome: "sent" | "back" | "gone";
  sendError: string | null;
}): ReactNode {
  const { settled, open } = useComposeActions();
  const [shown] = useState(outcome === "sent");
  // Idempotent both ways (settled / open), so a re-run (StrictMode) is harmless.
  useEffect(() => {
    if (outcome !== "sent") {
      settled(id);
      if (outcome === "back" && sendError !== null) open(id);
      return undefined;
    }
    const t = setTimeout(() => settled(id), SENT_SHOWN_MS);
    return () => clearTimeout(t);
  }, [id, outcome, sendError, settled, open]);
  if (!shown) return null;
  return (
    <Surface level="overlay" className="pointer-events-auto">
      <Line className="h-9 gap-md px-lg">
        <Text variant="label">Message sent</Text>
      </Line>
    </Surface>
  );
}

function SendingPill({
  id,
  queued,
}: {
  id: MailDraftId;
  queued: boolean;
}): ReactNode {
  const fetchEndpoint = useFetchEndpoint();
  const { settled, open } = useComposeActions();
  const toast = useToast();
  const undo = async () => {
    try {
      const r = await fetchEndpoint(undoSendMailDraft, { id });
      if (r.kind === "reopened") {
        settled(id);
        open(id);
      } else {
        toast({
          type: "mail-undo-too-late",
          title: "Already sent",
          description: "",
          category: "confirmations",
        });
      }
    } catch (err) {
      toast({
        type: "mail-undo-failed",
        title: "Could not undo the send",
        description: err instanceof Error ? err.message : String(err),
        category: "other",
        variant: "error",
      });
    }
  };
  return (
    <Surface level="overlay" className="pointer-events-auto">
      <Line className="h-9 gap-md pr-xsm pl-lg">
        <Text variant="label">Sending…</Text>
        {queued ? (
          <Button variant="ghost" className="text-primary-text" onClick={undo}>
            Undo
          </Button>
        ) : null}
      </Line>
    </Surface>
  );
}
