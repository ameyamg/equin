import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Reports } from "@plugins/reports/web";
import {
  WEBSITE_VISITOR_ERROR_KIND,
  WEBSITE_VISITOR_SLOWNESS_KIND,
} from "../core";
import { WebsiteVisitorSummary } from "./components/website-visitor-summary";

export default {
  description:
    "Errors and slowness a deployed site's visitors hit, read from the site's box over SSH within about a minute of the site's flush (its mirror change stream, reduced as it arrives) into this computer's Reports as untrusted website-visitor reports (never auto-investigated, fenced as data when investigated by hand). Web half: both kinds' Debug → Reports summary view — a Website visitors badge, then the site, the page and the visitor's error as plain text (never markup or a link) with the site's own occurrence count, and a 'delivered … late' badge when its last sighting reached this computer over 2 h after it happened.",
  contributions: [
    Reports.KindView({
      match: WEBSITE_VISITOR_ERROR_KIND,
      component: WebsiteVisitorSummary,
    }),
    Reports.KindView({
      match: WEBSITE_VISITOR_SLOWNESS_KIND,
      component: WebsiteVisitorSummary,
    }),
  ],
} satisfies PluginDefinition;
