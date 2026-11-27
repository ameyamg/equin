import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import {
  ExcludeFromBackup,
  ExcludeFromFork,
} from "@plugins/database/plugins/admin/server";
import { CACHE_TABLES } from "../server";

export default {
  description:
    "The Mail cache, desktop half: its tables' exclusion from worktree DB forks and backups (a cache is re-read from the provider on demand) — the computer's database admin, which a browser host has none of.",
  contributions: CACHE_TABLES.flatMap((table) => [
    ExcludeFromFork({
      table,
      reason:
        "Mail cache: a worktree reads its own from the provider on demand (a copy would share main's change cursor).",
    }),
    ExcludeFromBackup({
      table,
      reason: "Mail cache: re-read from the mail provider on demand.",
    }),
  ]),
} satisfies MachinePluginDefinition;
