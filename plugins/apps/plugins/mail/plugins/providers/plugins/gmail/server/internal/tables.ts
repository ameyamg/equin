import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { externalIdColumn } from "@plugins/ids/server";

/**
 * Gmail push set up on THIS backend (one row per account, v1: one): the
 * user's Google Cloud project, the shared topic Gmail publishes to, this
 * backend's own pull subscription on it, and when the Gmail watch lapses.
 * Left out of forks: a worktree consumes push only once set up from it (its
 * own subscription), never main's.
 */
export const _mailGmailPush = pgTable("mail_gmail_push", {
  accountId: externalIdColumn("account_id", {
    reason: "the Gmail provider's own account id (accounts.ts)",
  }),
  projectId: text("project_id").notNull(),
  /** `projects/<project>/topics/<topic>`. */
  topic: text("topic").notNull(),
  /** `projects/<project>/subscriptions/<subscription>` — this backend's. */
  subscription: text("subscription").notNull(),
  setUpAt: timestamp("set_up_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  /** When the last `users.watch` lapses (Gmail: 7 days); renewed daily on main. */
  watchExpiresAt: timestamp("watch_expires_at", { withTimezone: true }),
});
