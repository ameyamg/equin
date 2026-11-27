import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { ConfigV2 } from "@plugins/config_v2/server";
import { mainSlotsConfig } from "../shared/config";
import { drainSlowKind } from "./internal/drain-slow-kind";
import { slotsExhaustedKind } from "./internal/exhausted-kind";

export default {
  description:
    "Main's per-commit slots (the checkouts main and its compositions are built and served from; see the plugin's core and cli), server half: the main-slots config (drainReportAfterSec), the main-slot-drain-slow report kind (a process that kept an old slot busy past the threshold after its app switched away, one row per job), the main-slots-exhausted report kind (a build found no free slot and the draining ones at the leak limit, and waited). The daily main-slots.reclaim job is the reclaim sub-plugin's.",
  contributions: [
    ConfigV2.Register({ descriptor: mainSlotsConfig }),
    drainSlowKind,
    slotsExhaustedKind,
  ],
} satisfies ServerPluginDefinition;
