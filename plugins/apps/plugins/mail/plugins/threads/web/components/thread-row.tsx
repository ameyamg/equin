import type { ReactNode } from "react";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import {
  Inset,
  Stack,
} from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Center } from "@plugins/primitives/plugins/css/plugins/center/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import {
  Rigid,
  rigidClass,
} from "@plugins/primitives/plugins/css/plugins/rigid/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
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
      {listTime(thread.date, ctx.now)}
    </Text>
  );
  // One line on a wide list; below 640px (the reader open beside it) the
  // prototype's stacked row: who and the time, the subject, the marks.
  return (
    <Stack
      gap="none"
      className="@container/thread w-full"
      data-unread={unread || undefined}
    >
      <Line className="gap-md @max-[640px]/thread:hidden">
        <Rigid as={Line} className="w-41 gap-xs">
          {whoLine}
        </Rigid>
        <Fill>{subject}</Fill>
        {marks === null ? null : <Rigid>{marks}</Rigid>}
        {/* The time ends the row's 76px column (`.row` last track). */}
        <Rigid as={Line} className="min-w-19">
          <Fill />
          {time}
        </Rigid>
      </Line>
      <Stack gap="none" className="@min-[640px]/thread:hidden">
        <Line className="gap-md">
          <Fill as={Line} className="gap-xs">
            {whoLine}
          </Fill>
          <Rigid>{time}</Rigid>
        </Line>
        {subject}
        {marks === null ? null : <Inset t="xs">{marks}</Inset>}
      </Stack>
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
