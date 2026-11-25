import { describe, expect, test } from "bun:test";
import {
  exitWhenPrompt,
  mandatePushLine,
  pushExitPromptsConfig,
  pushPolicyPrompt,
} from "./prompts";

// Today's words, captured from the constants the config replaced
// (PUSH_POLICY_TEXT / MANDATE_PUSH_POLICY_TEXT / EXIT_WHEN_TEXT): the
// defaults must render them byte for byte.
const prompts = pushExitPromptsConfig.defaults;

const PUSH = {
  "on-request":
    'Push only when the user asks you to, with `./equin push -m "…"` — never on your own initiative.',
  never:
    "Do NOT push. When the build is `ok`, stop and raise a flag so a person reviews the branch — say what changed and why.",
  safe: 'Push with `./equin push -m "…"` ONLY if the change is uncontroversial: small and local, no behaviour or API a person relies on changes, no design choice is left to make, and every check passes. **You are authorized to push such a change without asking.** Anything else: do NOT push — raise a flag that says what needs a decision.',
  checks:
    '**You are authorized to push this task\'s change without asking** once every check passes and the build is `ok`: `./equin push -m "…"`.',
} as const;

const EXIT = {
  "on-request":
    "When the user asks you to wrap up, you may close this conversation with `exit_clean` once your work landed and there is nothing they need to know. Never call it on your own: the conversation stays open for review.",
  "when-done":
    "Close this conversation with `exit_clean` on your own — without waiting to be asked — but only once the whole session is finished: your change pushed and the push landed (or, when your push policy keeps you from pushing, your flag raised), your outcome report submitted when your mandate requires one, no build, push, test or other `./equin` op still running, and nothing left to do. Submitting the report is not the end: if a push is still to run or in flight, finish it first (`./equin await <op>` until it settles) and only then close. Whoever supervises you can still message you: that resumes you.",
} as const;

describe("push and exit prompts render today's text", () => {
  for (const policy of ["on-request", "never", "safe", "checks"] as const) {
    test(`push policy ${policy}`, () => {
      expect<unknown>(pushPolicyPrompt(prompts, policy)).toBe(PUSH[policy]);
      expect<unknown>(mandatePushLine(prompts, policy)).toBe(
        `Pushing: ${PUSH[policy]}`,
      );
    });
  }
  for (const when of ["on-request", "when-done"] as const) {
    test(`exit ${when}`, () => {
      expect<unknown>(exitWhenPrompt(prompts, when)).toBe(EXIT[when]);
    });
  }
});
