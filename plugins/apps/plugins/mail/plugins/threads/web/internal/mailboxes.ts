import { useMemo } from "react";
import { useLive } from "@plugins/network/plugins/live/web";
import type { FieldOptionsResult } from "@plugins/primitives/plugins/data-view/core";
import {
  mailMailboxes,
  type MailMailboxRow,
} from "@plugins/apps/plugins/mail/plugins/cache/core";
import {
  mailboxRoleOf,
  type Mailbox,
  type MailboxId,
} from "@plugins/apps/plugins/mail/plugins/provider/core";

/** The account's mailboxes as the read stands: not known yet, failed, or known. */
export type MailboxesState =
  | { kind: "loading" }
  /** The read failed: a refusal (not connected, offline — the list says why
   *  in place) or any other error, shown where the labels go. */
  | { kind: "failed"; error: Error; refetch: () => Promise<void> }
  | {
      kind: "ready";
      mailboxes: readonly Mailbox[];
      byId: ReadonlyMap<MailboxId, Mailbox>;
    };

function toMailbox(row: MailMailboxRow): Mailbox {
  return {
    id: row.id as MailboxId,
    name: row.name,
    role: row.role,
    kind: row.kind,
    parentId: row.parentId as MailboxId | null,
    counts:
      row.threadsTotal === null || row.threadsUnread === null
        ? null
        : { threads: row.threadsTotal, unread: row.threadsUnread },
    color: row.color,
  };
}

/**
 * The connected account's mailboxes (`mail.mailboxes`, whole): the sidebar's
 * labels and counts, the label views, the Labels field's options. A refused
 * read (not connected) is `failed` here — the list itself says why.
 */
export function useMailboxes(): {
  state: MailboxesState;
  options: FieldOptionsResult;
} {
  const read = useLive(mailMailboxes);
  return useMemo(() => {
    if (read.status === "loading") {
      return { state: { kind: "loading" } as const, options: read };
    }
    if (read.status === "error") {
      return {
        state: {
          kind: "failed",
          error: read.error,
          refetch: read.refetch,
        } as const,
        options: read,
      };
    }
    const mailboxes = read.data.map(toMailbox);
    return {
      state: {
        kind: "ready",
        mailboxes,
        byId: new Map(mailboxes.map((m) => [m.id, m])),
      },
      options: {
        status: "ready",
        options: mailboxes.map((m) => ({
          value: m.id,
          label: mailboxLabel(m, mailboxes),
          ...(m.parentId !== null ? { parent: m.parentId } : {}),
        })),
      },
    };
  }, [read]);
}

/** A mailbox as a person names it: a role's own name, a label's `/` path. */
export function mailboxLabel(
  mailbox: Mailbox,
  mailboxes: readonly Mailbox[],
): string {
  if (mailboxRoleOf(mailbox.id) !== null) return mailbox.name;
  const parts = [mailbox.name];
  const seen = new Set([mailbox.id]);
  let parent = mailbox.parentId;
  while (parent !== null && !seen.has(parent)) {
    seen.add(parent);
    const at = mailboxes.find((m) => m.id === parent);
    if (at === undefined) break;
    parts.unshift(at.name);
    parent = at.parentId;
  }
  return parts.join(" / ");
}

/** The user's own labels (not roles, not provider categories). */
export function userLabels(mailboxes: readonly Mailbox[]): Mailbox[] {
  return mailboxes.filter((m) => m.kind === "user");
}
