import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Pane } from "@plugins/primitives/plugins/pane/web";
import { DebugApp } from "@plugins/apps/plugins/debug/plugins/shell/web";
import { ConfigV2 } from "@plugins/config_v2/web";
import { backupPane, backupRunPane } from "./panes";
import { BackupRunDetail } from "./slots";
import { backupConfig } from "../shared/config";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { HealthReport } from "@plugins/shell/plugins/health-report/web";
import { OpenBackupAction } from "./components/open-backup-action";
import { useBackupHealth } from "./internal/use-backup-health";

export { backupPane, backupRunPane } from "./panes";
export { BackupRunDetail } from "./slots";

export default {
  collapsed: true,
  description:
    "Backup orchestrator UI: run backups, view history, the health report's Backup row (green after a good backup, attention after a failed or partial one, hollow while backup is not activated), and open one run's detail pane — whose sections (what went into the archive, where it was dispatched to, and the Grant access repair for a target that lost its OAuth token) are contributed by the backup arm.",
  contributions: [
    ConfigV2.WebRegister({ descriptor: backupConfig }),
    Pane.Register({ pane: backupPane }),
    Pane.Register({ pane: backupRunPane }),
    DebugApp.Sidebar({
      id: "backup",
      title: "Backup",
      icon: symbol("backup"),
      opens: { pane: backupPane, params: {} },
    }),
    // Green while the latest backup went through, attention when it failed or
    // was partial; hollow (and out of the dot's merge) while backup is not
    // activated.
    HealthReport.Row({
      kind: "status",
      id: "backup",
      title: "Backup",
      useStatus: useBackupHealth,
      actions: OpenBackupAction,
    }),
  ],
  slots: {
    ...BackupRunDetail,
    backup: backupPane,
    "backup-run": backupRunPane,
  },
} satisfies PluginDefinition;
