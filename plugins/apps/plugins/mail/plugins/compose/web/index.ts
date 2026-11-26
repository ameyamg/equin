import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { ConfigV2 } from "@plugins/config_v2/web";
import { IdKinds } from "@plugins/ids/web";
import { mailComposeConfig, mailDraftIdKind } from "../core";

export { ComposeButton } from "./components/compose-button";
export { ComposeLayer, ComposeProvider } from "./components/compose-windows";
export { ReplyBox, type ReplyThread } from "./components/reply-box";

export default {
  description:
    "The Mail app's compose, web half: ComposeLayer — the compose windows over the Mail surface (the prototype's, bottom right: minimise, To / Cc / Bcc / Subject, the body with the account's signature as a block under it — removable for this message, Add signature puts it back — Send, Attach, Discard; closing saves the draft, an empty one is discarded; the c key) and the outbox pill (Sending… with Undo for the undo-send delay, which reopens the draft, then Message sent; a send given up reopens it with its reason) — ComposeButton (the sidebar's Compose) and ReplyBox (the reading pane's foot: Reply / Follow up, Reply all, Forward, or Continue writing on a draft; a reply written in place, Open in a window; the r, a and f keys). Every editor saves into its server draft as it is typed (mail.draft), which the server mirrors to the provider's drafts; registers the undo-send delay for Settings → Config.",
  contributions: [
    IdKinds.Kind({ kind: mailDraftIdKind }),
    ConfigV2.WebRegister({ descriptor: mailComposeConfig }),
  ],
} satisfies PluginDefinition;
