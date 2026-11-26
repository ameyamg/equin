import type {
  Mailbox,
  MailboxId,
} from "@plugins/apps/plugins/mail/plugins/provider/core";

/** One visible line of the sidebar's label tree. */
export interface LabelLine {
  label: Mailbox;
  depth: number;
  hasChildren: boolean;
  /** Unread threads under a folded parent (itself and every label below it). */
  rolledUnread: number | null;
}

/** The visible lines of the label tree, depth first, names in order. */
export function labelLines(
  labels: readonly Mailbox[],
  folded: ReadonlySet<MailboxId>,
): LabelLine[] {
  const ids = new Set(labels.map((l) => l.id));
  const kids = new Map<MailboxId | null, Mailbox[]>();
  for (const l of labels) {
    const parent =
      l.parentId !== null && ids.has(l.parentId) ? l.parentId : null;
    kids.set(parent, [...(kids.get(parent) ?? []), l]);
  }
  for (const list of kids.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  const unreadUnder = (l: Mailbox): number =>
    (l.counts?.unread ?? 0) +
    (kids.get(l.id) ?? []).reduce((n, k) => n + unreadUnder(k), 0);
  const out: LabelLine[] = [];
  const walk = (parent: MailboxId | null, depth: number) => {
    for (const l of kids.get(parent) ?? []) {
      const hasChildren = (kids.get(l.id) ?? []).length > 0;
      const shut = hasChildren && folded.has(l.id);
      out.push({
        label: l,
        depth,
        hasChildren,
        rolledUnread: shut ? unreadUnder(l) : null,
      });
      if (!shut) walk(l.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
