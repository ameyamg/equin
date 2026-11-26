import { missingScopes, useAccountStatus } from "@plugins/auth/web";
import {
  mapResource,
  type ResourceResult,
  type ResourceUnavailable,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import { PUBSUB_SCOPES } from "../../core";

/** Whether the Google connection carries the Pub/Sub scope: `granted`, `missing` (grant it), or no Google account (`disconnected`). */
export type PubSubAccess = "granted" | "missing" | "disconnected";

/** The Pub/Sub scope on the shared Google connection, as a read (loading and failure are states). */
export function usePubSubAccess():
  ResourceResult<PubSubAccess> | ResourceUnavailable {
  return mapResource(useAccountStatus("google"), (account) => {
    if (account === null || !account.connected) return "disconnected";
    return missingScopes([...PUBSUB_SCOPES], account.scopes).length === 0
      ? "granted"
      : "missing";
  });
}
