import type { ReactNode } from "react";
import { defineDispatchSlot } from "@plugins/primitives/plugins/slot-render/web";
import { PlainWebLink } from "./internal/plain-web-link";

/** A web link in a transcript: an absolute http(s) URL on another origin. */
export type WebLinkProps = { href: string; children?: ReactNode } & Record<
  string,
  unknown
>;

export const MarkdownExtensions = {
  /**
   * How a transcript draws a web link — a plugin that can show the page
   * in-app contributes its link (`match: "web"`). With none, a web link is a
   * plain link that opens the site in a new browser tab, so a host without an
   * in-app web view (the website's demo) needs nothing.
   */
  WebLink: defineDispatchSlot<WebLinkProps, "web">({
    key: () => "web",
    fallback: PlainWebLink,
  }),
};
