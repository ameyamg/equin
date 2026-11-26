import { createQuotaPacer } from "@plugins/integrations/plugins/gmail/plugins/api/core";
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
    pacer: createQuotaPacer(),
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
