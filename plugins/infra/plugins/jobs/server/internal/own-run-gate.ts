import { armAwakeDeadline } from "@plugins/packages/plugins/deadline/core";
import { runTracked } from "@plugins/infra/plugins/runtime-profiler/core";
import { zombieAfterMsFor } from "../../core";
import type { JobRowOpts, QueuedJob } from "./queue";
import type { JobTaskPayload, ScheduleSpec } from "./registry";
import { singletonJobKey } from "./run-identity";

// A scheduled job never runs beside itself.
//
// `dedup: "singleton"` bounds PENDING rows only: the moment a run's row is
// locked it releases its key, so the next cron tick (or a manual `enqueue()`)
// inserts a fresh row that any free slot fetches at once — a second run of the
// same job, beside the first. On a laptop that sleeps most of each hour that is
// the common case, not an edge: a run needs AWAKE time while its cron follows
// the wall clock. `worktree.fsmonitor-reconcile` had up to four passes at once
// doing the same work and failing each other on shared locks (2026-11-22);
// `debug.tab-memory-climb` ran two ticks queued ten minutes apart together
// after a wake.
//
// No scheduled job wants that: its work is "bring the current state up to
// date", and a run that starts while another is live repeats it. So the rule
// belongs to the scheduled-job type, not to each job remembering `serial`.
//
// THE MECHANISM — a row of a scheduled job that is dispatched while a run of
// the same job is live in this queue does not run. It FOLDS into the live run:
// its row completes at once (holding a slot for the instant it takes to say
// so — never waiting in one, see `SerialSpec` on why that is the bug), and the
// live run, when it ends, enqueues ONE trailing run with the newest folded
// payload. However many ticks or enqueues land mid-run, the job runs again
// exactly once afterwards — what a pending `serial` row would have given,
// without its costs:
//
// - no graphile queue per scheduled job. graphile 0.18 hardcodes its fetch
//   strategy 2, whose fetch row-locks EVERY available named queue
//   (`dist/sql/getJobs.js`: `job_queue_id in (select id … where is_available
//   for update skip locked)`), so ~120 more queues (one per schedule) would be
//   ~120 more row locks on every fetch of every row, and concurrent fetchers
//   would skip each other's queues for longer;
// - no graphile flag (`forbiddenFlags`) either: graphile's cron inserts its
//   ticks with `flags` NULL (`dist/cron.js`), so the tick — the main case —
//   could never carry one.
//
// LIVENESS is the process's own: a claim is an entry in this process's memory,
// held for the handler's lifetime (`release` on every exit). A crashed backend
// takes its claims with it — the next one starts with none, and the stuck-lock
// sweeper re-runs the dead run's row. A handler that never settles cannot hold
// its job's schedule forever: the claim lets go by itself once the run has
// been a zombie's age — the hold class's deadline plus the unwind grace
// (`zombieAfterMsFor`), on AWAKE time, so a sleep neither spends nor stalls it
// — the instant the desktop writes its slot off. The next run then starts
// beside the zombie, as every run did before this gate. That bound is the
// gate's own, so the in-process queue, which has no deadline, gets it too.
//
// A run that THREW requeues nothing: its retry (or, once it is dead, the next
// tick) is the later run its folds asked for. Queuing one anyway would retire
// the failing row while it is still locked (graphile clears a locked row's
// key and supersedes it), handing the job a fresh retry budget on every fold.
//
// Scope: one queue in one process. Every desktop backend runs its own worker
// against its own database, as `serial` does; a deploy's old and new backends
// overlap only while the old one drains.
//
// It covers a run's FIRST dispatch. A resume row (`payload.workflowRunId` set
// — `jobs.resume` bringing a suspended workflow back) is not gated: it is the
// continuation of a run that already started, its payload is that run's own
// and must not be collapsed into a tick's. A suspend ends its dispatch and so
// its claim, so a tick landing while a resumed run (a `defineSupervisedJob`,
// a `ctx.sleep`) is live still runs beside it — as before this gate.

/** What the gate needs to know about the job a row belongs to. */
export interface GatedJob extends QueuedJob {
  schedule?: ScheduleSpec;
  maxAttempts: number;
}

/** How a gated run ended, for its `release`. */
export type OwnRunEnd =
  /** Completed or suspended: queue the trailing run, if anything folded. */
  | "settled"
  /** Threw: its retry (or the next tick) is the later run — queue nothing. */
  | "threw";

/** What a dispatch may do with its row. */
export type OwnRunEntry =
  /** Run it, and call `release` once the handler is over (every exit path;
   *  idempotent, and a no-op once the claim let go by itself). Its promise is
   *  the trailing enqueue, if any. */
  | { kind: "run"; release: (end: OwnRunEnd) => Promise<void> }
  /** A run of the same job is live: complete the row without running it —
   *  the live run enqueues one trailing run when it ends. */
  | { kind: "folded" };

/** How the gate inserts the trailing run: the queue's own `enqueue`. */
export type RequeueRow = (
  job: QueuedJob,
  payload: JobTaskPayload,
  opts: JobRowOpts,
) => Promise<unknown>;

export interface OwnRunGate {
  enter(job: GatedJob, payload: JobTaskPayload): OwnRunEntry;
  /** Job names with a live claim — for tests and introspection. */
  live(): readonly string[];
}

/** Whether a row of `job` is held to one run at a time. */
export function runsAlone(job: GatedJob, payload: JobTaskPayload): boolean {
  return job.schedule !== undefined && payload.workflowRunId === undefined;
}

const UNGATED: OwnRunEntry = { kind: "run", release: async () => {} };

interface Claim {
  /** The newest payload folded into it, or null when nothing asked for a run
   *  since it started. */
  trailing: JobTaskPayload | null;
  cancelBound: () => void;
}

/**
 * One gate per queue (the desktop worker holds one; each in-process queue its
 * own). `requeue` is that queue's insertion: the trailing run is an ordinary
 * singleton row, so it collapses with a tick already pending. A folded row's
 * own `maxAttempts` override is not carried: the trailing run takes the job's.
 */
export function createOwnRunGate(
  requeue: RequeueRow,
  opts: {
    /** The awake-time timer the bound is armed on (injected for tests). */
    armBound?: (budgetMs: number, onExpire: () => void) => () => void;
  } = {},
): OwnRunGate {
  const armBound = opts.armBound ?? armAwakeDeadline;
  const claims = new Map<string, Claim>();

  function letGo(job: GatedJob, claim: Claim, end: OwnRunEnd): Promise<void> {
    // Only this claim's own release acts: a second call, or one arriving
    // after the bound already let a newer claim in, is a no-op.
    if (claims.get(job.name) !== claim) return Promise.resolve();
    claims.delete(job.name);
    claim.cancelBound();
    const trailing = claim.trailing;
    if (trailing === null || end === "threw") return Promise.resolve();
    return requeue(job, trailing, {
      jobKey: singletonJobKey(job.name),
      maxAttempts: job.maxAttempts,
    }).then(() => undefined);
  }

  return {
    enter(job, payload) {
      if (!runsAlone(job, payload)) return UNGATED;
      const live = claims.get(job.name);
      if (live !== undefined) {
        live.trailing = payload;
        return { kind: "folded" };
      }
      const claim: Claim = { trailing: null, cancelBound: () => {} };
      claims.set(job.name, claim);
      // The run is still going (it never settled): its folds' trailing run is
      // queued now and runs beside it. A failed enqueue is an unhandled
      // rejection — loud, filed by the reports plugin.
      claim.cancelBound = armBound(
        zombieAfterMsFor(job.hold),
        () =>
          void runTracked(`jobs.own-run-bound:${job.name}`, () =>
            letGo(job, claim, "settled"),
          ),
      );
      return { kind: "run", release: (end) => letGo(job, claim, end) };
    },
    live() {
      return [...claims.keys()];
    },
  };
}
