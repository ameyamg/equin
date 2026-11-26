import { useLive } from "@plugins/network/plugins/live/web";
import type { HealthStatus } from "@plugins/shell/plugins/health-report/web";
import { mailAccountStatus } from "../../core";
import { mailHealth } from "./status-view";

/** The Mail row's `useStatus`: the pushed account status. */
export function useMailHealth(): HealthStatus {
  return mailHealth(useLive(mailAccountStatus));
}
