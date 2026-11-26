import type { GmailLabel } from "@plugins/integrations/plugins/gmail/plugins/api/core";
import {
  mailboxRoleOf,
  nativeMailboxId,
  roleMailboxId,
  type Mailbox,
  type MailboxId,
  type MailboxRole,
} from "@plugins/apps/plugins/mail/plugins/provider/core";

// Gmail labels ↔ the neutral model. Role labels become role mailboxes
// (INBOX → role:inbox); UNREAD and STARRED are flags, never mailboxes (JMAP's
// $seen / $flagged keywords); every other label is a mailbox under its own
// Gmail id. Gmail has no archive and no "all" mailbox: archived mail is mail
// outside the inbox, so neither role is listed.

/** Gmail's role labels and the term that searches each (`in:` / `is:`). */
export const GMAIL_ROLE_LABELS = {
  inbox: { labelId: "INBOX", name: "Inbox", search: "in:inbox" },
  sent: { labelId: "SENT", name: "Sent", search: "in:sent" },
  drafts: { labelId: "DRAFT", name: "Drafts", search: "in:drafts" },
  trash: { labelId: "TRASH", name: "Trash", search: "in:trash" },
  spam: { labelId: "SPAM", name: "Spam", search: "in:spam" },
  important: {
    labelId: "IMPORTANT",
    name: "Important",
    search: "is:important",
  },
} as const satisfies Partial<
  Record<MailboxRole, { labelId: string; name: string; search: string }>
>;
type GmailRole = keyof typeof GMAIL_ROLE_LABELS;

const ROLE_OF_LABEL = new Map<string, GmailRole>(
  Object.entries(GMAIL_ROLE_LABELS).map(([role, l]) => [
    l.labelId,
    role as GmailRole,
  ]),
);

/** System labels that are not roles and that search can name, with their display name. */
export const GMAIL_SYSTEM_SEARCH: Record<
  string,
  { name: string; search: string }
> = {
  CATEGORY_PERSONAL: { name: "Primary", search: "category:primary" },
  CATEGORY_SOCIAL: { name: "Social", search: "category:social" },
  CATEGORY_PROMOTIONS: { name: "Promotions", search: "category:promotions" },
  CATEGORY_UPDATES: { name: "Updates", search: "category:updates" },
  CATEGORY_FORUMS: { name: "Forums", search: "category:forums" },
  CHAT: { name: "Chats", search: "in:chats" },
};

/** Labels that are message flags, not mailboxes. */
export const FLAG_LABELS = { unread: "UNREAD", starred: "STARRED" } as const;

/** The mailbox a Gmail label puts a message in, or null for a flag label. */
export function mailboxIdOfLabel(labelId: string): MailboxId | null {
  if (labelId === FLAG_LABELS.unread || labelId === FLAG_LABELS.starred)
    return null;
  const role = ROLE_OF_LABEL.get(labelId);
  return role ? roleMailboxId(role) : nativeMailboxId(labelId);
}

/** A message's mailboxes from its labels, sorted and deduped. */
export function mailboxesOfLabels(
  labelIds: readonly string[] | undefined,
): MailboxId[] {
  const out = new Set<MailboxId>();
  for (const l of labelIds ?? []) {
    const id = mailboxIdOfLabel(l);
    if (id) out.add(id);
  }
  return [...out].sort();
}

/** The Gmail label id a mailbox is; throws for a role Gmail has no label for (archive, all). */
export function labelIdOfMailbox(id: MailboxId): string {
  const role = mailboxRoleOf(id);
  if (role === null) return id;
  const l = (
    GMAIL_ROLE_LABELS as Partial<Record<MailboxRole, { labelId: string }>>
  )[role];
  if (!l) {
    throw new Error(
      `Gmail has no ${role} mailbox (archive is "not in the inbox": use archive(), not a label)`,
    );
  }
  return l.labelId;
}

/**
 * Every label as a mailbox. A nested user label (`Work/Clients`) is named by
 * its last segment and parented to the label named by the rest, when that
 * label exists (Gmail nests by name only); otherwise it keeps its full name.
 */
export function mailboxesOfGmailLabels(
  labels: readonly GmailLabel[],
): Mailbox[] {
  const byName = new Map(labels.map((l) => [l.name, l.id]));
  const out: Mailbox[] = [];
  for (const l of labels) {
    const id = mailboxIdOfLabel(l.id);
    if (!id) continue;
    const role = mailboxRoleOf(id);
    const counts =
      l.threadsTotal !== undefined && l.threadsUnread !== undefined
        ? { threads: l.threadsTotal, unread: l.threadsUnread }
        : null;
    const color = l.color
      ? { text: l.color.textColor, background: l.color.backgroundColor }
      : null;
    if (l.type === "system") {
      const name = role
        ? GMAIL_ROLE_LABELS[role as GmailRole].name
        : (GMAIL_SYSTEM_SEARCH[l.id]?.name ?? l.name);
      out.push({
        id,
        name,
        role,
        kind: "system",
        parentId: null,
        counts,
        color,
      });
      continue;
    }
    const slash = l.name.lastIndexOf("/");
    const parentLabel =
      slash > 0 ? byName.get(l.name.slice(0, slash)) : undefined;
    out.push({
      id,
      name: parentLabel ? l.name.slice(slash + 1) : l.name,
      role: null,
      kind: "user",
      parentId: parentLabel ? nativeMailboxId(parentLabel) : null,
      counts,
      color,
    });
  }
  return out;
}

/**
 * A user mailbox's full Gmail label name (`Work/Clients`), walking its
 * parents — or null when a parent is missing from `byId` (a partial or stale
 * list), since the name built without it would name another label.
 */
export function gmailLabelName(
  mailbox: Mailbox,
  byId: ReadonlyMap<MailboxId, Mailbox>,
): string | null {
  const parts = [mailbox.name];
  const seen = new Set<MailboxId>([mailbox.id]);
  let parent = mailbox.parentId;
  while (parent !== null) {
    const p = byId.get(parent);
    if (!p) return null;
    if (seen.has(parent))
      throw new Error(`mail: Gmail labels nest in a cycle at ${parent}`);
    seen.add(parent);
    parts.unshift(p.name);
    parent = p.parentId;
  }
  return parts.join("/");
}
