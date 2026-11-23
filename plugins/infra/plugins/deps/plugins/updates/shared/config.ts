import { defineAutomationConfig } from "@plugins/tasks/plugins/automations/core";
import { DEPS_UPGRADE_PROMPT } from "../core";

/**
 * The Dependency upgrades automation's config: off until the user turns it on
 * (every automation ships off); then weekly on Monday at 06:00 local, pushing once checks pass, with the upgrade prompt as its template.
 * Stored as `config/tasks/automations/deps-upgrades.origin.jsonc`.
 */
export const depsUpgradesConfig = defineAutomationConfig("deps-upgrades", {
  push: "checks",
  trigger: "schedule",
  cadence: "week",
  weekday: "mon",
  at: "06:00",
  prompt: DEPS_UPGRADE_PROMPT,
});
