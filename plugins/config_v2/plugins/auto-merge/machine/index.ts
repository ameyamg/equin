import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { autoMergePlaceJob } from "./internal/place";
import { autoMergePlaceWarmup } from "./internal/warmup";

export default {
  description:
    "The placement job of config's automatic merge (config-auto-merge.place): for each merge record whose merge placed rows an update added into a list the user changed, one Sonnet call asks for those lists' order as row keys only; the registry writes an answer that is a permutation keeping the user's rows in their order, on a list nobody changed since, and records every other answer as rejected (the merge's order stands). Skips quietly — recorded on the merge, the merge's order kept — with no Claude account that can run, at a usage limit, on a failed call, or once the merge was undone, superseded or edited. Queued at boot for every pending placement (the config-auto-merge.place warm-up).",
  register: [autoMergePlaceJob, autoMergePlaceWarmup],
} satisfies MachinePluginDefinition;
