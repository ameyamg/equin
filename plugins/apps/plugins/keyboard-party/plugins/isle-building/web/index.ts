import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Isle } from "@plugins/apps/plugins/isle/plugins/buildings/web";
import { keyboardPartyApp } from "@plugins/apps/plugins/keyboard-party/plugins/shell/core";
import { partyTent } from "../core";

export default {
  description:
    "Keyboard Party's building on Isle: the party tent, a striped canvas big top with balloons at its sides and three giant keycaps (A, S, D) by the entrance \u2014 each goes down in turn with a puff of paper bits and a ring of the bell.",
  contributions: [
    Isle.Building({ app: keyboardPartyApp, building: partyTent }),
  ],
} satisfies PluginDefinition;
