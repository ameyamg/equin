import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Auth } from "@plugins/auth/web";
import { brand } from "@plugins/ui/plugins/icons/core";
import { CLOUDFLARE_PROVIDER_ID } from "../core";
import { CloudflareSetup } from "./components/cloudflare-setup";

export default {
  description:
    "Cloudflare Accounts row: create a Custom Token (zone read + cache purge) and paste it, inline in its Accounts pane; central accepts it only once Cloudflare reports it active.",
  contributions: [
    Auth.Provider({
      id: CLOUDFLARE_PROVIDER_ID,
      name: "Cloudflare",
      description:
        "API token deploys purge a Cloudflare-fronted site's cached pages with.",
      icon: brand("cloudflare"),
      setup: { kind: "steps", component: CloudflareSetup },
    }),
  ],
} satisfies PluginDefinition;
