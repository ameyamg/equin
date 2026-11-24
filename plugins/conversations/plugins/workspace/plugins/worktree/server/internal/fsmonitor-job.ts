import { z } from "zod";
import {
  defineJob,
  NonRetryableError,
  type SerialSpec,
} from "@plugins/infra/plugins/jobs/server";
import { openSupervisedRuns } from "@plugins/infra/plugins/jobs/plugins/supervised-job/server";
import { defineWarmup } from "@plugins/infra/plugins/warmup/server";
import { MAIN_WORKTREE_NAME } from "@plugins/infra/plugins/namespace/core";
import { runtimeNamespace } from "@plugins/infra/plugins/runtime-identity/core";
import { defineLogSink } from "@plugins/primitives/plugins/log-channels/server";
import { ConversationStatusSchema } from "@plugins/tasks/plugins/tasks-core/core";
import {
  attemptRetention,
  getConversation,
} from "@plugins/tasks/plugins/tasks-core/server";
import {
  ensureMainWorktreeRoot,
  gitWorktreesDir,
  isCanonicalWorktreeName,
  isUnfinishedEntry,
  listWorktreeEntries,
  type WorktreeEntry,
} from "@plugins/infra/plugins/worktree/server";
import {
  describeFsmonitorReconcile,
  reconcileCheckoutFsmonitors,
  type FsmonitorCheckout,
} from "@plugins/infra/plugins/git/plugins/fsmonitor/server";
import {
  onCheckoutWatchOpened,
  watchedCheckoutRoots,
} from "@plugins/infra/plugins/git/plugins/checkout-watch/server";
import type { CheckoutTier } from "@plugins/infra/plugins/git/plugins/index-refresh/server";
import { worktreePrepareJob } from "./prepare-job";

const fsmonitorLog = defineLogSink({
  id: "worktree-fsmonitor",
  description:
    "Main's and the agent checkouts' git fsmonitor daemons: one line per pass, and per closed checkout released — how many are on, which were started, stopped or had their index token renewed, and any failure.",
});

/**
 * The one lane of everything here that changes a checkout's daemon: two at
 * once ask the same daemons the same question and race for the same
 * `config.worktree.lock`.
 */
const DAEMONS_LANE: SerialSpec = { with: "worktree-fsmonitor" };

/**
 * Keeps git's fsmonitor daemon running for main's own checkout (always) and
 * for exactly the attempt checkouts in use — retained (`attempts_v.retained`)
 * or read now (a checkout watch open in this backend: {@link inUse}), on main.
 *
 * Main's checkout has no `setupWorktree`: this job is its whole lifecycle —
 * the first pass turns it on (`core.fsmonitor` in
 * `.git/equin-fsmonitor.config`, included for main's git dir only), and every pass after
 * restarts its daemon if it died or runs throttled and renews its index token
 * if stale. A pass that cannot fails the job (a job-attempt-failed report).
 * Between passes a dead daemon costs today's full scans, never a wrong
 * answer: git auto-starts one, and a token it did not issue is answered
 * "everything".
 *
 * A checkout's daemon is STARTED by `setupWorktree` when its agent gets it
 * (`infra/worktree`). This job is the rest of the lifecycle:
 *
 * - **stop** — a checkout whose attempt is no longer retained (its last open
 *   conversation closed; {@link fsmonitorReleaseJob} does it once the lane is
 *   free, a pass picks up what it left): the daemon (~12 MB) goes, and so does
 *   `core.fsmonitor` from its `config.worktree`. A `gone` (hibernated)
 *   conversation keeps its daemon: it can resume, its edited files are still
 *   read when it is opened, and 12 MB is less than the cold reads it saves.
 * - **renew** — a retained checkout whose daemon died (a reboot, a crash):
 *   started again, and its index token renewed — a token of a dead daemon
 *   turns every read into a full scan until the index is written.
 * - **orphans** — a daemon whose checkout was removed under it (the reap's
 *   rename into the trash, then the prune) is signalled.
 *
 * Triggers: main's start and every 10 minutes — a daemon dying (git
 * may auto-start one inside some caller's process group, which dies with it)
 * or resyncing (a new token under the same pid) has no change signal to
 * listen to, and a stale token costs full scans until it is renewed. A pass
 * asks every retained checkout (one `git diff-files` each), so nothing that
 * concerns one checkout enqueues one: a conversation closing releases its own.
 *
 * Never two at once ({@link DAEMONS_LANE}). `dedup: "singleton"` bounds the
 * PENDING rows only, so without the lane a pass that outlived its 10 minutes
 * ran beside the next: on a laptop asleep most of each hour, a pass gets ~1
 * awake minute an hour, and four of them asked the same ~60 checkouts in
 * lock-step, 16 git at once (2026-11-22). Now one runs and at most one waits.
 *
 * Only checkouts whose attempt row main holds are decided: one another
 * backend minted (a worktree build's agents) is left as it is, and its daemon
 * ends with its checkout.
 *
 * Only FINISHED checkouts are touched. While an attempt's `worktree.prepare`
 * run is open, its child owns the checkout — it writes the tree, installs it,
 * then starts the fsmonitor and records its token itself (`setupWorktree`).
 * Touching it then races that child: a `config.worktree.lock` taken twice, an
 * index read before the tree write made one, and — the one that could fail a
 * launch — this pass's index publish holding `index.lock` while the child's
 * `git reset --hard` or `git switch` needs it. So a checkout whose prepare run
 * is open, or which a cut-off run left unfinished (`isUnfinishedEntry`: the
 * next run discards it), is left alone this pass. The open runs are read AFTER
 * the listing: a checkout listed whose run has closed since has ended — its
 * files final, whole or (a write cut off) unfinished. A run that failed after
 * the files (its install) leaves them whole: decided like any other, its
 * retry's setup may overlap a pass, where every fsmonitor write of the setup
 * is non-fatal. A run that never closes, or a checkout abandoned unfinished,
 * is never decided — at most one idle daemon left as it was.
 */
export const fsmonitorReconcileJob = defineJob({
  name: "worktree.fsmonitor-reconcile",
  description:
    "Keeps git's file-watching daemon running for main's own checkout and the agent checkouts still in use (so git reads there cost what changed, not every file), and stops it for the agent checkouts whose conversations are closed.",
  // Bounded spawns per checkout (each `timeoutMs`), and an index refresh
  // (~1 s, seconds cold) for each checkout whose daemon restarted — after a
  // reboot, every retained checkout's, one after the other.
  hold: "minutes",
  inProcess:
    "every step converges: a run a restart kills leaves each checkout on or off as it was, and the next run (boot, 10 minutes) continues from there",
  input: z.object({}),
  event: z.never(),
  dedup: "singleton",
  schedule: { cron: "*/10 * * * *" },
  serial: DAEMONS_LANE,
  async run({ ctx: { signal } }) {
    const { main, attempts } = await listCheckouts(signal);
    const { checkouts, notReady } = await decideCheckouts(attempts);
    // Main's own checkout (the repo root): always on (D12) — a git there (the
    // human's, a push's merge) otherwise stats its ~26k files. Decided by no
    // attempt row and set up by no prepare run, so nothing races it but a git
    // writer there, which the token renewal's compare-and-swap publish steps
    // aside for. First, so a failure elsewhere never delays it. Main's slots
    // are not here: `infra/git/fsmonitor`'s CLAUDE.md.
    const mainCheckout: FsmonitorCheckout = {
      path: main.path,
      gitDir: main.gitDir,
      want: "on",
    };
    await converge(
      "worktree.fsmonitor-reconcile",
      main,
      [mainCheckout, ...checkouts],
      notReady,
      signal,
      { tier: "background", orphans: true },
    );
  },
});

/**
 * One closed attempt's checkout: its daemon stopped, unless the attempt is
 * still retained (another conversation of it is open) or its checkout is
 * being set up. Runs no git in any other checkout (it still lists the
 * registered worktrees, and `ps` / `lsof` when it stops one). It waits behind
 * a running pass (one lane). (A pass on every close was up to half of a busy day's passes —
 * ~200 closes against 144 ticks — each re-asking ~60 checkouts to stop one.)
 */
export const fsmonitorReleaseJob = defineJob({
  name: "worktree.fsmonitor-release",
  description:
    "Stops the file-watching daemon of one agent checkout once its attempt's conversations are closed.",
  hold: "seconds",
  input: z.object({ attemptId: z.string() }),
  event: z.never(),
  dedup: { key: ({ attemptId }) => attemptId },
  serial: DAEMONS_LANE,
  async run({ input: { attemptId }, ctx: { signal } }) {
    const { main, attempts } = await listCheckouts(signal);
    const { checkouts, notReady } = await decideCheckouts(
      attempts.filter((e) => nameOf(e.path) === attemptId),
    );
    const closed = checkouts.filter((c) => c.want === "off");
    if (closed.length === 0) return;
    await converge(
      "worktree.fsmonitor-release",
      main,
      closed,
      notReady,
      signal,
      { tier: "background", orphans: false },
    );
  },
});

/**
 * One attempt's checkout gained a reader (its checkout watch opened in main's
 * backend): its daemon started, and its index token renewed, unless it runs
 * current already or the checkout is being set up. On the lane, like every
 * other change to a daemon. At `foreground`: someone is looking at it.
 *
 * The first read is still a scan (it raced this job); every read after it
 * costs what changed. A reader leaving does not stop the daemon: the next
 * pass does, once the checkout is neither retained nor read — a tab switched
 * back and forth would otherwise start and stop it each time.
 */
export const fsmonitorOnReadJob = defineJob({
  name: "worktree.fsmonitor-on-read",
  description:
    "Starts the file-watching daemon of an agent checkout someone opened (a closed conversation's edited files, a file explorer over it), so its git reads cost what changed rather than every file.",
  // A start and one index refresh (~1 s warm, seconds cold).
  hold: "seconds",
  input: z.object({ attemptId: z.string() }),
  event: z.never(),
  dedup: { key: ({ attemptId }) => attemptId },
  serial: DAEMONS_LANE,
  async run({ input: { attemptId }, ctx: { signal } }) {
    // A retained checkout's daemon is the pass's to keep current (and its
    // setup's to start): opening any live conversation's tab must not cost a
    // listing and a probe.
    if ((await attemptRetention([attemptId])).get(attemptId) !== false) return;
    const { main, attempts } = await listCheckouts(signal);
    const { checkouts, notReady } = await decideCheckouts(
      attempts.filter((e) => nameOf(e.path) === attemptId),
    );
    const read = checkouts.filter((c) => c.want === "on");
    if (read.length === 0) return;
    await converge("worktree.fsmonitor-on-read", main, read, notReady, signal, {
      tier: "foreground",
      orphans: false,
    });
  },
});

/**
 * From main's start on, every agent checkout whose first reader comes queues
 * {@link fsmonitorOnReadJob} (the ones already watched at once — the tabs a
 * restart replays). Main only: only main's backend decides daemons, and only
 * its watches are what this process can see.
 */
export function followCheckoutReaders(): void {
  if (runtimeNamespace() !== MAIN_WORKTREE_NAME) return;
  unfollowCheckoutReaders();
  unfollow = onCheckoutWatchOpened((root) => {
    const attemptId = nameOf(root);
    // Main's own root and other checkouts are not attempts; the job checks
    // the path is the attempt's registered checkout.
    if (!isCanonicalWorktreeName(attemptId)) return;
    void fsmonitorOnReadJob.enqueue({ attemptId });
  });
}

let unfollow: (() => void) | null = null;

/** Stop hearing new readers (shutdown). */
export function unfollowCheckoutReaders(): void {
  unfollow?.();
  unfollow = null;
}

/** An attempt's checkout is `<worktrees dir>/<attempt id>`. */
function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Main's checkout and every attempt's, as git has them registered. */
async function listCheckouts(
  signal: AbortSignal,
): Promise<{ main: WorktreeEntry; attempts: WorktreeEntry[] }> {
  // Main's attempts table is the one that says what is retained; a
  // worktree backend's fork holds a stale copy of it.
  if (runtimeNamespace() !== MAIN_WORKTREE_NAME) {
    throw new NonRetryableError(
      `[worktree.fsmonitor] runs on main only (this is ${runtimeNamespace()}): only main's attempts table says which checkouts are retained`,
    );
  }
  const repoRoot = await ensureMainWorktreeRoot(signal);
  const worktreesDir = gitWorktreesDir(repoRoot);
  const entries = await listWorktreeEntries(repoRoot, signal);
  return {
    main: entries[0]!,
    attempts: entries.filter(
      (e) =>
        !e.prunable &&
        e.path === `${worktreesDir}/${nameOf(e.path)}` &&
        isCanonicalWorktreeName(nameOf(e.path)),
    ),
  };
}

/** What each of these attempt checkouts should be. */
async function decideCheckouts(attempts: readonly WorktreeEntry[]): Promise<{
  checkouts: FsmonitorCheckout[];
  notReady: ReadonlySet<WorktreeEntry>;
}> {
  // After the listing — see the reconcile job's doc.
  const settingUp = new Set(
    (
      await openSupervisedRuns(
        worktreePrepareJob,
        attempts.map((e) => ({ attemptId: nameOf(e.path), path: e.path })),
      )
    ).map((i) => i.attemptId),
  );
  const notReady = new Set(
    attempts.filter(
      (e) => settingUp.has(nameOf(e.path)) || isUnfinishedEntry(e),
    ),
  );
  const retention = await attemptRetention(attempts.map((e) => nameOf(e.path)));
  const checkouts = attempts.map((e): FsmonitorCheckout => {
    if (notReady.has(e)) {
      // A checkout not set up yet is still passed, as left alone (`unknown`),
      // so its daemon is never taken for an orphan's.
      return { path: e.path, gitDir: e.gitDir, want: "unknown" };
    }
    const used = inUse(e.path, retention.get(nameOf(e.path)));
    return {
      path: e.path,
      gitDir: e.gitDir,
      want: used === undefined ? "unknown" : used ? "on" : "off",
    };
  });
  return { checkouts, notReady };
}

/**
 * Whether a checkout is in use — the one rule its daemon's lifetime follows:
 * its attempt is retained (an agent may work there), OR someone reads it now
 * (a live value holds a checkout watch on it in this backend: a tab showing
 * its edited files, its file explorer, its code). Undefined when main holds no
 * attempt row for it (another backend minted it): left as it is.
 *
 * The reader half is what "retained" alone missed: a closed conversation
 * opened in a tab, or a file explorer over a finished checkout, read a
 * checkout whose daemon the release had stopped — every read a full scan
 * of its ~26k files (2.8 s at boot, task-1795552567-l55l0m).
 */
function inUse(
  path: string,
  retained: boolean | undefined,
): boolean | undefined {
  // By attempt id, not by path string: a reader's root may be spelled
  // otherwise than git's registration (a realpath, a symlinked repo).
  const attemptId = nameOf(path);
  if (watchedCheckoutRoots().some((root) => nameOf(root) === attemptId)) {
    return true;
  }
  return retained;
}

/** Converge these checkouts, log what it did, and fail on any failure. */
async function converge(
  jobName: string,
  main: WorktreeEntry,
  checkouts: readonly FsmonitorCheckout[],
  notReady: ReadonlySet<WorktreeEntry>,
  signal: AbortSignal,
  scope: { tier: CheckoutTier; orphans: boolean },
): Promise<void> {
  const { tier } = scope;
  const result = await reconcileCheckoutFsmonitors(checkouts, {
    // Only a pass names every checkout, so only a pass sweeps orphans.
    orphanRoot: scope.orphans ? `${main.gitDir}/worktrees` : null,
    tier,
    // A resume may have taken the checkout back since it was decided, or a
    // reader opened it.
    stillOff: async (c) =>
      inUse(
        c.path,
        (await attemptRetention([nameOf(c.path)])).get(nameOf(c.path)),
      ) === false,
    signal,
  });
  fsmonitorLog.publish(
    `${jobName}: ${describeFsmonitorReconcile(result)}; not set up yet ${notReady.size}${notReady.size ? ` (${[...notReady].map((e) => nameOf(e.path)).join(", ")})` : ""}`,
  );
  if (result.failures.length > 0) {
    throw new Error(
      `[${jobName}] ${result.failures.length} checkout(s) failed:\n` +
        result.failures.map((f) => `  ${f.path}: ${f.error}`).join("\n"),
    );
  }
}

/**
 * A conversation that turned `done` may have released its attempt: decide that
 * one checkout, rather than waiting for the next tick. The other statuses keep the
 * attempt retained (`gone` included). Outside the lane: every status change
 * runs it, and it only reads a row.
 */
export const fsmonitorOnConversationEndedJob = defineJob({
  name: "worktree.fsmonitor-on-conversation-ended",
  description:
    "Asks for a closed conversation's checkout to have its file-watching daemon stopped, rather than waiting for the next pass.",
  hold: "instant",
  input: z.object({}),
  dedup: "none",
  event: z
    .object({ conversationId: z.string(), status: ConversationStatusSchema })
    .passthrough(),
  run: async ({ event }) => {
    if (event?.status !== "done") return;
    // A worktree backend's own conversations end too; main decides.
    if (runtimeNamespace() !== MAIN_WORKTREE_NAME) return;
    const conversation = await getConversation(event.conversationId);
    // A hard delete emits `done` after the row is gone, so nothing names its
    // attempt any more: a pass decides it (rare — closes keep the row).
    if (conversation === null) {
      await fsmonitorReconcileJob.enqueue({});
      return;
    }
    await fsmonitorReleaseJob.enqueue({ attemptId: conversation.attemptId });
  },
});

/**
 * A pass at main's start: after a reboot every daemon is gone and every
 * retained checkout's index names a dead one — full scans until renewed.
 */
export const fsmonitorReconcileWarmup = defineWarmup({
  name: "worktree.fsmonitor-reconcile",
  description:
    "Queues a pass over main's and the agent checkouts' file-watching daemons at startup, so after a reboot their git reads are fast again within minutes.",
  scope: "host",
  run: async () => {
    await fsmonitorReconcileJob.enqueue({});
  },
});
