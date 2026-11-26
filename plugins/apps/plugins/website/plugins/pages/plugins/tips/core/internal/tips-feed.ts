import { defineSiteFeed } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import { textField } from "@plugins/fields/plugins/text/plugins/config/core";
import { multilineTextField } from "@plugins/fields/plugins/multiline-text/plugins/config/core";
import { mediaField } from "@plugins/fields/plugins/media/core";
import { tipsPage } from "../page";

/** A tip's video can be a long screen recording: up to attachments' 500 MB ceiling. */
const TIP_MEDIA_MAX_BYTES = 500 * 1024 * 1024;

/**
 * equin's tips of the day — the only place that knows what a tip is. Written
 * in the Deploy app on the computer, published to the site's box, posted to
 * the community from there (title and text as the post, the media as its
 * files).
 */
export const tipsFeed = defineSiteFeed({
  id: "tips",
  label: "Tips of the day",
  fields: {
    title: textField({ label: "Title" }),
    body: multilineTextField({ label: "Text" }),
    media: mediaField({
      label: "Screenshots and videos",
      accept: ["image/*", "video/*"],
      max: 10,
      maxBytes: TIP_MEDIA_MAX_BYTES,
    }),
  },
  syndicate: { text: ["title", "body"], media: "media" },
  publicLimit: 60,
  pagePath: "/tips",
  localPagePath: tipsPage.path,
});

export type TipsFeed = typeof tipsFeed;
