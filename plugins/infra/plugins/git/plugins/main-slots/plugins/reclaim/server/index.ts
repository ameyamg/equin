import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { reclaimSlotsJob } from "./internal/reclaim-job";

export default {
  description:
    "The daily main-slots.reclaim job (main only): runs `./equin main-slots-reclaim` as a supervised child — the backstop reclaim for slots freed by a killed process, which no event announces.",
  register: [reclaimSlotsJob],
} satisfies ServerPluginDefinition;
