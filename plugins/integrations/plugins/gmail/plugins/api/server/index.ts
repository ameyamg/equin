import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";

export {
  createGmailClient,
  type GmailClient,
  type GmailHistoryPage,
  type GmailHistoryType,
  type GmailLabelChange,
  type GmailLabelInput,
  type GmailListQuery,
  type GmailOutgoing,
  type GmailReadFormat,
  type GmailThreadFormat,
} from "./internal/client";
export {
  GMAIL_API_ROOT,
  type GmailBatchResult,
  type GmailCallOptions,
  type GmailTransportOptions,
} from "./internal/transport";

export default {
  description:
    "Stateless typed Gmail REST client: createGmailClient({ accessToken, pacer }) — profile, labels, threads, messages, history (an expired cursor is a typed outcome), drafts, send (multipart upload), attachments, modify and watch; reads batched ≤50 per HTTP request with a per-id result; every call charged on the account's quota pacer before it is sent and retried within a bound on Google's 429 / 5xx / rate-limit 403; every answer zod-parsed.",
} satisfies ServerPluginDefinition;
