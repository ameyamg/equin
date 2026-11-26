import { MandateDefinitions } from "@plugins/tasks/plugins/orchestration/plugins/mandate/plugins/definitions/server";
import { withGrants } from "@plugins/tasks/plugins/orchestration/plugins/mandate/plugins/policy/core";
import { contextCompact } from "@plugins/conversations/plugins/self-compact/plugins/capability/core";
import { registeredAutomations } from "./registry";
import { automationSettings } from "./settings";

/**
 * Every registered automation's named mandate (`automation:<id>`): it grants
 * the automation's `spec.mandate` of its CURRENT settings, so a change in its
 * config (its Push setting) reaches every tree it filed or launched.
 *
 * Every automation's agents may compact themselves (`context.compact`),
 * added here rather than by each spec: the context nudge (runtime-sdk) asks
 * every agent past its threshold to call `compact_context`, whatever its
 * mandate, so no automation may lack it.
 */
export const automationMandates = MandateDefinitions.Source({
  id: "automations",
  definitions: () =>
    registeredAutomations().map((a) => ({
      mandate: a.mandate,
      policy: () =>
        withGrants(a.spec.mandate(automationSettings(a.spec)), [
          contextCompact.grant(true),
        ]),
    })),
});
