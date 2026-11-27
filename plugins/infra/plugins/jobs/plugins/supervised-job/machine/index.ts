import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { SupervisedCodeCurrency } from "../server";
import { runsMainsCurrentCodeOnThisMachine } from "./internal/code-currency";

export default {
  description:
    "Supervised jobs, desktop half: the code-currency probe an `acrossSwitch: { cancel }` job's start gate asks on main — whether this backend is the one main's gateway runs (main's spec names its slot) and its checkout at main's tip.",
  contributions: [
    SupervisedCodeCurrency({
      runsMainsCurrentCode: runsMainsCurrentCodeOnThisMachine,
    }),
  ],
} satisfies MachinePluginDefinition;
