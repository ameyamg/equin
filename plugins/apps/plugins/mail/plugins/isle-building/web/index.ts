import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Isle } from "@plugins/apps/plugins/isle/plugins/buildings/web";
import { mailApp } from "@plugins/apps/plugins/mail/plugins/shell/core";
import { pillarBox } from "../core";

export default {
  description:
    "Mail's building on Isle: a post office built as a giant cast-iron pillar box in faded post-office red (the app's colour only on its signal flag) — letters fly into its slot, the signal arm rises when one lands, a carrier pigeon comes and goes.",
  contributions: [Isle.Building({ app: mailApp, building: pillarBox })],
} satisfies PluginDefinition;
