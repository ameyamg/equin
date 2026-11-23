import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { testFailingKind } from "./internal/kind";

export default {
  description:
    "The test-failing report kind: one row per test file failing on main's code (fingerprint = file path), filed by main's test runner once a second run of main's on the same code confirmed the failure. Category test, so the Broken tests supervisor stream owns it (one investigation task per report, in the backlog of the role it is routed to); a raised fan-out ceiling, so one push breaking many tests still files each; its task names the failing cases and the commit range where they started failing.",
  contributions: [testFailingKind],
} satisfies ServerPluginDefinition;
