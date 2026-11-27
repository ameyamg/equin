import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { ConfigV2 } from "@plugins/config_v2/web";
import { HealthReport } from "@plugins/shell/plugins/health-report/web";
import { DynamicEnum } from "@plugins/fields/plugins/dynamic-enum/plugins/config/web";
import { mailAccountConfig, mailCacheConfig } from "../core";
import { useMailProviderOptions } from "./internal/use-provider-options";

export { MailProviderChoice } from "./components/provider-choice";
import { useMailHealth } from "./internal/use-mail-health";

export default {
  description:
    "The Mail cache, browser half: the health report's Mail row (absent until Mail has been opened with an account) — attention while the account needs reconnecting, the last sync step failed or push is set up but down, grey while offline (cached mail still shown), ok once synced, saying how changes arrive (instant updates by push, or the fallback tick and why).; registers the cache's budgets (message body budget, conversations kept in the list cache, bodies prefetched per run) and the Mail account's provider (automatic: the connected one; or a registered provider by name, offered from their connect surfaces) for Settings → Config; MailProviderChoice — the same choice drawn in place of a mail list or thread refused provider-not-chosen (several accounts connected).",
  contributions: [
    ConfigV2.WebRegister({ descriptor: mailCacheConfig }),
    ConfigV2.WebRegister({ descriptor: mailAccountConfig }),
    DynamicEnum.Options({
      field: mailAccountConfig.fields.provider,
      useOptions: useMailProviderOptions,
    }),
    HealthReport.Row({
      kind: "status",
      id: "mail",
      title: "Mail",
      useStatus: useMailHealth,
    }),
  ],
} satisfies PluginDefinition;
