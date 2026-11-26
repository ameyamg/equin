import type { ReactNode } from "react";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
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
} from "../internal/present";

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
      <Text variant="caption" className="font-semibold">
        {who === undefined ? "?" : initials(who.name, who.address)}
      </Text>
    </Center>
  );
}

/**
 * One thread, as the prototype's row: who (first names, the message count),
 * the subject then its snippet, the user's labels on it and an attachment
 * mark, the time. Unread threads read in the text colour, bold. Read-only in
 * this step: no actions yet.
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
  const labels = thread.mailboxes.flatMap((id) => {
    const chip = id === ctx.viewLabel ? undefined : ctx.labels.get(id);
    return chip === undefined ? [] : [{ id, ...chip }];
  });
  const unread = thread.unread;
  return (
    <Line className="w-full gap-md" data-unread={unread || undefined}>
      <Rigid as={Line} className="w-41 gap-xs">
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
      </Rigid>
      <Fill>
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
      </Fill>
      {labels.length > 0 || thread.hasAttachment ? (
        <Rigid>
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
        </Rigid>
      ) : null}
      <Rigid className="min-w-19 text-right">
        <Text variant="caption" tone="faint" className="tabular-nums">
          {listTime(thread.date, ctx.now)}
        </Text>
      </Rigid>
    </Line>
  );
}

/** A label on a row: its colour as a dot over a wash of it, its `/` path. */
function LabelChip({
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
