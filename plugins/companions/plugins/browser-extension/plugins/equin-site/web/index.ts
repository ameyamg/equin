import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { BrowserExtension } from "@plugins/companions/plugins/browser-extension/web";
import {
  openInDemo,
  openLive,
  openLocally,
  openOnMain,
  openOnPublicSite,
} from "./internal/actions";

export default {
  description:
    "The equin site's page actions in the browser extension, over one address model (core: parseEquinAddress / formatEquinAddress) that reads any equin page as an instance (a worktree, main, equin.ai) × a view (an app page, the live demo of it at /about/demo/at/<place>, a website page). Each action moves ONE axis and keeps the other, so a page offers at most three rows, each subtitled with where it goes: Open on main (a worktree's page), Open on equin.ai (a local page — an app page opens in the published demo, as equin.ai serves no app), Open locally (on equin.ai, main), Open in the demo (an app page) and Open live (a demo page — equin.ai's on main). The site mapping is the website's own (apps/website/shell, live-demo core); this leaf only offers it, so the website's composition never carries the extension.",
  contributions: [
    BrowserExtension.PageAction(openOnMain),
    BrowserExtension.PageAction(openLocally),
    BrowserExtension.PageAction(openOnPublicSite),
    BrowserExtension.PageAction(openInDemo),
    BrowserExtension.PageAction(openLive),
  ],
} satisfies PluginDefinition;
