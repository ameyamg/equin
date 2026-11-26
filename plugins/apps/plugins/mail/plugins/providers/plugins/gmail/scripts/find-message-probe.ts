// ─── findMessage on the connected account (read-only) ─────────────────────────
//
//   ./equin run plugins/apps/plugins/mail/plugins/providers/plugins/gmail/scripts/find-message-probe.ts \
//     --message-id "<id@domain>"
//
// Runs the Gmail provider's findMessage — what settles a send whose answer
// was lost — for one Message-ID, and prints what it found and what it cost.
// For a message this app sent, Gmail has renamed it: the lookup finds it by
// the X-Equin-Message-Id header the send added (provider.ts).

import { getGmailToken } from "@plugins/integrations/plugins/gmail/server";
import { createGmailClient } from "@plugins/integrations/plugins/gmail/plugins/api/server";
import { createQuotaPacer } from "@plugins/integrations/plugins/gmail/plugins/api/core";
import { createGmailMailProvider } from "../server/internal/provider";

const i = process.argv.indexOf("--message-id");
const id = i >= 0 ? process.argv[i + 1] : undefined;
if (!id) throw new Error('--message-id "<id@domain>" is required');

const pacer = createQuotaPacer();
const provider = createGmailMailProvider(
  createGmailClient({
    accessToken: async (o?: { refused?: string }) => {
      const t = await getGmailToken({ refused: o?.refused });
      if (!t.ok) throw new Error(`No Gmail token: ${t.message}`);
      return t.accessToken;
    },
    pacer,
  }),
);
const t0 = performance.now();
const found = await provider.findMessage(id);
console.log(
  JSON.stringify(found),
  `${Math.round(performance.now() - t0)} ms`,
  `${pacer.stats().spentUnits} units`,
);
