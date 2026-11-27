import { defineServerContribution } from "@plugins/framework/plugins/server-core/core";
import type { ConfigDescriptor } from "@plugins/config_v2/core";
import type { BoolFieldDef } from "@plugins/fields/plugins/bool/plugins/config/core";
import type {
  BackupArchive,
  BackupSourceReport,
  BackupTargetResult,
} from "@plugins/backup/core";

export const BackupTarget = defineServerContribution<{
  id: string;
  name: string;
  /**
   * The target's own config, whose `enabled` field says whether it stores
   * archives. Read by the Backup health row: a schedule with no target
   * enabled backs up nowhere, so backup is not activated.
   */
  enabledBy: ConfigDescriptor<{ enabled: BoolFieldDef }>;
  run: (archive: BackupArchive) => Promise<BackupTargetResult>;
}>("backup.target", { docLabel: (p) => p.name });

export const BackupSource = defineServerContribution<{
  id: string;
  name: string;
  assemble: (dir: string) => Promise<BackupSourceReport>;
}>("backup.source", { docLabel: (p) => p.name });
