import {
  liveBoolean,
  liveInstant,
  liveText,
  type Filter,
  type FilterColumn,
  type FilterOpId,
  type Filterable,
} from "@plugins/network/plugins/live/plugins/filter/core";
import type { MailboxId, ProviderQuery } from "./ids";

/**
 * The query vocabulary every provider compiles: a `Filter` tree over these
 * columns. **The semantics are per message**: a thread is in the answer when
 * ONE of its messages matches the whole filter — what Gmail's search, JMAP's
 * `Email/query` with `collapseThreads`, IMAP `SEARCH` and Outlook's message
 * `$filter` all compute. So `and(unread, from ana)` is an unread message from
 * Ana, not an unread thread Ana wrote in, and `mailboxes hasNone [inbox]` is a
 * thread with a message outside the inbox.
 *
 * - `mailboxes` — the message's mailboxes (role ids `role:<role>`, else the
 *   provider's own).
 * - `unread`, `starred`, `hasAttachment` — the message's flags. An attachment
 *   is a file the reader lists, never an inline `cid:` image, where the
 *   provider's search can say so; Gmail's `has:attachment` cannot (it counts
 *   inline images: providers/gmail, `compile-query.ts`).
 * - `date` — when the message was received, at whole seconds.
 * - `from`, `to`, `subject` — the provider's text match on that header (Gmail
 *   matches words, not substrings), so they are provider-evaluated: never
 *   re-evaluated over cached rows.
 * - `query` — the search box: free text in the provider's own search syntax.
 */
export const MAIL_QUERY_COLUMNS = {
  mailboxes: { domain: "stringArray" } as FilterColumn<
    "stringArray",
    MailboxId
  >,
  unread: liveBoolean(),
  starred: liveBoolean(),
  hasAttachment: liveBoolean(),
  date: liveInstant(),
  from: liveText(),
  to: liveText(),
  subject: liveText(),
  query: liveText(),
} as const satisfies Filterable;

export type MailQueryColumns = typeof MAIL_QUERY_COLUMNS;
export type MailQueryColumn = keyof MailQueryColumns;
/** A query: a filter over the mail columns; `undefined` is every message. */
export type MailQuery = Filter<MailQueryColumns> | undefined;

/**
 * The operators each column offers — the contract, not one provider's reach:
 * every registered provider compiles every pair here (its compile test walks
 * this table), so the filter UI offers exactly these and an unsupported rule
 * has no spelling. A saved view naming another pair is refused at compile.
 */
export const MAIL_QUERY_OPS = {
  mailboxes: ["hasAny", "hasAll", "hasNone"],
  unread: ["eq", "ne"],
  starred: ["eq", "ne"],
  hasAttachment: ["eq", "ne"],
  date: ["lt", "lte", "gt", "gte"],
  from: ["contains", "notContains"],
  to: ["contains", "notContains"],
  subject: ["contains", "notContains"],
  query: ["contains"],
} as const satisfies Record<MailQueryColumn, readonly FilterOpId[]>;

export function isDeclaredMailOp(column: string, op: string): boolean {
  const ops = (MAIL_QUERY_OPS as Record<string, readonly string[]>)[column];
  return ops !== undefined && ops.includes(op);
}

export type MailQueryRefusalReason =
  /** The column / operator pair is not in MAIL_QUERY_OPS. */
  | "unsupported-op"
  /** No mailbox of this account has the id. */
  | "unknown-mailbox"
  /** The mailbox exists, or is a role, but this provider cannot search it. */
  | "unsupported-mailbox"
  /** The operand has no exact spelling in the provider's language (a quote in a name, a date between seconds). */
  | "unrepresentable-operand";

/** Which rule the provider refused, and why — the DataView's unavailable rule. */
export type MailQueryRefusal = {
  column: string;
  op: string;
  reason: MailQueryRefusalReason;
  message: string;
};

/**
 * A compile's answer. `nothing` is a filter no message can match (`or: []`):
 * the answer is empty without asking. `refused` never drops the rule and
 * runs the rest — the view says which rule it cannot run.
 */
export type CompiledMailQuery =
  | { kind: "query"; providerQuery: ProviderQuery }
  | { kind: "nothing" }
  | { kind: "refused"; refusal: MailQueryRefusal };
