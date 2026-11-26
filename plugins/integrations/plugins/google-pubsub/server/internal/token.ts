import { getTokenFromCentral } from "@plugins/auth/server";
import { PUBSUB_SCOPES } from "../../core";

/** A pubsub-scoped Google token, or why there is none. */
export type PubSubTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; needsConsent: boolean; message: string };

/**
 * A pubsub-scoped token on the shared Google connection, via auth/central —
 * so a consumer never names the scope nor imports auth. `refused` is the
 * token Pub/Sub just answered 401 to (refreshed if still the stored one).
 * AuthCentralOfflineError propagates.
 */
export async function getPubSubToken(
  opts: { refused?: string } = {},
): Promise<PubSubTokenResult> {
  const res = await getTokenFromCentral({
    providerId: "google",
    scopes: [...PUBSUB_SCOPES],
    refused: opts.refused,
  });
  if (res.ok) return { ok: true, accessToken: res.accessToken };
  if (res.needsConsent)
    return {
      ok: false,
      needsConsent: true,
      message: `Pub/Sub access needs consent (${res.reason})`,
    };
  return { ok: false, needsConsent: false, message: res.message };
}
