import { Mandate } from "@plugins/tasks/plugins/orchestration/plugins/mandate/server";
import { getConfig } from "@plugins/config_v2/server";
import {
  exitClean,
  exitWhenPrompt,
  flagRaise,
  mandatePushLine,
  pushExitPromptsConfig,
  pushPolicy,
} from "@plugins/conversations/plugins/conversation-view/plugins/push-and-exit/plugins/capabilities/core";

/**
 * How each push-and-exit grant reads to the agent. The defaults say nothing:
 * pushing only when asked is CLAUDE.md's rule, and `exit_clean`'s own
 * description says it closes on request. A line only for a policy that
 * differs — the Mandate is the only channel for a push or a close on the
 * agent's own initiative (pushing is a CLI command, no tool describes it).
 * The words are `pushExitPromptsConfig`'s prompts, as the user saved them.
 */
export const pushAndExitCapabilities = [
  Mandate.Capability({
    cap: pushPolicy,
    describe: (policy) =>
      policy === "on-request"
        ? null
        : mandatePushLine(getConfig(pushExitPromptsConfig), policy),
  }),
  Mandate.Capability({
    cap: exitClean,
    describe: (when) =>
      when === "on-request"
        ? null
        : exitWhenPrompt(getConfig(pushExitPromptsConfig), when),
  }),
  Mandate.Capability({
    cap: flagRaise,
    describe: () => null,
  }),
];
