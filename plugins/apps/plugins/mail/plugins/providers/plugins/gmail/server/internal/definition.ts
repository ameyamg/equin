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
    // Gmail lists and cuts by its receipt time, internalDate (the summary's
    // date) differs by seconds: −9 s to +12 s over 12 messages measured on a
    // real account (2026-11-26, the api plugin's scripts/q-probe.ts). A
    // minute's bound keeps every cut and coverage claim safe for that, at a
    // few extra listed messages per page.
    listOrderSlackMs: 60_000,
  },
  compileQuery: compileGmailQuery,
  open: openGmail,
  connectedAccount: async () => {
    const t = await getGmailToken();
    if (!t.ok) {
      // Consent missing is the user's to fix; any other failure to get a
      // token (a refresh that could not reach Google) says nothing about the
      // account, only that it cannot be checked now.
      return t.needsConsent
        ? { kind: "not-connected", message: t.message }
        : { kind: "unreachable", message: t.message };
    }
    if (t.email === null) {
      // The cache keys its rows by the address (a different one is another
      // mailbox): a connection that cannot name it is a broken assumption.
      throw new Error(
        "mail: the Google connection has a Gmail token but no account address",
      );
    }
    return {
      kind: "connected",
      accountId: GMAIL_PRIMARY_ACCOUNT,
      address: t.email,
    };
  },
};
