import type { MailboxId } from "./ids";

/**
 * JMAP's mailbox roles (RFC 8621 §2, `junk` spelled `spam`). A provider lists
 * a role mailbox only when it has one: Gmail has no `archive` and no `all`
 * mailbox, so it lists neither, and a query naming one is refused.
 */
export const MAILBOX_ROLES = [
  "inbox",
  "sent",
  "drafts",
  "trash",
  "spam",
  "archive",
  "important",
  "all",
] as const;
export type MailboxRole = (typeof MAILBOX_ROLES)[number];

const ROLE_PREFIX = "role:";

/**
 * A role mailbox's id is the role itself (`role:inbox`), on every provider,
 * so an authored view (`{ mailboxes: { hasAny: ["role:inbox"] } }`) means the
 * same mailbox whichever provider serves it.
 */
export function roleMailboxId(role: MailboxRole): MailboxId {
  return `${ROLE_PREFIX}${role}` as MailboxId;
}

/** Any other mailbox: the provider's own id, which may not look like a role id. */
export function nativeMailboxId(native: string): MailboxId {
  if (native === "" || native.startsWith(ROLE_PREFIX)) {
    throw new Error(
      `mail: a provider's own mailbox id may not be empty or start with "${ROLE_PREFIX}" (got ${JSON.stringify(native)})`,
    );
  }
  return native as MailboxId;
}

/** The role a mailbox id names, or null for a provider's own mailbox. Throws on `role:` + an unknown role. */
export function mailboxRoleOf(id: MailboxId): MailboxRole | null {
  if (!id.startsWith(ROLE_PREFIX)) return null;
  const role = id.slice(ROLE_PREFIX.length);
  if (!(MAILBOX_ROLES as readonly string[]).includes(role)) {
    throw new Error(`mail: unknown mailbox role in ${JSON.stringify(id)}`);
  }
  return role as MailboxRole;
}

export type Mailbox = {
  id: MailboxId;
  /** The mailbox's own name (a nested label's last segment). */
  name: string;
  role: MailboxRole | null;
  /** `system`: the provider's own (Inbox, a Gmail category); `user`: made by the user, renamable. */
  kind: "system" | "user";
  parentId: MailboxId | null;
  /** Exact counts, when the provider gives them (Gmail labels.get); null when unknown. */
  counts: { threads: number; unread: number } | null;
  color: { text: string; background: string } | null;
};
