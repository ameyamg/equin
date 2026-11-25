import { Pane, defineRoute } from "@plugins/primitives/plugins/pane/web";
import { websiteApp } from "@plugins/apps/plugins/website/plugins/shell/core";
import {
  WebsiteHeader,
  websitePagePart,
} from "@plugins/apps/plugins/website/plugins/shell/web";
import { tipsPage } from "../core";

/**
 * The tips page at `/about/tips` — the published tips of the day, newest
 * first, read live from the site's box.
 *
 * Wears the shared site header (`actions: WebsiteHeader`). The body is its own
 * chunk, fetched only where the page is shown.
 */
export const tipsPane = Pane.define({
  route: defineRoute({ id: "website-tips", segment: "tips" }),
  app: websiteApp,
  actions: WebsiteHeader,
  title: tipsPage.title,
  component: websitePagePart(tipsPage, () =>
    import("./components/tips-body").then((m) => m.TipsBody),
  ),
});
