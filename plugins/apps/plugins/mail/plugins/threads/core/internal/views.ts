import type {
  DataViewLockedView,
  FilterGroup,
  FilterRule,
} from "@plugins/primitives/plugins/data-view/core";
import {
  roleMailboxId,
  type Mailbox,
  type MailboxId,
  type MailboxRole,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import {
  mailboxViewIds,
  mailInboxView,
} from "@plugins/apps/plugins/mail/plugins/cache/core";
import { symbol, type IconRef } from "@plugins/ui/plugins/icons/core";

/**
 * The name of the action that takes a thread out of the Inbox — and so of
 * the view of what it took out. "Done" until the user picks between Done and
 * Archive; spelled here only.
 */
export const DONE_LABEL = "Done";

/** The mailboxes field's id: the collection column every view filters. */
const MAILBOXES = "mailboxes";

/** Every built-in view groups by received day ("Today", "Yesterday", …). */
const BY_DAY = { fieldId: "date", groupingId: "smart" } as const;

function rule(
  id: string,
  operatorId: "contains-any-of" | "lacks-nested",
  value: readonly MailboxId[],
): FilterRule {
  return {
    kind: "rule",
    id,
    fieldId: MAILBOXES,
    operatorId,
    value: [...value],
  };
}

function group(id: string, children: FilterRule[]): FilterGroup {
  return { kind: "group", id, conjunction: "and", children };
}

/**
 * The Inbox's mailboxes: the operand of the cache's ONE Inbox window
 * (`mailInboxView`, which the app's boot preload reads). The Inbox view is
 * that rule alone — nothing ANDed in (the inbox never holds spam or trash),
 * the collection's default order and limit, no search — so its first page IS
 * the preloaded tuple.
 */
export const MAIL_INBOX_MAILBOXES: readonly MailboxId[] =
  mailInboxView.where.operand;

/**
 * Spam and trash: the provider's query matches them like any mail (the
 * contract is over every message), so every view outside those two leaves
 * them out in its own filter.
 */
const BIN: readonly MailboxId[] = [
  roleMailboxId("spam"),
  roleMailboxId("trash"),
];

/** Which mailbox count a built-in view shows beside its name in the sidebar. */
export type MailViewCount = { mailbox: MailboxId; of: "unread" | "total" };

/** A built-in view: a locked DataView view, plus its sidebar count. */
export interface MailBuiltInView extends DataViewLockedView {
  count: MailViewCount | null;
}

function builtIn(
  id: string,
  name: string,
  icon: IconRef,
  filter: FilterGroup,
  count: MailViewCount | null,
): MailBuiltInView {
  return {
    id,
    name,
    icon,
    view: { type: "list", filter, groupBy: BY_DAY },
    count,
  };
}

function roleView(
  role: MailboxRole,
  name: string,
  icon: IconRef,
  count: MailViewCount["of"] | null,
  opts?: { keepBin: boolean },
): MailBuiltInView {
  const mailbox = roleMailboxId(role);
  const rules = [rule(`${role}-in`, "contains-any-of", [mailbox])];
  if (opts?.keepBin !== true) {
    rules.push(rule(`${role}-not-bin`, "lacks-nested", BIN));
  }
  return builtIn(
    role,
    name,
    icon,
    group(`${role}-root`, rules),
    count === null ? null : { mailbox, of: count },
  );
}

/** The Inbox view: {@link MAIL_INBOX_MAILBOXES}, and nothing else. */
export const MAIL_INBOX_VIEW: MailBuiltInView = builtIn(
  "inbox",
  "Inbox",
  symbol("inbox"),
  group("inbox-root", [
    rule("inbox-in", "contains-any-of", MAIL_INBOX_MAILBOXES),
  ]),
  { mailbox: roleMailboxId("inbox"), of: "unread" },
);

/**
 * The built-in views, in sidebar order: Inbox, Sent, Drafts, Done, Spam,
 * Trash. Locked (copy-only): editing one is a working copy saved as a NEW
 * view. Done is the mail taken out of the Inbox — received mail in no role
 * mailbox but the ones a thread may also sit in.
 */
export const MAIL_BUILT_IN_VIEWS: readonly MailBuiltInView[] = [
  MAIL_INBOX_VIEW,
  roleView("sent", "Sent", symbol("send"), null),
  roleView("drafts", "Drafts", symbol("draft"), "total"),
  builtIn(
    "done",
    DONE_LABEL,
    symbol("check"),
    group("done-root", [
      rule("done-out", "lacks-nested", [
        roleMailboxId("inbox"),
        roleMailboxId("sent"),
        roleMailboxId("drafts"),
        ...BIN,
      ]),
    ]),
    null,
  ),
  roleView("spam", "Spam", symbol("report"), "total", { keepBin: true }),
  roleView("trash", "Trash", symbol("delete"), null, { keepBin: true }),
];

/**
 * The built-ins the sidebar folds under More until asked for (Gmail's "More"):
 * Spam and Trash — shown while one of them is the active view.
 */
export const MAIL_TUCKED_VIEWS: ReadonlySet<string> = new Set([
  "spam",
  "trash",
]);

/** The view id of a label's view: `label-<mailbox id>`. */
export function labelViewId(id: MailboxId): string {
  // A view id is part of the pane address, where `~` starts a working copy.
  if (id.includes("~")) {
    throw new Error(
      `mail: a mailbox id with "~" cannot name a view (${JSON.stringify(id)})`,
    );
  }
  return `label-${id}`;
}

/** The label a view id names, or `null` for any other view. */
export function labelOfView(viewId: string): MailboxId | null {
  return viewId.startsWith("label-")
    ? (viewId.slice("label-".length) as MailboxId)
    : null;
}

/**
 * One label's view: its threads (with its sub-labels' — `mailboxViewIds`,
 * the one place that choice is made), never spam or trash. Named by the
 * label's own name (a nested label's last segment); coloured by its colour or
 * its nearest coloured ancestor's.
 */
export function labelView(
  label: Mailbox,
  mailboxes: readonly Mailbox[],
): DataViewLockedView {
  const color = labelColor(label, mailboxes);
  return {
    id: labelViewId(label.id),
    name: label.name,
    ...(color !== null ? { color } : {}),
    view: {
      type: "list",
      groupBy: BY_DAY,
      filter: group(`${label.id}-root`, [
        rule(
          `${label.id}-in`,
          "contains-any-of",
          mailboxViewIds(label.id, mailboxes),
        ),
        rule(`${label.id}-not-bin`, "lacks-nested", BIN),
      ]),
    },
  };
}

/** A label's colour: its own, else its nearest coloured ancestor's. */
export function labelColor(
  label: Mailbox,
  mailboxes: readonly Mailbox[],
): string | null {
  const byId = new Map(mailboxes.map((m) => [m.id, m]));
  const seen = new Set<MailboxId>();
  let at: Mailbox | undefined = label;
  while (at !== undefined && !seen.has(at.id)) {
    seen.add(at.id);
    if (at.color !== null) return at.color.background;
    at = at.parentId === null ? undefined : byId.get(at.parentId);
  }
  return null;
}
