import { z } from "zod";
import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import {
  parsedJson,
  parsedText,
} from "@plugins/database/plugins/sql-column/server";
import { idColumn } from "@plugins/ids/server";
import {
  derivedUpdatedAt,
  deriveUpdatedAt,
} from "@plugins/database/plugins/derived-updated-at/server";
import {
  DRAFT_KINDS,
  DRAFT_STATES,
  DraftContentSchema,
  mailDraftIdKind,
} from "../../core";

/** A row's state: the public ones, and `discarded` — gone for the reader, kept until the mirror deletes its provider draft. */
export const DRAFT_ROW_STATES = [...DRAFT_STATES, "discarded"] as const;
export type DraftRowState = (typeof DRAFT_ROW_STATES)[number];

/**
 * What the last send attempt is known to have done: `not-sent` (refused or
 * unreachable before Google had it — sending again is safe) or `unknown`
 * (handed over, no answer — only `findMessage` may say it went).
 */
export const SEND_ATTEMPTS = ["not-sent", "unknown"] as const;

/**
 * Mail drafts and the outbox (design §6): one row per draft being written,
 * queued, being sent or just sent — the WORKING COPY, mirrored to the
 * provider's drafts by `mail.draft-mirror`, sent by `mail.send`. User data,
 * so backed up; left out of worktree forks (a fork must never send main's
 * queued mail or rewrite main's provider drafts).
 */
export const _mailDrafts = deriveUpdatedAt(
  pgTable(
    "mail_drafts",
    {
      id: idColumn(mailDraftIdKind),
      /** The account it is written from (`mail_accounts.id`, no FK: the cache's rows come and go, a draft stays). */
      accountId: text("account_id").notNull(),
      kind: parsedText("kind", z.enum(DRAFT_KINDS)).notNull(),
      /** The thread it answers or forwards from; null for a new message. */
      threadId: text("thread_id"),
      /** Who a reply goes to and when they wrote, for the reply box's header. */
      replyingTo: parsedJson(
        "replying_to",
        z.object({ name: z.string(), date: z.string() }),
      ),
      /** The Message-ID answered (`In-Reply-To`), and the thread's (`References`, oldest first). */
      inReplyTo: text("in_reply_to"),
      references: text("references").array().notNull().default([]),
      /** The answered message as quoted below a reply's body when it is built. */
      quote: text("quote"),
      content: parsedJson("content", DraftContentSchema).notNull(),
      /** Bumped by every save; `mirroredRevision` is the one the provider holds. */
      revision: integer("revision").notNull().default(0),
      mirroredRevision: integer("mirrored_revision").notNull().default(0),
      /** The provider's draft mirroring this one, the thread it is in and its current message. */
      providerDraftId: text("provider_draft_id"),
      providerThreadId: text("provider_thread_id"),
      providerMessageId: text("provider_message_id"),
      /** The Message-ID the mirrored draft carries (each send carries a fresh one: `sendMessageId`). */
      draftMessageId: text("draft_message_id").notNull(),
      state: parsedText("state", z.enum(DRAFT_ROW_STATES)).notNull(),
      /** A provider draft create whose answer was lost: the draft is looked up before anything is made again. */
      draftCreateAttempt: parsedText(
        "draft_create_attempt",
        z.enum(["unknown"]),
      ),
      sendAt: timestamp("send_at", { withTimezone: true }),
      /** The Message-ID of the send being made — what reconciles an answer lost (`findMessage`). */
      sendMessageId: text("send_message_id"),
      sendAttempt: parsedText("send_attempt", z.enum(SEND_ATTEMPTS)),
      sendError: text("send_error"),
      sentThreadId: text("sent_thread_id"),
      sentMessageId: text("sent_message_id"),
      sentAt: timestamp("sent_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      /** The last change a person made or the outbox moved it through (what retention reads). */
      updatedAt: derivedUpdatedAt(),
    },
    (t) => [
      index("mail_drafts_provider_draft_idx").on(t.providerDraftId),
      index("mail_drafts_provider_message_idx").on(t.providerMessageId),
      index("mail_drafts_sent_at_idx").on(t.sentAt),
    ],
  ),
  {
    touchedBy: {
      // What was written and where it stands: a person's change or the outbox's.
      content: true,
      state: true,
      sendAt: true,
      sendError: true,
      revision: true,
      // Bookkeeping of the provider's copy and of a send attempt.
      id: false,
      accountId: false,
      kind: false,
      threadId: false,
      replyingTo: false,
      inReplyTo: false,
      references: false,
      quote: false,
      mirroredRevision: false,
      providerDraftId: false,
      providerThreadId: false,
      providerMessageId: false,
      draftMessageId: false,
      draftCreateAttempt: false,
      sendMessageId: false,
      sendAttempt: false,
      sentThreadId: false,
      sentMessageId: false,
      sentAt: false,
      createdAt: false,
    },
  },
);
