import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";

export { recordRefusal } from "./internal/record-refusal";
export type { RefusalLine } from "./internal/record-refusal";

export default {
  description:
    "Records every 4xx the serving backend answers into the http-refusals log channel (route key, method, path, status, body excerpt), so refusals can be counted per route and status — stage 0 of declared refusals.",
} satisfies ServerPluginDefinition;
