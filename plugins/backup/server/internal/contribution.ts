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
   * archives. The run reads it: a disabled target is never run, and a run
   * with no target enabled is recorded `failed` (it would store nowhere).
   */
  enabledBy: ConfigDescriptor<{ enabled: BoolFieldDef }>;
  /** Store the archive. Called only while the target is enabled, so every
   *  result it gives is about a real attempt to store. */
  run: (archive: BackupArchive) => Promise<BackupTargetResult>;
}>("backup.target", { docLabel: (p) => p.name });

export const BackupSource = defineServerContribution<{
  id: string;
  name: string;
  assemble: (dir: string) => Promise<BackupSourceReport>;
}>("backup.source", { docLabel: (p) => p.name });
