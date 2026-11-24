import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { IdKinds } from "@plugins/ids/web";
import { decisionExchangeIdKind, decisionIdKind } from "../core";

export default {
  description:
    "Agent decisions, web half: registers the dec and dex id kinds. The surfaces (the inbox, the conversation tray, the page block) are its sub-plugins, in later phases.",
  contributions: [
    IdKinds.Kind({ kind: decisionIdKind }),
    IdKinds.Kind({ kind: decisionExchangeIdKind }),
  ],
} satisfies PluginDefinition;
