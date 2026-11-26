import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";

export { ThreadReader } from "./components/thread-reader";

export default {
  description:
    "The Mail reader, web half: ThreadReader — one thread (mail.thread) as the reading pane draws it: the subject and message count, every message oldest first (the last and the unread open, the rest folded to a line), an HTML body in a fitted InlineFrame (an opaque origin, as tall as the message, under the mail policy: images only through this server's proxy and inline-part routes, no script of the body's, no form, frame or font load), a text body as text, each message's files opened in a tab or downloaded. Opening marks nothing read.",
  contributions: [],
} satisfies PluginDefinition;
