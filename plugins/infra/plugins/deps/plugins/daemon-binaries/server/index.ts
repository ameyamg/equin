import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { daemonRollbackKind } from "./internal/rollback-kind";

export default {
  description:
    "The daemon-binary-rollback report kind — filed through the report outbox by a host daemon's start script (the embedded Postgres, PgBouncer) when its start on the install main declares failed and it fell back to the last install it started on.",
  contributions: [daemonRollbackKind],
} satisfies ServerPluginDefinition;
