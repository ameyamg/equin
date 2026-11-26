// ─── Which headers Gmail keeps on a message (read-only) ───────────────────────
//
//   ./equin run plugins/integrations/plugins/gmail/plugins/api/scripts/headers-probe.ts \
//     --message <gmail message id>
//
// Reads one message's headers (`messages.get` metadata, 5 units) on the
// connected account and prints every header NAME, plus the values of
// Message-ID and of any `X-Equin-*` header — what a sent message's
// reconciliation can find it by (Gmail rewrites a sent message's Message-ID).
// No subject, address or body is printed.

import { getGmailToken } from "@plugins/integrations/plugins/gmail/server";
import { createQuotaPacer } from "../core";
import { createGmailClient } from "../server";

const i = process.argv.indexOf("--message");
const id = i >= 0 ? process.argv[i + 1] : undefined;
if (!id) throw new Error("--message <gmail message id> is required");

const gmail = createGmailClient({
  accessToken: async (o?: { refused?: string }) => {
    const t = await getGmailToken({ refused: o?.refused });
    if (!t.ok) throw new Error(`No Gmail token: ${t.message}`);
    return t.accessToken;
  },
  pacer: createQuotaPacer(),
});

const m = await gmail.getMessage(id, { format: "metadata" });
const headers = m.payload?.headers ?? [];
console.log(`labels: ${(m.labelIds ?? []).join(", ")}`);
for (const h of headers) {
  const shown = /^(message-id|x-equin-.*)$/i.test(h.name) ? `: ${h.value}` : "";
  console.log(`${h.name}${shown}`);
}
