import { defineWebsitePage } from "@plugins/apps/plugins/website/plugins/crawlable/core";

/** The tips page, at `/about/tips`. */
export const tipsPage = defineWebsitePage({
  path: "/about/tips",
  title: "Tips",
  description:
    "Small things equin can do that you might not have found yet: short tips with a screenshot or a video, newest first.",
});
