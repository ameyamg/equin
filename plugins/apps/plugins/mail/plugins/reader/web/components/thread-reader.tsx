import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLive } from "@plugins/network/plugins/live/web";
import type { Gesture } from "@plugins/primitives/plugins/link-gesture/core";
import { gestureOf } from "@plugins/primitives/plugins/link-gesture/web";
import { ResourceError } from "@plugins/network/plugins/live/plugins/live-state/web";
import { assetPath } from "@plugins/infra/plugins/endpoints/core";
import { useAssetUrl } from "@plugins/infra/plugins/endpoints/web";
import { InlineFrame } from "@plugins/primitives/plugins/embed/plugins/frame/web";
import { Bar } from "@plugins/primitives/plugins/bar/web";
import { Center } from "@plugins/primitives/plugins/css/plugins/center/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import {
  Rigid,
  rigidClass,
} from "@plugins/primitives/plugins/css/plugins/rigid/web";
import { Scroll } from "@plugins/primitives/plugins/css/plugins/scroll/web";
import {
  Inset,
  Stack,
} from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Cluster } from "@plugins/primitives/plugins/css/plugins/cluster/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Placeholder } from "@plugins/primitives/plugins/css/plugins/placeholder/web";
import {
  buttonVariants,
  cn,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import { MailProviderConnect } from "@plugins/apps/plugins/mail/plugins/provider/web";
import {
  avatarColor,
  fullName,
  initials,
  listTime,
} from "@plugins/apps/plugins/mail/plugins/shell/core";
import {
  mailAttachment,
  mailThread,
  type MailThreadRefusal,
  type ReaderAttachment,
  type ReaderMessage,
  type ReaderThread,
} from "../../core";
import { mailFrameDocument } from "../internal/mail-frame";

const closeIcon = symbol("close");
const attachIcon = symbol("attach-file");
const downloadIcon = symbol("download");

/**
 * One thread, as the prototype's reading pane: a bar (close), the subject
 * with its message count, then every message oldest first — the last one
 * and the unread ones open, the others folded to one line (a click opens
 * one). An HTML body is framed (`InlineFrame fit`: an opaque origin under the
 * mail policy, as tall as the message); a text body is text. Each message
 * lists its files (open in a tab, or download). The bar carries the caller's
 * `tools` (the thread's triage) at its end.
 */
export function ThreadReader({
  threadId,
  onClose,
  tools,
  labels,
  footer,
}: {
  threadId: string;
  /** The thread's labels, drawn under its subject (absent: none). */
  labels?: ReactNode;
  /** Drawn under the thread once it is read (the reply box), given the thread. */
  footer?: (thread: ReaderThread) => ReactNode;
  /** The thread's tools (its triage), drawn at the bar's end (absent: none). */
  tools?: ReactNode;
  /** Closes the reading pane (the pane's own close, with the click's gesture); null: nowhere to close to now. */
  onClose: ((gesture: Gesture) => void) | null;
}): ReactNode {
  const read = useLive(mailThread, { id: threadId });
  let body: ReactNode;
  if (read.status === "loading") {
    body = (
      <Inset x="xl" y="lg">
        <Loading variant="rows" count={6} />
      </Inset>
    );
  } else if (read.status === "error") {
    body = <ReadFailure error={read.error} />;
  } else {
    // Keyed by thread: another thread starts with its own folds.
    body = <ThreadBody key={read.data.id} thread={read.data} labels={labels} />;
  }
  return (
    <Stack gap="none" className="h-full min-h-0 bg-card">
      <Bar>
        {onClose === null ? null : (
          <IconButton
            icon={closeIcon}
            label="Close"
            onClick={(e) => onClose(gestureOf(e))}
          />
        )}
        <Fill />
        {tools}
      </Bar>
      {body}
      {footer !== undefined && read.status === "ready"
        ? footer(read.data)
        : null}
    </Stack>
  );
}

function ReadFailure({ error }: { error: Error }): ReactNode {
  const code =
    error instanceof ResourceError
      ? (error.code as MailThreadRefusal | null)
      : null;
  if (code === "not-connected") {
    return <MailProviderConnect message={error.message} />;
  }
  return (
    <Center axis="both" className="h-full p-xl">
      <Placeholder tone={code === null ? "error" : undefined}>
        {code === "gone"
          ? "This conversation is no longer in your mailbox."
          : error.message}
      </Placeholder>
    </Center>
  );
}

function ThreadBody({
  thread,
  labels,
}: {
  thread: ReaderThread;
  labels: ReactNode;
}): ReactNode {
  const now = useMemo(() => new Date(), []);
  const last = thread.messages.at(-1)?.id;
  // The last message and the unread ones are open; a click opens another.
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        thread.messages
          .filter((m) => m.unread || m.id === last)
          .map((m) => m.id),
      ),
  );
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    // The thread fills the pane, so the reply box sits at its foot.
    <Scroll fill data-mail-thread={thread.id}>
      <Inset x="xl" t="lg" b="xl">
        <Stack gap="lg">
          <Cluster gap="sm">
            <Text as="h2" variant="title" className="tracking-tight">
              {thread.subject === "" ? "(no subject)" : thread.subject}
            </Text>
            {thread.messages.length > 1 ? (
              <Text
                variant="caption"
                tone="faint"
                className="rounded-full border border-border px-xsm whitespace-nowrap"
              >
                {thread.messages.length} messages
              </Text>
            ) : null}
          </Cluster>
          {labels}
          <Stack gap="none">
            {thread.messages.map((m) =>
              open.has(m.id) ? (
                <OpenMessage
                  key={m.id}
                  threadId={thread.id}
                  message={m}
                  now={now}
                  onFold={m.id === last ? undefined : () => toggle(m.id)}
                />
              ) : (
                <FoldedMessage
                  key={m.id}
                  message={m}
                  now={now}
                  onOpen={() => toggle(m.id)}
                />
              ),
            )}
          </Stack>
        </Stack>
      </Inset>
    </Scroll>
  );
}

function Avatar({
  who,
  large,
}: {
  who: ReaderMessage["from"];
  /** The open message's (32px); else a folded one's (18px). */
  large: boolean;
}): ReactNode {
  const key = who === null ? "?" : fullName(who);
  return (
    <Center
      axis="both"
      aria-hidden
      className={cn(
        "rounded-full text-white",
        large ? "size-8" : "size-4.5",
        rigidClass(),
      )}
      style={{ backgroundColor: avatarColor(key) }}
    >
      <Text
        variant="caption"
        className={cn("font-semibold", !large && "text-3xs")}
      >
        {who === null ? "?" : initials(who.name, who.address)}
      </Text>
    </Center>
  );
}

/** A folded message: who, its first line, when — a click opens it. */
function FoldedMessage({
  message: m,
  now,
  onOpen,
}: {
  message: ReaderMessage;
  now: Date;
  onOpen: () => void;
}): ReactNode {
  return (
    <Line
      as="button"
      type="button"
      onClick={onOpen}
      className="h-9.5 w-full gap-smd border-t border-border text-left text-muted-foreground hover:text-foreground"
    >
      <Avatar who={m.from} large={false} />
      <Rigid className="w-26">
        <Text variant="label" className="truncate text-foreground">
          {m.from === null ? "(unknown)" : fullName(m.from)}
        </Text>
      </Rigid>
      <Fill>
        <Text variant="label" tone="faint" className="truncate font-normal">
          {m.preview}
        </Text>
      </Fill>
      <Rigid>
        <Text variant="caption" tone="faint" className="tabular-nums">
          {listTime(new Date(m.date), now)}
        </Text>
      </Rigid>
    </Line>
  );
}

function OpenMessage({
  threadId,
  message: m,
  now,
  onFold,
}: {
  threadId: string;
  message: ReaderMessage;
  now: Date;
  /** Absent for the last message, which stays open. */
  onFold: (() => void) | undefined;
}): ReactNode {
  const to = [...m.to, ...m.cc].map(fullName).join(", ");
  const files = m.attachments.filter((a) => !a.inline);
  const header = (
    <Line className="w-full gap-smd">
      <Avatar who={m.from} large />
      <Fill>
        <Stack gap="none">
          <Text variant="label" className="truncate font-semibold">
            {m.from === null ? "(unknown sender)" : fullName(m.from)}
          </Text>
          <Text variant="caption" tone="faint" className="truncate">
            {to === "" ? "" : `to ${to}`}
          </Text>
        </Stack>
      </Fill>
      <Rigid>
        <Text
          variant="caption"
          tone="faint"
          className="tabular-nums"
          title={new Date(m.date).toLocaleString()}
        >
          {listTime(new Date(m.date), now)}
        </Text>
      </Rigid>
    </Line>
  );
  return (
    <Inset
      t="md"
      b="xs"
      className="border-t border-border first:border-t-0"
      data-mail-message={m.id}
    >
      <Stack gap="md">
        {onFold === undefined ? (
          header
        ) : (
          <button type="button" onClick={onFold} className="text-left">
            {header}
          </button>
        )}
        <MessageBody message={m} />
        {m.unknownCharset !== null ? (
          <Text variant="caption" tone="faint">
            This message declares the charset “{m.unknownCharset}”, which can’t
            be decoded here: some characters may show wrong.
          </Text>
        ) : null}
        {files.length > 0 ? (
          <Cluster gap="xsm">
            {files.map((a) => (
              <AttachmentChip
                key={a.partId}
                threadId={threadId}
                messageId={m.id}
                attachment={a}
              />
            ))}
          </Cluster>
        ) : null}
      </Stack>
    </Inset>
  );
}

/** The page's origin never changes: nothing to subscribe to. */
const noChange = () => () => {};

function MessageBody({ message: m }: { message: ReaderMessage }): ReactNode {
  // The page's own server — the body's rewritten paths resolve against it,
  // and the frame's policy names it — read once mounted (a page has one).
  const origin = useSyncExternalStore(
    noChange,
    () => window.location.origin,
    () => null,
  );
  const doc = useMemo(
    () =>
      m.html === null || origin === null
        ? null
        : mailFrameDocument(m.html, origin),
    [m.html, origin],
  );
  if (m.html !== null && doc === null) return null;
  if (doc !== null) {
    return (
      <InlineFrame
        title={m.subject === "" ? "Message" : m.subject}
        html={doc}
        fit
        allow={["popups", "popups-to-escape-sandbox"]}
        className="block w-full rounded-md border-0 bg-white"
      />
    );
  }
  if (m.text === null || m.text.trim() === "") {
    return (
      <Text variant="body" tone="faint">
        (This message has no text.)
      </Text>
    );
  }
  return (
    <Text
      variant="body"
      className="max-w-[66ch] whitespace-pre-wrap [overflow-wrap:anywhere]"
    >
      {m.text}
    </Text>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A file of a message: opens in a tab (a type the browser shows), with a download beside it. */
function AttachmentChip({
  threadId,
  messageId,
  attachment: a,
}: {
  threadId: string;
  messageId: string;
  attachment: ReaderAttachment;
}): ReactNode {
  const params = { threadId, messageId, partId: a.partId };
  const open = useAssetUrl(assetPath(mailAttachment, params, {}));
  const save = useAssetUrl(
    assetPath(mailAttachment, params, { download: "1" }),
  );
  if (open.kind !== "ready" || save.kind !== "ready") {
    return (
      <Text variant="caption" tone="faint">
        {a.filename} (not available here)
      </Text>
    );
  }
  const name = a.filename === "" ? "Attachment" : a.filename;
  return (
    <Line className="gap-2xs">
      <a
        href={open.url}
        target="_blank"
        rel="noopener"
        className={cn(buttonVariants({ variant: "outline" }), "gap-xsm")}
        title={`${name} · ${formatSize(a.size)}`}
      >
        <Icon icon={attachIcon} className="size-3.5" />
        <span className="max-w-56 truncate">{name}</span>
        <span className="text-faint-foreground">{formatSize(a.size)}</span>
      </a>
      <a
        href={save.url}
        download={name}
        className={buttonVariants({ variant: "ghost", size: "icon" })}
        aria-label={`Download ${name}`}
        title={`Download ${name}`}
      >
        <Icon icon={downloadIcon} className="size-3.5" />
      </a>
    </Line>
  );
}
