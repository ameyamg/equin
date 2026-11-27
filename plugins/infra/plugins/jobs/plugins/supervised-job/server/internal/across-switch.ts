import { isMain } from "@plugins/infra/plugins/runtime-identity/core";
import { defineServerContribution } from "@plugins/framework/plugins/server-core/core";
import { envEntries } from "@plugins/infra/plugins/launcher/plugins/env-names/core";
import type { LogChannel } from "@plugins/primitives/plugins/log-channels/server";
import { builtinLedgerFor } from "./builtin-ledger";
import { killSupervisedRun } from "./run/supervisor";
import type { SupervisedRunKind } from "./run/registry";

/**
 * What becomes of a run when main's code moves on — main advances, its new
 * backend boots from another slot, and the backend that started the run
 * (and the slot its child runs from) is left behind. Every supervised job
 * says which, with the reason in words; the type has no default, so a new
 * job cannot leave it unsaid.
 *
 * - **`finish`** — the work stays valid on any commit (a database fork, a
 *   spare checkout, a build, the type-check backstop's comparison): the run
 *   finishes in the slot it started from, and the next backend re-attaches it
 *   (its boot reconcile adopts every unfinished run). The child's slot hold is
 *   marked `outlives` (`SLOT_OUTLIVES_SWITCH`, main-slots/boot-lease), so it is
 *   never filed as a slow drain; its slot still counts toward the draining
 *   limit. The reason says why outliving the switch is correct.
 * - **`cancel`** — the work is ABOUT the code main serves (a measurement of
 *   the deploy, a test batch of the checkout): run by a backend main has
 *   left, its answer is owed nobody. On main such a run never starts in a
 *   backend that does not run main's current code ({@link
 *   runsMainsCurrentCode}: from the advance to its new backend's boot, a
 *   backend main switched away from, a failed deploy until the next one),
 *   and a new backend cancels every one a previous backend left running. It
 *   is not re-run: the reason says who asks for it again on the new code
 *   (its own boot hook, the next trigger). Built-in ledger only — the
 *   cancel is the ledger's `cancelled_at` stamp, so the run closes `done`,
 *   never retried or dead-lettered.
 *
 * Not expressible here, on purpose: cancelling a run AND re-running it on the
 * new code. Old and new backend share main's job queue while they overlap, so
 * a deferred or re-enqueued run can be dispatched by the old one again; that
 * needs code-generation-aware dispatch, not a declaration.
 */
export type AcrossSwitch =
  | { readonly finish: string; readonly cancel?: never }
  | { readonly cancel: string; readonly finish?: never };

/** `finish` only: what a job with an own ledger, or `steps`, may declare. */
export type AcrossSwitchFinish = { readonly finish: string };

/** Refuses an empty reason — the reason is the declaration. */
export function assertAcrossSwitch(
  jobName: string,
  policy: AcrossSwitch,
): void {
  const reason = policy.finish ?? policy.cancel;
  if (typeof reason !== "string" || reason.trim() === "") {
    throw new Error(
      `[supervised-job] ${jobName}: acrossSwitch needs a reason — say why the run may finish across main's switch, or who asks for it again once it is cancelled.`,
    );
  }
}

/** The environment a child of `policy` starts with, beside its own. */
export function acrossSwitchEnv(policy: AcrossSwitch): Record<string, string> {
  return policy.finish !== undefined
    ? envEntries({ SLOT_OUTLIVES_SWITCH: "1" })
    : {};
}

/**
 * The answer to "does this backend still run main's current code?" — how a
 * host knows is the computer's business (main's spec, its slots' `current`
 * link, git), so it is contributed by this plugin's `machine/` half; a host
 * without one (a browser host) never runs main. See {@link runsMainsCurrentCode}.
 */
export interface CodeCurrencyProbe {
  runsMainsCurrentCode(): Promise<boolean>;
}

export const SupervisedCodeCurrency =
  defineServerContribution<CodeCurrencyProbe>("supervised-job.code-currency");

/**
 * Whether this backend still runs main's current code — the start gate of an
 * `acrossSwitch: { cancel }` job. Off main, always. On main, the one
 * contributed probe answers (the desktop's: `machine/`'s
 * `runsMainsCurrentCodeOnThisMachine`): false from main's advance until its
 * new backend takes over, for a backend main has switched away from, and
 * after a failed deploy until the next one.
 */
export async function runsMainsCurrentCode(): Promise<boolean> {
  if (!isMain()) return true;
  const probes = SupervisedCodeCurrency.getContributions();
  if (probes.length !== 1) {
    throw new Error(
      `[supervised-job] main needs exactly one code-currency probe (supervised-job's machine/), found ${probes.length}`,
    );
  }
  return probes[0]!.runsMainsCurrentCode();
}

interface CancelJob {
  readonly jobName: string;
  readonly kind: SupervisedRunKind;
  readonly channel: LogChannel;
}

const cancelJobs = new Map<string, CancelJob>();

/** Called at define time for every `cancel` job. */
export function registerCancelAcrossSwitch(job: CancelJob): void {
  cancelJobs.set(job.jobName, job);
}

/**
 * Main's boot: cancel every open run of a `cancel` job a previous backend
 * started (claimed before this process began) — it serves code this backend
 * does not, from that backend's slot. Stamped `cancelled_at` first, then
 * signalled, so its wake records a cancellation (no retry, no dead-letter).
 *
 * A previous backend claims no such run from main's advance on (the start
 * gate), at least a build before this boot, so an open row here has long
 * had its child's pid. A crash restart on unchanged code cancels its runs
 * too (rare: nothing tells the two apart without the run's checkout).
 */
export async function cancelRunsLeftByOlderBackends(): Promise<void> {
  if (!isMain()) return;
  const before = new Date(performance.timeOrigin);
  for (const job of cancelJobs.values()) {
    const ids = await builtinLedgerFor(job.jobName).markCancelledStartedBefore(
      before,
    );
    for (const runId of ids) {
      const outcome = await killSupervisedRun(job.kind, runId);
      job.channel.publish(
        `[supervised-job] ${job.jobName}: cancelled run ${runId}, left by a previous backend (its work is about the code main has left): ${outcome.ok ? `signalled pid ${outcome.pid}` : outcome.reason}`,
      );
    }
  }
}
