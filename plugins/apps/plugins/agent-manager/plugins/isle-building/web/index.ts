import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Isle } from "@plugins/apps/plugins/isle/plugins/buildings/web";
import { agentManagerApp } from "@plugins/apps/plugins/agent-manager/plugins/shell/core";
import { forge } from "../core";

export default {
  description:
    "The Agent Manager's building on Isle: the automaton works — a factory of riveted copper and brass plate under a sawtooth roof of north lights, a round furnace port in each gable, two iron stacks and a brass signal mast, its bay open on the forge — where brass automata work: a smith at the anvil, one assembled piece by piece that wakes (the whistle blows) and walks out to the charging rack, a clerk ticking off the task slate, a carrier with crates, and a rail carrying half-built automata out of the bay.",
  contributions: [Isle.Building({ app: agentManagerApp, building: forge })],
} satisfies PluginDefinition;
