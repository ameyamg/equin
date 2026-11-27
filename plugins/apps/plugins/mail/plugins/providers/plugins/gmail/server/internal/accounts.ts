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
  MailUnreachableError,
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

/**
 * Speculative work (body prefetch) is admitted only while the WHOLE window —
 * every priority's charges — is under six `threads.get` full (720 units: the
 * open thread's ±3 neighbours), and its charges never count against
 * background's own share, so a sync step never waits behind a prefetched
 * body. Before this, prefetch shared the background FIFO and share and filled
 * it: a 2-unit sync step waited 53 s behind it on 2026-11-27
 * (task-1795743099-v6pv5z), so a change Gmail signalled showed up to a
 * minute late — while ~93% of the bodies it fetched were never opened.
 */
const SPECULATIVE_UNITS = 6 * GMAIL_QUOTA["threads.get"].full;

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
      // Lower tiers together never hold more than what the reserve leaves
      // (~1,660 units): background's own ~940, speculative's 720.
      backgroundShare:
        (GMAIL_USER_UNITS_PER_MINUTE -
          FOREGROUND_RESERVE_UNITS -
          SPECULATIVE_UNITS) /
        GMAIL_USER_UNITS_PER_MINUTE,
      speculativeShare: SPECULATIVE_UNITS / GMAIL_USER_UNITS_PER_MINUTE,
    }),
  });
  const entry = {
    client,
    provider: createGmailMailProvider(client, {
      name: async () => {
        const t = await getGmailToken();
        if (t.ok) return t.name;
        if (t.needsConsent) throw new MailNotConnectedError(t.message, true);
        // The connection could not be checked now (a refresh that could not
        // reach Google): as a provider call that cannot reach it.
        throw new MailUnreachableError(
          "the Google account's name",
          new Error(t.message),
        );
      },
    }),
  };
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
