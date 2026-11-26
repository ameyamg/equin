import type { HealthStatus } from "@plugins/shell/plugins/health-report/web";
import { releasesHealth } from "./releases-view";
import { usePublisher } from "./use-publisher";

/** The releases row's `useStatus`: the pushed publisher status, read resident. */
export function useReleasesHealth(): HealthStatus {
  return releasesHealth(usePublisher());
}
