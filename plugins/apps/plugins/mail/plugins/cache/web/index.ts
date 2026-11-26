import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { HealthReport } from "@plugins/shell/plugins/health-report/web";
import { useMailHealth } from "./internal/use-mail-health";

export default {
  description:
    "The Mail cache, browser half: the health report's Mail row (absent until Mail has been opened with an account) — attention while the account needs reconnecting or the last sync step failed, grey while offline (cached mail still shown), ok once synced, saying how changes arrive (the fallback tick, until push).",
  contributions: [
    HealthReport.Row({
      kind: "status",
      id: "mail",
      title: "Mail",
      useStatus: useMailHealth,
    }),
  ],
} satisfies PluginDefinition;
