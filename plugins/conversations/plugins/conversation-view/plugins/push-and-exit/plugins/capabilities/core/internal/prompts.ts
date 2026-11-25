import { defineConfig } from "@plugins/config_v2/core";
import {
  fillPrompt,
  promptField,
  type PromptText,
} from "@plugins/config_v2/plugins/prompts/core";
import type { ExitWhen, MandatePushPolicy, PushPolicy } from "./capabilities";

/**
 * What each push and exit policy tells the agent — in its `## Mandate`
 * section, in an automation's prompt (`{{pushPolicy}}`) and in the outcome
 * report's next step alike. Prompts the user edits (Settings → Config); the
 * code only picks which one applies (the renders below, handed the config's
 * values: `getConfig` on the server, `useConfig` on the web,
 * `descriptor.defaults` in a test). Registered by push-and-exit's server and
 * web barrels.
 */
export const pushExitPromptsConfig = defineConfig({
  name: "agent-instructions",
  fields: {
    pushOnRequest: promptField({
      label: "Push: on request",
      description:
        "The push policy of a task a person drives: push only when asked. Sent with the Send agent to update action of the updates row; the Mandate itself adds no line for it.",
      default:
        'Push only when the user asks you to, with `./equin push -m "…"` — never on your own initiative.',
    }),
    pushNever: promptField({
      label: "Push: never",
      description:
        "The push policy Never: the agent stops at a ready branch and raises a flag.",
      default:
        "Do NOT push. When the build is `ok`, stop and raise a flag so a person reviews the branch — say what changed and why.",
    }),
    pushSafe: promptField({
      label: "Push: if uncontroversial",
      description:
        "The push policy If uncontroversial: the agent pushes only a small, local change with no decision left to make.",
      default:
        'Push with `./equin push -m "…"` ONLY if the change is uncontroversial: small and local, no behaviour or API a person relies on changes, no design choice is left to make, and every check passes. **You are authorized to push such a change without asking.** Anything else: do NOT push — raise a flag that says what needs a decision.',
    }),
    pushChecks: promptField({
      label: "Push: when checks pass",
      description:
        "The push policy When checks pass: the agent pushes once every check passes.",
      default:
        '**You are authorized to push this task\'s change without asking** once every check passes and the build is `ok`: `./equin push -m "…"`.',
    }),
    mandatePushLine: promptField({
      label: "Mandate push line",
      description:
        "The line a push policy other than on request becomes in the agent's Mandate section.",
      default: "Pushing: {{policy}}",
      variables: [
        { name: "policy", description: "the push policy's own prompt" },
      ],
    }),
    exitOnRequest: promptField({
      label: "Exit: on request",
      description:
        "When the agent closes its conversation with exit_clean, for a task a person reviews in the open conversation. The Mandate itself adds no line for it.",
      default:
        "When the user asks you to wrap up, you may close this conversation with `exit_clean` once your work landed and there is nothing they need to know. Never call it on your own: the conversation stays open for review.",
    }),
    exitWhenDone: promptField({
      label: "Exit: when done",
      description:
        "When a supervisor's worker closes its own conversation with exit_clean: in its Mandate section.",
      default:
        "Close this conversation with `exit_clean` on your own — without waiting to be asked — but only once the whole session is finished: your change pushed and the push landed (or, when your push policy keeps you from pushing, your flag raised), no build, push, test or other `./equin` op still running, and nothing left to do. If a push is still to run or in flight, finish it first (`./equin await <op>` until it settles) and only then close. Whoever supervises you can still message you: that resumes you.",
    }),
  },
});

/** The prompt of {@link pushExitPromptsConfig} each automation push policy
 * reads as. */
export const PUSH_POLICY_PROMPT = {
  never: "pushNever",
  safe: "pushSafe",
  checks: "pushChecks",
} as const satisfies Record<PushPolicy, string>;

/** The prompt of {@link pushExitPromptsConfig} each mandate push policy
 * reads as. */
export const MANDATE_PUSH_POLICY_PROMPT = {
  "on-request": "pushOnRequest",
  ...PUSH_POLICY_PROMPT,
} as const satisfies Record<MandatePushPolicy, string>;

/** The prompt of {@link pushExitPromptsConfig} each exit policy reads as. */
export const EXIT_WHEN_PROMPT = {
  "on-request": "exitOnRequest",
  "when-done": "exitWhenDone",
} as const satisfies Record<ExitWhen, string>;

/** The config's values, as a reader holds them. */
export type PushExitPrompts = typeof pushExitPromptsConfig.defaults;

/** What a push policy tells the agent — an automation's `{{pushPolicy}}`. */
export function pushPolicyPrompt(
  prompts: PushExitPrompts,
  policy: MandatePushPolicy,
): PromptText {
  return fillPrompt(
    pushExitPromptsConfig,
    prompts,
    MANDATE_PUSH_POLICY_PROMPT[policy],
    {},
  );
}

/** The `## Mandate` line of a push policy (`Pushing: …`). */
export function mandatePushLine(
  prompts: PushExitPrompts,
  policy: MandatePushPolicy,
): PromptText {
  return fillPrompt(pushExitPromptsConfig, prompts, "mandatePushLine", {
    policy: pushPolicyPrompt(prompts, policy),
  });
}

/** What an exit policy tells the agent about closing with `exit_clean`. */
export function exitWhenPrompt(
  prompts: PushExitPrompts,
  when: ExitWhen,
): PromptText {
  return fillPrompt(pushExitPromptsConfig, prompts, EXIT_WHEN_PROMPT[when], {});
}
