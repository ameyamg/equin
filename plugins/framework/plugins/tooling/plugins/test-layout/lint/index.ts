import bunSyncSettleMatchers from "./bun-sync-settle-matchers";
import noRegisteredPartialFake from "./no-registered-partial-fake";
import type { LintContribution } from "@plugins/framework/plugins/tooling/plugins/lint/core";

export default {
  name: "test-layout",
  rules: {
    "bun-sync-settle-matchers": bunSyncSettleMatchers,
    "no-registered-partial-fake": noRegisteredPartialFake,
  },
} satisfies LintContribution;
