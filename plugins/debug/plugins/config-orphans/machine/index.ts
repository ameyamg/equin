import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { configOrphansReportServed } from "./internal/report-resource";
import { handleDiscardConfigOrphan } from "./internal/discard";
import { discardConfigOrphanEndpoint } from "../shared/discard";
import {
  strandedConfigKind,
  strandedConfigWarmup,
} from "./internal/report-kind";

export default {
  description:
    "Audit of orphaned user-layer config files whose defineConfig descriptor is no longer live. Files one `config-orphans-stranded` report per stranded user override, once (a standing condition, not re-filed on every boot), and discards an orphan's files on request (POST /api/config-orphans/discard).",
  httpRoutes: {
    [discardConfigOrphanEndpoint.route]: handleDiscardConfigOrphan,
  },
  contributions: [strandedConfigKind, ...configOrphansReportServed.declare],
  // Drained after every plugin's onReady: the audit reads the full live config
  // registry.
  register: [strandedConfigWarmup],
} satisfies MachinePluginDefinition;
