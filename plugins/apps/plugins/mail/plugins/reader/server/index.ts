import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { rawEndpointHandler } from "@plugins/infra/plugins/endpoints/server";
import { mailAttachment, mailInlinePart } from "../core";
import { mailInlineImagesServed, mailThreadServed } from "./internal/served";
import { handleAttachment, handleInline } from "./internal/routes";

// The image proxy (machine/) signs nothing itself: it checks the URL the
// server signed, and answers with the same untrusted-bytes headers.
export { verifyMail } from "./internal/sign";
export { refused, UNTRUSTED_HEADERS } from "./internal/untrusted";

export default {
  description:
    "The Mail reader, server half: mail.thread — one thread from the Mail cache (its stored body while it holds the thread's messages, else fetched from the provider), every HTML body rewritten to work inside the reader's frame policy (remote images through the image proxy (machine/), cid: images through the inline-part route, links opening a tab, refreshes and link prefetches cut), re-read when the cache learns the thread moved — and the routes the reader loads mail through: the signed inline-part route the opaque-origin frame reaches (public, each URL an HMAC of what it names), and the attachment route (open or download), both parts kept in infra/attachments under a name-derived id.",
  contributions: [
    ...mailThreadServed.declare,
    ...mailInlineImagesServed.declare,
  ],
  httpRoutes: {
    [mailInlinePart.route]: rawEndpointHandler(mailInlinePart, handleInline),
    [mailAttachment.route]: rawEndpointHandler(
      mailAttachment,
      handleAttachment,
    ),
  },
} satisfies ServerPluginDefinition;
