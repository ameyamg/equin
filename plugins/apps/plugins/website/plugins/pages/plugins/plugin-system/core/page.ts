import { defineWebsitePage } from "@plugins/apps/plugins/website/plugins/crawlable/core";

/** The plugin system page, at `/about/plugin-system`. */
export const pluginSystemPage = defineWebsitePage({
  path: "/about/plugin-system",
  title: "Everything is a plugin",
  description:
    "How equin is put together, as one zoom out: a plugin is one feature, plugins connect through slots, the infrastructure is plugins too, an app is a composition of them, and equin itself is one more composition.",
});
