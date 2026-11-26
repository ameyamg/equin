import type {
  Mailbox,
  MailboxId,
} from "@plugins/apps/plugins/mail/plugins/provider/core";

/**
 * Whether a parent label's view also shows its sub-labels' threads (design
 * D10, pending with the user; recommendation: yes). Gmail's own search does
 * not include them (`label:Parent` matches the parent's own messages only —
 * measured), so a yes is spelled here, as the sub-labels' ids added to the
 * view's `hasAny`. The one place the choice is made.
 */
export const PARENT_VIEW_INCLUDES_SUB_LABELS = true;

/** The mailbox ids a view of `id` names: it alone, or it and every mailbox nested under it. */
export function mailboxViewIds(
  id: MailboxId,
  mailboxes: readonly Mailbox[],
): MailboxId[] {
  if (!PARENT_VIEW_INCLUDES_SUB_LABELS) return [id];
  const out = [id];
  const seen = new Set<MailboxId>(out);
  for (let i = 0; i < out.length; i++) {
    for (const m of mailboxes) {
      if (m.parentId === out[i] && !seen.has(m.id)) {
        seen.add(m.id);
        out.push(m.id);
      }
    }
  }
  return out;
}

/** The filter of a mailbox's view: its threads (see {@link mailboxViewIds}). */
export function mailboxViewFilter(
  id: MailboxId,
  mailboxes: readonly Mailbox[],
) {
  return {
    column: "mailboxes" as const,
    op: "hasAny" as const,
    operand: mailboxViewIds(id, mailboxes),
  };
}
