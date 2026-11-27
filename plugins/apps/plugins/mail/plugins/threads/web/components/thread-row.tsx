import type { ReactNode } from "react";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Center } from "@plugins/primitives/plugins/css/plugins/center/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { rigidClass } from "@plugins/primitives/plugins/css/plugins/rigid/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import { useDateFormatter } from "@plugins/fields/plugins/date/plugins/format/web";
import type { MailThreadRow } from "@plugins/apps/plugins/mail/plugins/cache/core";
import type { MailboxId } from "@plugins/apps/plugins/mail/plugins/provider/core";
import {
  avatarColor,
  fullName,
  initials,
  listTime,
  oneLine,
  shortName,
} from "@plugins/apps/plugins/mail/plugins/shell/core";

const attachIcon = symbol("attach-file");

/** What a row needs besides its thread: the account's mailboxes, and whose names it shows. */
/** How a label reads on a row: its `/` path and colour. */
export interface LabelChipInfo {
  name: string;
  color: string | null;
}

export interface ThreadRowContext {
  /** Each user label's chip by mailbox id (empty while the labels load);
   *  a mailbox not in it (a role, a category) draws no chip. */
  labels: ReadonlyMap<string, LabelChipInfo>;
  /** The label the active view is about: its own chip would say nothing. */
  viewLabel: MailboxId | null;
  /** Sent and Drafts name who it went to ("To Ana"), not who wrote it. */
  names: "senders" | "recipients";
  now: Date;
}

/** The row's lead: the first sender's (or recipient's) initials on their colour. */
export function ThreadAvatar({
  thread,
  ctx,
}: {
  thread: MailThreadRow;
  ctx: ThreadRowContext;
}): ReactNode {
  const people =
    ctx.names === "recipients" ? thread.recipients : thread.participants;
  const who = people[0];
  const key = who === undefined ? "?" : fullName(who);
  return (
    <Center
      axis="both"
      aria-hidden
      className={cn("size-6 rounded-full text-white", rigidClass())}
      style={{ backgroundColor: avatarColor(key) }}
    >
      {/* The prototype's `.av`: 10px initials. */}
      <span className="text-3xs font-semibold">
        {who === undefined ? "?" : initials(who.name, who.address)}
      </span>
    </Center>
  );
}

/**
 * One thread, as the prototype's row: who (first names, the message count),
 * the subject then its snippet, the user's labels on it and an attachment
 * mark, the time. Unread threads read in the text colour, bold. Narrow (the
 * reader open beside the list), the three stack.
 */
export function ThreadRow({
  thread,
  ctx,
}: {
  thread: MailThreadRow;
  ctx: ThreadRowContext;
}): ReactNode {
  const fmt = useDateFormatter();
  const people =
    ctx.names === "recipients" ? thread.recipients : thread.participants;
  const who =
    people.length === 0
      ? "(nobody)"
      : people.length === 1
        ? fullName(people[0]!)
        : people.map(shortName).join(", ");
  const labels = threadLabelChips(thread.mailboxes, ctx.labels, ctx.viewLabel);
  const unread = thread.unread;
  const whoLine = (
    <>
      <Text
        variant="label"
        className={cn(
          unread ? "font-semibold text-foreground" : "text-muted-foreground",
        )}
      >
        {ctx.names === "recipients" ? `To ${who}` : who}
      </Text>
      {thread.messageCount > 1 ? (
        <Text variant="caption" tone="faint" className="tabular-nums">
          {thread.messageCount}
        </Text>
      ) : null}
    </>
  );
  const subject = (
    <Text
      variant="label"
      className={cn(
        "truncate",
        unread ? "font-medium text-foreground" : "text-muted-foreground",
      )}
    >
      {thread.subject === "" ? "(no subject)" : thread.subject}
      {thread.snippet !== "" ? (
        <span className="font-normal text-faint-foreground">
          {" — "}
          {oneLine(thread.snippet)}
        </span>
      ) : null}
    </Text>
  );
  const marks =
    labels.length > 0 || thread.hasAttachment ? (
      <Line className="gap-sm">
        {labels.map((l) => (
          <LabelChip key={l.id} name={l.name} color={l.color} />
        ))}
        {thread.hasAttachment ? (
          <Icon
            icon={attachIcon}
            className="size-3.5 text-faint-foreground"
            aria-label="Has attachments"
          />
        ) : null}
      </Line>
    ) : null;
  const time = (
    <Text variant="caption" tone="faint" className="tabular-nums">
      {listTime(thread.date, ctx.now, fmt)}
    </Text>
  );
  // ONE grid, the prototype's `.row`: one line on a wide list (who in 164px,
  // the subject, the marks, the time in 76px); below 640px (the reader open
  // beside it) the same cells restack — who and the time, the subject under
  // them, the marks under that. A container query moves the cells; each is
  // in the DOM once.
  return (
    <Stack
      gap="none"
      className="@container/thread w-full"
      data-unread={unread || undefined}
    >
      {/* eslint-disable-next-line layout/no-adhoc-layout -- the prototype's reflowing row grid: the same cells on one line or stacked by the list's width (a container query), which no flow primitive places */}
      <div className="grid grid-cols-[10.25rem_minmax(0,1fr)_auto_4.75rem] items-center gap-x-md @max-[640px]/thread:grid-cols-[minmax(0,1fr)_auto] @max-[640px]/thread:gap-y-px">
        {/* eslint-disable-next-line layout/no-adhoc-layout -- a cell of the reflowing row grid above */}
        <Line className="gap-xs @max-[640px]/thread:col-start-1 @max-[640px]/thread:row-start-1">
          {whoLine}
        </Line>
        {/* eslint-disable-next-line layout/no-adhoc-layout -- a cell of the reflowing row grid above */}
        <div className="min-w-0 @max-[640px]/thread:col-span-2 @max-[640px]/thread:row-start-2">
          <Line>{subject}</Line>
        </div>
        {/* eslint-disable-next-line layout/no-adhoc-layout -- a cell of the reflowing row grid above */}
        <div className="@max-[640px]/thread:col-span-2 @max-[640px]/thread:row-start-3 @max-[640px]/thread:empty:hidden @max-[640px]/thread:pt-xs">
          {marks}
        </div>
        {/* The time ends the row (`.row` last track), right-aligned. */}
        {/* eslint-disable-next-line layout/no-adhoc-layout -- a cell of the reflowing row grid above */}
        <Line className="@max-[640px]/thread:col-start-2 @max-[640px]/thread:row-start-1">
          <Fill />
          {time}
        </Line>
      </div>
    </Stack>
  );
}

/** A thread's user labels as chips, in its order (`except`: the view's own label, which would say nothing). */
export function threadLabelChips(
  mailboxes: readonly string[],
  labels: ReadonlyMap<string, LabelChipInfo>,
  except: MailboxId | null = null,
): (LabelChipInfo & { id: string })[] {
  return mailboxes.flatMap((id) => {
    const chip = id === except ? undefined : labels.get(id);
    return chip === undefined ? [] : [{ id, ...chip }];
  });
}

/** A label on a row (and over the reader's thread): its colour as a dot over a wash of it, its `/` path. */
export function LabelChip({
  name,
  color,
}: {
  name: string;
  color: string | null;
}): ReactNode {
  const c = color ?? "var(--muted-foreground)";
  return (
    <Line
      className="h-5 gap-xsm rounded-full px-xsm whitespace-nowrap"
      style={{ background: `color-mix(in srgb, ${c} 16%, transparent)` }}
      title={name}
    >
      <span className="size-1.5 rounded-full" style={{ background: c }} />
      <Text variant="caption" tone="muted">
        {name}
      </Text>
    </Line>
  );
}
