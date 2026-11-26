import { useLive } from "@plugins/network/plugins/live/web";
import {
  mapResource,
  type ResourceResult,
  type ResourceUnavailable,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import type { IntegrationStatus } from "@plugins/auth/web";
import { gmailPushStatus, type GmailPushStatus } from "../../core";

/** The Accounts row's badge for instant updates on this backend. */
export function pushIntegrationStatus(s: GmailPushStatus): IntegrationStatus {
  if (s.setup === null)
    return {
      tone: "muted",
      label: "Not set up",
      summary: "Mail checks for new mail on a timer while open",
    };
  switch (s.state.kind) {
    case "live":
      return {
        tone: "success",
        label: "On",
        summary: "Changes arrive as they happen",
      };
    case "starting":
    case "not-set-up":
      return { tone: "muted", label: "Connecting…" };
    case "down":
      return { tone: "warning", label: "Down", summary: s.state.message };
  }
}

export function useGmailPushIntegrationStatus():
  ResourceResult<IntegrationStatus> | ResourceUnavailable {
  return mapResource(useLive(gmailPushStatus), pushIntegrationStatus);
}
