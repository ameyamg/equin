import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Item } from "@plugins/conversations/plugins/conversation-ui/plugins/item/web";
import { DecisionsItemChip } from "./components/decisions-item-chip";

export default {
  description:
    "Per-row decisions chip on a conversation item: how many of its task's decisions need the user (one grouping of the Needs you tab by task, shared by every row). Nothing while zero.",
  contributions: [
    Item.Chips({ id: "decisions", component: DecisionsItemChip }),
  ],
} satisfies PluginDefinition;
