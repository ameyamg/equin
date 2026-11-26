import { defineConfig } from "@plugins/config_v2/core";
import { intField } from "@plugins/fields/plugins/int/plugins/config/core";

// The Mail cache's budgets (design §3; the user's call: 500 MB of bodies,
// about 50k thread summaries, prefetch of the top 25), in Settings → Config. Read per use on the server
// (`getConfig`, in memory), so a change applies to the next stored body or
// prefetch run, no restart.
export const mailCacheConfig = defineConfig({
  name: "mail-cache",
  fields: {
    bodyBudgetMb: intField({
      default: 500,
      min: 1,
      label: "Message body budget (MB)",
      description:
        "How much opened and prefetched mail content the Mail cache keeps. Past it, the bodies opened longest ago are dropped; one dropped is fetched again from the mail provider when it is next opened.",
    }),
    summaryCap: intField({
      default: 50_000,
      min: 1_000,
      label: "Conversations kept in the list cache",
      description:
        "How many conversations' list entries (sender, subject, snippet, labels; about 1 KB each) the Mail cache keeps. Past it, the ones used longest ago are dropped — first those no cached view holds, then the oldest a view holds, that view's cached part cut back above them; a view reaching them again reads them from the mail provider. Conversations shown or fetched in the last 10 minutes, or in use, are always kept.",
    }),
    prefetchPerRun: intField({
      default: 25,
      min: 0,
      label: "Bodies prefetched per run",
      description:
        "How many threads' content Mail fetches ahead of you each time a view is read, a thread opened or new mail arrives — the open thread's neighbours first, then the Inbox's unread, then the top of each view read today. Fetched at the provider's background priority, in what its per-minute quota leaves after a reserve for the views you open (Gmail: about a third); 0 turns prefetch off.",
    }),
  },
});
