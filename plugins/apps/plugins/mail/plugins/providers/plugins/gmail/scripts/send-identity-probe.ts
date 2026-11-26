// ─── The send-as identity and a sent message's From (read-only) ───────────────
//
//   ./equin run plugins/apps/plugins/mail/plugins/providers/plugins/gmail/scripts/send-identity-probe.ts \
//     [--subject "<subject of a message in Sent>"]
//
// Prints what the Gmail provider's sendIdentity answers (what compose writes
// as) and, with --subject, the From header and the plain text of the latest
// Sent message with that subject.

import { getGmailToken } from "@plugins/integrations/plugins/gmail/server";
import { createGmailClient } from "@plugins/integrations/plugins/gmail/plugins/api/server";
import { createQuotaPacer } from "@plugins/integrations/plugins/gmail/plugins/api/core";
import { createGmailMailProvider } from "../server/internal/provider";

const i = process.argv.indexOf("--subject");
const subject = i >= 0 ? process.argv[i + 1] : undefined;

const pacer = createQuotaPacer();
const client = createGmailClient({
  accessToken: async (o?: { refused?: string }) => {
    const t = await getGmailToken({ refused: o?.refused });
    if (!t.ok) throw new Error(`No Gmail token: ${t.message}`);
    return t.accessToken;
  },
  pacer,
});
const provider = createGmailMailProvider(client, {
  name: async () => {
    const t = await getGmailToken();
    if (!t.ok) throw new Error(`No Gmail token: ${t.message}`);
    return t.name;
  },
});
const t0 = performance.now();
const connected = await getGmailToken();
if (!connected.ok || connected.email === null)
  throw new Error("No connected Gmail account");
const identity = await provider.sendIdentity(connected.email);
console.log(
  "identity:",
  JSON.stringify(identity),
  `${Math.round(performance.now() - t0)} ms`,
);
if (subject !== undefined) {
  const list = await client.listMessages({
    q: `in:sent subject:"${subject}"`,
    maxResults: 1,
  });
  const ref = list.messages?.[0];
  if (!ref) throw new Error(`No Sent message with subject "${subject}"`);
  const m = await client.getMessage(ref.id, { format: "full" });
  const from = m.payload?.headers?.find((h) => h.name === "From")?.value;
  console.log("From:", from);
  const part = [m.payload, ...(m.payload?.parts ?? [])].find(
    (p) => p?.mimeType === "text/plain" && p.body?.data,
  );
  if (part?.body?.data)
    console.log(
      "text:\n" + Buffer.from(part.body.data, "base64url").toString("utf8"),
    );
}
console.log(`${pacer.stats().spentUnits} units`);
