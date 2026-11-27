import { z } from "zod";
import {
  bigint,
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { parsedJson } from "@plugins/database/plugins/sql-column/server";
import { bytea } from "@plugins/fields/plugins/bytes/plugins/storage/server";
import { externalIdColumn } from "@plugins/ids/server";

// The local provider's mailbox: mail kept in this host's own database, never
// sent anywhere. Every time is a `timestamptz` (a snapshot's time shift moves
// them all). Role mailboxes (Inbox, Sent, …) are the provider's constants;
// only labels are rows.

export const ParticipantSchema = z.object({
  name: z.string().nullable(),
  address: z.string(),
});
const ParticipantsSchema = z.array(ParticipantSchema);
const StringsSchema = z.array(z.string());

/** The one account (v1: one row, id `local`): its address, the name it writes as, and its signature. */
export const _mailLocalAccounts = pgTable("mail_local_accounts", {
  id: externalIdColumn("id", {
    reason: "the local provider's one account id (`local`)",
  }),
  address: text("address").notNull(),
  displayName: text("display_name"),
  signature: text("signature"),
});

/** The labels: a name under a parent (null: a root), and a colour of the provider's palette. */
export const _mailLocalMailboxes = pgTable("mail_local_mailboxes", {
  id: externalIdColumn("id", {
    reason:
      "the local provider's own mailbox id (nativeMailboxId), minted on create",
  }),
  name: text("name").notNull(),
  parentId: text("parent_id"),
  color: parsedJson(
    "color",
    z.object({ text: z.string(), background: z.string() }),
  ),
});

/** One message. `mailboxes` is a jsonb array of mailbox ids (the filter language's stringArray). */
export const _mailLocalMessages = pgTable(
  "mail_local_messages",
  {
    id: externalIdColumn("id", {
      reason:
        "a message id the caller gives on delivery, or minted on send / save",
    }),
    threadId: text("thread_id").notNull(),
    date: timestamp("date", { withTimezone: true }).notNull(),
    fromName: text("from_name"),
    fromAddress: text("from_address").notNull(),
    to: parsedJson("to_participants", ParticipantsSchema).notNull(),
    cc: parsedJson("cc_participants", ParticipantsSchema).notNull(),
    bcc: parsedJson("bcc_participants", ParticipantsSchema).notNull(),
    replyTo: parsedJson("reply_to_participants", ParticipantsSchema).notNull(),
    subject: text("subject").notNull(),
    text: text("text"),
    /** The charset `text` declared when no decoder knew it (its bytes then read as UTF-8); null when decoded. */
    textUnknownCharset: text("text_unknown_charset"),
    html: text("html"),
    htmlUnknownCharset: text("html_unknown_charset"),
    mailboxes: parsedJson("mailboxes", StringsSchema).notNull(),
    unread: boolean("unread").notNull(),
    starred: boolean("starred").notNull(),
    isDraft: boolean("is_draft").notNull(),
    /** The draft this message is the current version of (a save replaces the message, the draft id stays). */
    draftId: text("draft_id"),
    rfc822MessageId: text("rfc822_message_id").notNull(),
    inReplyTo: text("in_reply_to"),
    references: parsedJson("references", StringsSchema).notNull(),
  },
  (t) => [
    index("mail_local_messages_date_idx").on(t.date, t.id),
    index("mail_local_messages_thread_idx").on(t.threadId),
    index("mail_local_messages_rfc_idx").on(t.rfc822MessageId),
    index("mail_local_messages_draft_idx").on(t.draftId),
  ],
);

/** A message's attachments and inline parts, their bytes kept here (a local mailbox's files are small). */
export const _mailLocalAttachments = pgTable(
  "mail_local_attachments",
  {
    messageId: text("message_id")
      .notNull()
      .references(() => _mailLocalMessages.id, { onDelete: "cascade" }),
    partId: text("part_id").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    bytes: bytea("bytes").notNull(),
    contentId: text("content_id"),
    /** Shown in the body (a `cid:` image), not listed with the files. */
    inline: boolean("inline").notNull(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.partId] })],
);

/**
 * The change log: one row per write per thread it touched (`threadId` null:
 * a mailbox write). Its `seq` is the change cursor, and a thread's version is
 * the latest `seq` naming it.
 */
export const _mailLocalChanges = pgTable(
  "mail_local_changes",
  {
    seq: bigint("seq", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    threadId: text("thread_id"),
    mailboxesChanged: boolean("mailboxes_changed").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("mail_local_changes_thread_idx").on(t.threadId, t.seq)],
);
