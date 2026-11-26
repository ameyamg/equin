import { getGmailToken } from "@plugins/integrations/plugins/gmail/server";
import type { MailProviderDefinition } from "@plugins/apps/plugins/mail/plugins/provider/core";
import { GMAIL_PRIMARY_ACCOUNT, openGmail } from "./accounts";
import { compileGmailQuery } from "./compile-query";
import { gmailPush } from "./push/push";

export const gmailMailProvider: MailProviderDefinition = {
  id: "gmail",
  label: "Gmail",
  capabilities: {
    mailboxModel: "labels",
    // history.list carries no label create / rename / delete.
    mailboxDefinitions: "relist",
    // Gmail lists and cuts by its receipt time, internalDate (the summary's
    // date) differs by seconds: −9 s to +12 s over 12 messages measured on a
    // real account (2026-11-26, the api plugin's scripts/q-probe.ts). A
    // minute's bound keeps every cut and coverage claim safe for that, at a
    // few extra listed messages per page.
    listOrderSlackMs: 60_000,
  },
  // Gmail push over Pub/Sub, once set up on this backend (push/push.ts).
  push: gmailPush,
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
