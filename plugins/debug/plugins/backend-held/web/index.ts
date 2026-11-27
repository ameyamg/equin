import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Reports } from "@plugins/reports/web";
import { BackendHeldSummary } from "./components/backend-held-summary";

export default {
  description:
    "Backend-held report renderer: a one-line Debug → Reports summary for the backend-held kind (the rule — silent or kept-alive —, the connection, the backend it holds up and for how long).",
  contributions: [
    Reports.KindView({
      match: "backend-held",
      component: BackendHeldSummary,
    }),
  ],
} satisfies PluginDefinition;
