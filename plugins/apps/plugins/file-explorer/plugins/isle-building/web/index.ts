import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Isle } from "@plugins/apps/plugins/isle/plugins/buildings/web";
import { fileExplorerApp } from "@plugins/apps/plugins/file-explorer/plugins/shell/core";
import { filingChest } from "../core";

export default {
  description:
    "The File Explorer's building on Isle: the filing chest — an oak chest of nine brass-labelled drawers under a manila-folder roof, a drawer rolling out, a folder hoisted from it and put back.",
  contributions: [
    Isle.Building({ app: fileExplorerApp, building: filingChest }),
  ],
} satisfies PluginDefinition;
