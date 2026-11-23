import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { HealthReport } from "@plugins/shell/plugins/health-report/web";
import { DaemonBinariesDetail } from "./components/daemon-binaries-detail";
import { useDaemonBinariesHealth } from "./internal/use-daemon-health";

export default {
  description:
    "The health report's Daemon binaries row: ok while each host daemon (the embedded Postgres, PgBouncer) runs what main's checkout declares — with a note for a version it takes at its next start — and attention when a start on main's version failed and fell back to the previous install; expanded, the error and the `./equin deps remove <id>` command that retries it.",
  contributions: [
    HealthReport.Row({
      kind: "status",
      id: "daemon-binaries",
      title: "Daemon binaries",
      useStatus: useDaemonBinariesHealth,
      component: DaemonBinariesDetail,
    }),
  ],
} satisfies PluginDefinition;
