import { z } from "zod";
import { nullable } from "@plugins/fields/core";
import { boolField } from "@plugins/fields/plugins/bool/plugins/config/core";
import { dateField } from "@plugins/fields/plugins/date/plugins/config/core";
import { intField } from "@plugins/fields/plugins/int/plugins/config/core";
import { jsonField } from "@plugins/fields/plugins/json/plugins/config/core";
import { stringListField } from "@plugins/fields/plugins/string-list/plugins/config/core";
import { textField } from "@plugins/fields/plugins/text/plugins/config/core";
import { cappedList } from "@plugins/packages/plugins/list-bound/core";
import {
  liveCollection,
  type LiveRowsCollection,
} from "@plugins/network/plugins/live/core";
import {
  MAIL_QUERY_OPS,
  THREAD_PARTICIPANTS_MAX,
} from "@plugins/apps/plugins/mail/plugins/provider/core";

const ParticipantSchema = z.object({
  name: z.string().nullable(),
  address: z.string(),
});

/**
 * The listed fields are exactly the provider contract's query columns
 * (`MAIL_QUERY_COLUMNS`), so a DataView filter over them is a `MailQuery`
 * as is. Every one is evaluated by the provider (or re-checked per message
 * by the cache), never over these row values: a row shows its thread, the
 * filter asks about its messages.
 */
const MAIL_THREAD_FIELDS = {
  subject: textField({ label: "Subject", primary: true }),
  /** The senders, in order of first message ("Ana, Bo"). */
  from: textField({ label: "From" }),
  /** The recipients (`To`), in order of first message. */
  to: textField({ label: "To" }),
  /**
   * The date the list orders by: the thread's latest message MATCHING the
   * read's filter (the query is per message, so that is where the thread
   * sits in the provider's date order). Read by id (`{ id }` / `{ ids }`),
   * no filter applies: the latest message.
   */
  date: dateField({ label: "Date" }),
  /** Every mailbox one of its messages is in (role ids `role:<role>`). */
  mailboxes: stringListField({ label: "Labels" }),
  unread: boolField({ label: "Unread" }),
  starred: boolField({ label: "Starred" }),
  /** A hint from headers (`multipart/mixed`); the filter is the provider's own test. */
  hasAttachment: boolField({ label: "Attachment" }),
  /**
   * The search box: free text in the provider's search syntax, lowered by
   * the DataView's `searchable: ["query"]`. Provider-evaluated, so it holds
   * no value on a row (always null).
   */
  query: nullable(textField({ label: "Search" })),
};

const MAIL_THREAD_CARRIED = {
  id: textField(),
  snippet: textField(),
  participants: jsonField({
    schema: cappedList(ParticipantSchema, { max: THREAD_PARTICIPANTS_MAX }),
  }),
  recipients: jsonField({
    schema: cappedList(ParticipantSchema, { max: THREAD_PARTICIPANTS_MAX }),
  }),
  /** The latest sent or received message (drafts only when the thread holds nothing else). */
  lastMessageAt: dateField(),
  messageCount: intField(),
  hasDraft: boolField(),
};

/** How many threads one window of {@link mailThreads} holds at most. */
export const MAIL_THREADS_MAX_LIMIT = 200;

/**
 * Why a window of {@link mailThreads} is not answered — typed, never an empty
 * list and never a server failure:
 *
 * - `not-connected` — the mail account needs (re)connecting; the UI renders
 *   the provider's connect action in place of the list;
 * - `offline-not-cached` — the provider cannot be reached and the cache does
 *   not cover this window (a covered one still answers offline);
 * - `filter-refused` — the provider cannot run one of the filter's rules (the
 *   message names it), e.g. a saved view naming a label since deleted.
 */
export const MAIL_THREADS_REFUSALS = [
  "not-connected",
  "offline-not-cached",
  "filter-refused",
] as const;
export type MailThreadsRefusal = (typeof MAIL_THREADS_REFUSALS)[number];

/**
 * The mail threads of the connected account, as any DataView view asks for
 * them: a live window, newest first by `date`, filtered by a `MailQuery`,
 * cut on `(date, id)` and read as key-range pages. Served external from the
 * cache (`apps/mail/cache` server): a covered window answers from Postgres,
 * an uncovered one stays loading while the provider fills it.
 */
export const mailThreads = liveCollection("mail.threads", {
  fields: MAIL_THREAD_FIELDS,
  carry: { fields: MAIL_THREAD_CARRIED },
  id: "id",
  sortable: ["date"],
  default: { orderBy: [["date", "desc"]], limit: 50 },
  maxLimit: MAIL_THREADS_MAX_LIMIT,
  refusals: MAIL_THREADS_REFUSALS,
  // The provider contract's ops per column: the codec refuses any other, and
  // the threads list's Filter offers only the operators lowering to these.
  filterOps: MAIL_QUERY_OPS,
});

/** One thread: a row of {@link mailThreads}. */
export type MailThreadRow =
  typeof mailThreads extends LiveRowsCollection<infer R> ? R : never;
