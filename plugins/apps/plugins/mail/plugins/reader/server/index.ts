import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { rawEndpointHandler } from "@plugins/infra/plugins/endpoints/server";
import { mailAttachment, mailImageProxy, mailInlinePart } from "../core";
import { mailThreadServed } from "./internal/served";
import { handleAttachment, handleImage, handleInline } from "./internal/routes";

export default {
  description:
    "The Mail reader, server half: mail.thread — one thread from the Mail cache (its stored body while it holds the thread's messages, else fetched from the provider), every HTML body rewritten to work inside the reader's frame policy (remote images through the image proxy, cid: images through the inline-part route, links opening a tab, refreshes and link prefetches cut), re-read when the cache learns the thread moved — and the routes the reader loads mail through: the signed image proxy and inline-part routes the opaque-origin frame reaches (public, each URL an HMAC of what it names), and the attachment route (open or download), both parts kept in infra/attachments under a name-derived id.",
  contributions: [...mailThreadServed.declare],
  httpRoutes: {
    [mailImageProxy.route]: rawEndpointHandler(mailImageProxy, handleImage),
    [mailInlinePart.route]: rawEndpointHandler(mailInlinePart, handleInline),
    [mailAttachment.route]: rawEndpointHandler(
      mailAttachment,
      handleAttachment,
    ),
  },
} satisfies ServerPluginDefinition;
