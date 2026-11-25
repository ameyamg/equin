import { Mandate } from "@plugins/tasks/plugins/orchestration/plugins/mandate/server";
import { renderConfigPrompt } from "@plugins/config_v2/plugins/prompts/server";
import {
  watchChildren,
  watchTree,
} from "@plugins/tasks/plugins/orchestration/plugins/watch/plugins/capabilities/core";
import { watchPromptsConfig } from "@plugins/tasks/plugins/orchestration/plugins/watch/core";

// The one Mandate content no tool carries: how the agent paces itself while
// the tasks it filed run. The words are the user's (watchPromptsConfig).
export const watchChildrenCapability = Mandate.Capability({
  cap: watchChildren,
  describe: () => renderConfigPrompt(watchPromptsConfig, "childrenLine", {}),
});

export const watchTreeCapability = Mandate.Capability({
  cap: watchTree,
  describe: () => renderConfigPrompt(watchPromptsConfig, "treeLine", {}),
});
