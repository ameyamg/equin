import { resolveUpstreamRemote } from "@plugins/infra/plugins/git/plugins/remotes/core";
import { isMain } from "@plugins/infra/plugins/runtime-identity/core";
import { getWorktreeRoot } from "@plugins/infra/plugins/spawn/core";
import { watchedRepos } from "../../server";
import {
  markForwardersOff,
  markNotSetUp,
  startForwarders,
  stopForwarders,
} from "./forwarders";
import { resolveGhTools } from "./gh";
import { reportServerError } from "@plugins/framework/plugins/server-core/core";
import { onSleepReadingChanged } from "@plugins/infra/plugins/host/plugins/machine-sleep/server";
import { crashFieldsOf } from "@plugins/packages/plugins/error-subject/core";
import { clockStampNow } from "@plugins/packages/plugins/sleep-clock/core";
import { defineLogSink } from "@plugins/primitives/plugins/log-channels/server";
import { catchUp } from "./catch-up";
import { createCatchUpLedger } from "./catch-up-owed";

const githubEventsLog = defineLogSink({
  id: "github-events",
  description:
    "GitHub event forwarding on main: a catch-up a machine sleep cut off, and that it was run again.",
});

/**
 * The catch-ups owed by the running forwarders (`./catch-up-owed`): a ping
 * owes one, a wake retries what is still owed.
 */
export const catchUps = createCatchUpLedger({
  catchUp: (repo) => catchUp(runningGh(), repo),
  // Only the sleep half: the ledger compares two sleep readings, no wall instant.
  sleepStamp: () => clockStampNow().sleep,
  report: (repo, err) =>
    reportServerError({
      message: `[github-events] catching up ${repo} after its forwarder connected failed (owed until one succeeds: run again at its next reconnect or the next wake): ${err instanceof Error ? err.message : String(err)}`,
      ...crashFieldsOf(err, `github-events:catch-up:${repo}`),
    }),
  log: (line) => githubEventsLog.publish(line),
});

/** Unsubscribes the wake retry; `null` while no forwarder runs. */
let stopWakeRetry: (() => void) | null = null;

/** The gh binary the running forwarders use; `null` while none runs. */
let ghBin: string | null = null;

/** The gh binary the running forwarders use, for the API reads deliveries trigger. */
export function runningGh(): string {
  if (ghBin === null)
    throw new Error(
      "[github-events] no forwarder runs on this backend: a delivery cannot have been verified",
    );
  return ghBin;
}

/**
 * Start the forwarders when this backend is main's on the checkout that
 * publishes releases (no upstream: it IS the canonical repo) — on every
 * other backend and checkout nothing runs and the status is `off`.
 */
export async function startGitHubEvents(): Promise<void> {
  if (!isMain()) return markForwardersOff();
  const upstream = await resolveUpstreamRemote(await getWorktreeRoot());
  if (upstream.kind !== "none" || upstream.reason !== "is-publisher")
    return markForwardersOff();
  const tools = await resolveGhTools();
  if (tools.kind === "not-set-up") return markNotSetUp(tools.reason, tools.fix);
  ghBin = tools.tools.gh;
  stopWakeRetry = onSleepReadingChanged(() => catchUps.retryOwed());
  startForwarders(tools.tools, watchedRepos());
}

export async function stopGitHubEvents(): Promise<void> {
  stopWakeRetry?.();
  stopWakeRetry = null;
  catchUps.forgetAll();
  await stopForwarders();
  ghBin = null;
}
