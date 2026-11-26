import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";

export {
  usePubSubAccess,
  type PubSubAccess,
} from "./internal/use-pubsub-access";
export { PubSubGrantButton } from "./internal/pubsub-grant-button";

export default {
  description:
    "The Pub/Sub scope on the shared Google connection, web half: usePubSubAccess() (granted / missing / disconnected, as a read) and PubSubGrantButton (the scope-grant popup), so a consumer never imports auth nor names the scope.",
} satisfies PluginDefinition;
