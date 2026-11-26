import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { ConfigV2 } from "@plugins/config_v2/web";
import { HealthReport } from "@plugins/shell/plugins/health-report/web";
import { mailCacheConfig } from "../core";
import { useMailHealth } from "./internal/use-mail-health";

export default {
  description:
    "The Mail cache, browser half: the health report's Mail row (absent until Mail has been opened with an account) — attention while the account needs reconnecting, the last sync step failed or push is set up but down, grey while offline (cached mail still shown), ok once synced, saying how changes arrive (instant updates by push, or the fallback tick and why).; registers the cache's budgets (message body budget, conversations kept in the list cache, bodies prefetched per run) for Settings → Config.",
  contributions: [
    ConfigV2.WebRegister({ descriptor: mailCacheConfig }),
    HealthReport.Row({
      kind: "status",
      id: "mail",
      title: "Mail",
      useStatus: useMailHealth,
    }),
  ],
} satisfies PluginDefinition;
