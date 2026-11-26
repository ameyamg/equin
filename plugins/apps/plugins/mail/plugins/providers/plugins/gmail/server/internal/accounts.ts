import {
  createQuotaPacer,
  GMAIL_QUOTA,
  GMAIL_USER_UNITS_PER_MINUTE,
} from "@plugins/integrations/plugins/gmail/plugins/api/core";
import {
  createGmailClient,
  type GmailClient,
} from "@plugins/integrations/plugins/gmail/plugins/api/server";
import { getGmailToken } from "@plugins/integrations/plugins/gmail/server";
import {
  MailNotConnectedError,
  type MailProvider,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import { createGmailMailProvider } from "./provider";

/** The one account v1 serves: the primary Google connection getGmailToken reads. */
export const GMAIL_PRIMARY_ACCOUNT = "primary";

/**
 * The units of every minute background work (body prefetch, re-lists,
 * catch-ups) may never take: what a person asks in a minute's burst — four
 * cold views opened back to back, each one page of mail/cache's
 * (`MAIL_THREADS_PAGE`, 25 rows, read as 27 summaries with the fill's slack:
 * one `messages.list` page and 27 `threads.get` metadata). A
 * background charge stays in Gmail's 60 s window for the whole minute, so
 * background admitted into HALF the budget (the pacer's default) left a
 * second cold view waiting up to a minute for it to age out: 18 prefetched
 * bodies took 36% of one minute on 2026-11-26 while a cold Inbox read
 * waited 56 s (report-1795721325-qdseiw, task-1795722837-9njd4m).
 * Background work is not refused, only paced into the rest.
 */
const FOREGROUND_RESERVE_UNITS =
  4 * (GMAIL_QUOTA["messages.list"] + 27 * GMAIL_QUOTA["threads.get"].metadata);

const opened = new Map<
  string,
  { client: GmailClient; provider: MailProvider }
>();

function openAccount(accountId: string) {
  const cached = opened.get(accountId);
  if (cached) return cached;
  if (accountId !== GMAIL_PRIMARY_ACCOUNT) {
    throw new Error(
      `mail: the Gmail provider serves the primary Google account only (asked for "${accountId}")`,
    );
  }
  const client = createGmailClient({
    accessToken: async (o) => {
      const t = await getGmailToken({ refused: o?.refused });
      if (!t.ok) throw new MailNotConnectedError(t.message, t.needsConsent);
      return t.accessToken;
    },
    // ONE pacer per account per process: every read and write of this
    // account goes through this provider instance (opened once, kept).
    pacer: createQuotaPacer({
      backgroundShare:
        1 - FOREGROUND_RESERVE_UNITS / GMAIL_USER_UNITS_PER_MINUTE,
    }),
  });
  const entry = { client, provider: createGmailMailProvider(client) };
  opened.set(accountId, entry);
  return entry;
}

export function openGmail(accountId: string): MailProvider {
  return openAccount(accountId).provider;
}

/** The account's ONE Gmail client (the provider's, same pacer): for the push setup's `users.watch`. */
export function gmailClientOf(accountId: string): GmailClient {
  return openAccount(accountId).client;
}
