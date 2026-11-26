import { z } from "zod";
import { blob, defineEndpoint } from "@plugins/infra/plugins/endpoints/core";

// The routes a reader's page loads mail through. The two the mail frame loads
// (an image proxied, an inline part) are reached from the frame's opaque
// origin — an anonymous caller to the gateway — so they are public, each
// URL carrying the server's own signature over what it names: only a URL the
// server wrote into a body it rendered is served. The attachment route is the
// page's own (owner), opened in a tab or downloaded.

/** A remote image of a mail body, fetched by the server so the sender never sees the reader's address. */
export const mailImageProxy = defineEndpoint({
  route: "GET /api/mail/image/:sig",
  query: z.object({ u: z.string() }),
  response: blob(),
  access: {
    public:
      "loaded by a mail body's opaque-origin frame (anonymous to the gateway); authenticated by the server's own HMAC over the URL, minted when it rendered the body",
  },
});

/** An inline part (a `cid:` image) of a message, for the mail frame. */
export const mailInlinePart = defineEndpoint({
  route: "GET /api/mail/inline/:sig",
  query: z.object({ t: z.string(), m: z.string(), p: z.string() }),
  response: blob(),
  access: {
    public:
      "loaded by a mail body's opaque-origin frame (anonymous to the gateway); authenticated by the server's own HMAC over the thread, message and part, minted when it rendered the body",
  },
});

/** One attachment of a message, opened in a tab or (`download`) saved. */
export const mailAttachment = defineEndpoint({
  route: "GET /api/mail/attachment/:threadId/:messageId/:partId",
  query: z.object({ download: z.literal("1").optional() }),
  response: blob(),
});
