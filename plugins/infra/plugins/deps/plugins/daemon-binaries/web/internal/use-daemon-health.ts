import { useLive } from "@plugins/network/plugins/live/web";
import type { HealthStatus } from "@plugins/shell/plugins/health-report/web";
import { daemonBinaries } from "../../core";
import { daemonBinariesVerdict } from "./daemon-health";

/** The health report's Daemon binaries row. One subscription to a pushed value. */
export function useDaemonBinariesHealth(): HealthStatus {
  return daemonBinariesVerdict(useLive(daemonBinaries));
}
