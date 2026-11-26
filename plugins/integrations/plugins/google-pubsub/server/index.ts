import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";

export {
  createPubSubClient,
  messageText,
  PUBSUB_API_ROOT,
  subscriptionName,
  topicName,
  type PubSubClient,
  type PubSubClientOptions,
} from "./internal/client";
export { PUBSUB_PULL_MAX, type ReceivedMessage } from "./internal/schemas";
export { getPubSubToken, type PubSubTokenResult } from "./internal/token";

export default {
  description:
    "Stateless Google Cloud Pub/Sub REST client: createPubSubClient({ accessToken }) — ensureTopic, grantOnTopic (an IAM binding, read-modify-write under the etag), ensureSubscription (a pull subscription, optionally expiring when idle), deleteSubscription, a held pull and acknowledge, every answer zod-parsed and a refusal a PubSubApiError (status, reason, the activation link when the project has the API off); getPubSubToken brokers the pubsub scope on the shared Google connection.",
} satisfies ServerPluginDefinition;
