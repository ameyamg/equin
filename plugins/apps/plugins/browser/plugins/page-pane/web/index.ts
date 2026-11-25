import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Pane } from "@plugins/primitives/plugins/pane/web";
import { MarkdownExtensions } from "@plugins/conversations/plugins/conversation-view/plugins/markdown-extensions/web";
import { webPagePane } from "./internal/page-pane";
import { BrowserWebLink } from "./internal/browser-web-link";

export { webPagePane, useWebPageLink } from "./internal/page-pane";

export default {
  description:
    "Web pages in a side pane, in the Browser's own rendering: the web-page pane (web/:url;page) shows one page of the engine's Chromium beside the pane that linked to it, under the browser's toolbar (nav controls, omnibox, actions; the tab strip only once the page opened a popup), its remote page keyed in the URL so a reload re-attaches it, and Expand hands that very page to the Browser app's tabs. useWebPageLink(url) is the link that opens it — plain click opens the pane, ⌘/middle-click leaves the site to a new browser tab — and it is the transcript's web-link opener (MarkdownExtensions.WebLink).",
  contributions: [
    Pane.Register({ pane: webPagePane }),
    MarkdownExtensions.WebLink({ match: "web", component: BrowserWebLink }),
  ],
  slots: { "web-page": webPagePane },
} satisfies PluginDefinition;
