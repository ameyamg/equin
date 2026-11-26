import { createQuotaPacer } from "@plugins/integrations/plugins/gmail/plugins/api/core";
import { createGmailClient } from "@plugins/integrations/plugins/gmail/plugins/api/server";
import { getGmailToken } from "@plugins/integrations/plugins/gmail/server";
import {
  MailNotConnectedError,
  type MailProvider,
  type MailProviderDefinition,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import { compileGmailQuery } from "./compile-query";
import { createGmailMailProvider } from "./provider";

/** The one account v1 serves: the primary Google connection getGmailToken reads. */
export const GMAIL_PRIMARY_ACCOUNT = "primary";

const opened = new Map<string, MailProvider>();

function openGmail(accountId: string): MailProvider {
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
  const provider = createGmailMailProvider(client);
  opened.set(accountId, provider);
  return provider;
}

export const gmailMailProvider: MailProviderDefinition = {
  id: "gmail",
  label: "Gmail",
  capabilities: {
    mailboxModel: "labels",
    // history.list carries no label create / rename / delete.
    mailboxDefinitions: "relist",
    // Pub/Sub push is task 8 of the Mail design; until then the cache's
    // documented history.list tick is the change signal.
    push: "none",
  },
  compileQuery: compileGmailQuery,
  open: openGmail,
};
