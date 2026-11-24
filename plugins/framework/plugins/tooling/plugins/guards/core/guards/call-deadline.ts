import { envName } from "@plugins/infra/plugins/launcher/plugins/env-names/core";
import {
  callDeadline,
  isHandoffOp,
} from "@plugins/framework/plugins/cli/plugins/call-handoff/core";
import { defineGuard } from "../define-guard";
import { parseShell } from "../parse-shell";
import type { BashInput } from "../types";
import { longOpsIn } from "./background-ops";

/** The harness's ceiling for a foreground Bash call (ms). */
export const MAX_FOREGROUND_TIMEOUT_MS = 600_000;

/** The harness's default life for a background task when the call names none (ms). */
const DEFAULT_BACKGROUND_TIMEOUT_MS = 1_800_000;

/**
 * A call running a hand-off op (`build`, `push`, `check`, `test`) tells it when
 * the call will be cut off — foreground or background.
 *
 * The op runs off the call and hands itself off at that instant
 * (`cli/call-handoff`): it keeps running and the call ends with
 * `./equin await <op>` as the way to its verdict. Only this hook knows the
 * limit, so the command gets an `export` in front — `export`, not a `VAR=… cmd`
 * prefix, so every op of a chain shares the one deadline
 * (`./equin check a && ./equin test b`).
 *
 * The limit is the one in force when the call runs: a foreground call's is
 * raised to the 600 s ceiling first (no shorter limit serves an op); a
 * background call's was already raised by `background-timeout`, which runs
 * before this guard, so `input.timeout` is the 2 h ceiling.
 *
 * A rewrite, never a denial: it changes nothing the command does before the
 * deadline, and after it, it is the difference between a handle and none.
 */
export const callDeadlineGuard = defineGuard<BashInput>({
  name: "call-deadline",
  matcher: "Bash",
  check(input) {
    const cmd = input.command;
    if (!cmd) return null;
    if (!longOpsIn(parseShell(cmd)).some(isHandoffOp)) return null;
    const background = input.run_in_background === true;
    const timeout = background
      ? (input.timeout ?? DEFAULT_BACKGROUND_TIMEOUT_MS)
      : MAX_FOREGROUND_TIMEOUT_MS;
    const deadline = callDeadline(Date.now(), timeout);
    return {
      rewrite: {
        timeout,
        command: `export ${envName("CALL_DEADLINE")}=${deadline}; ${cmd}`,
      },
      note: null,
    };
  },
});
