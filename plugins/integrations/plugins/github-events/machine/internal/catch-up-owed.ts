import { createKeyedCoalescer } from "@plugins/packages/plugins/coalesce/core";
import {
  sleptBetween,
  type SleepStamp,
} from "@plugins/packages/plugins/sleep-clock/plugins/stamp/core";

/** What the ledger runs and tells: injected, so a test drives it with fakes. */
export interface CatchUpLedgerDeps {
  /** One catch-up of `repo` (`catchUp` in `./catch-up`). Throws on failure. */
  catchUp(repo: string): Promise<void>;
  /** The machine's sleep clock now; `null` where the platform cannot read it. */
  sleepStamp(): SleepStamp | null;
  /** A failure no sleep explains: the loud path. */
  report(repo: string, err: unknown): void;
  /** A failure a sleep explains, retried at once: a line, not a report. */
  log(line: string): void;
}

export interface CatchUpLedger {
  /** `repo`'s forwarder (re)connected: it owes a catch-up, run now. */
  owe(repo: string): void;
  /** Run every catch-up still owed (the machine woke). */
  retryOwed(): void;
  /** The forwarders stopped: nothing is owed any more. */
  forgetAll(): void;
  /** The repos whose catch-up has not succeeded since they last connected. */
  owed(): string[];
  /** Resolves once `repo` has no attempt running or pending (tests). */
  idle(repo: string): Promise<void>;
}

/**
 * The catch-ups owed: a repo's forwarder connecting means it may have missed
 * events (a run that ended, a release published) while it was not connected,
 * and only a successful catch-up pays that off. Until one does, the repo stays
 * owed, and every later signal runs it again — the next ping (reconnect) and
 * the next wake (`retryOwed`). Never a timer.
 *
 * Which failures are reported is decided by the attempt itself, not by the
 * error's text or by when it surfaced: an attempt the machine SLEPT through
 * (its sleep clock moved between the attempt's start and its failure) was cut
 * by the sleep — a request the machine began in a 2-second dark wake and that
 * GitHub dropped during the 15-minute nap after it, `connection reset by peer`
 * at the next wake. It says nothing about GitHub or the request, so it is run
 * again at once, on the machine now awake, and logged. Any other failure — one
 * an awake machine met, or one where the sleep clock cannot be read — is
 * reported, and stays owed.
 *
 * One attempt per repo at a time (a keyed coalescer): a ping or wake landing
 * mid-attempt folds into one more attempt after it.
 */
export function createCatchUpLedger(deps: CatchUpLedgerDeps): CatchUpLedger {
  /** repo → the generation of its latest owe; an attempt clears only its own. */
  const owed = new Map<string, number>();
  let generation = 0;

  const attempts = createKeyedCoalescer<string>({
    name: "github-events.catch-up",
    run: attempt,
  });

  async function attempt(repo: string): Promise<void> {
    const owedAt = owed.get(repo);
    if (owedAt === undefined) return;
    const from = deps.sleepStamp();
    try {
      await deps.catchUp(repo);
    } catch (err) {
      // Forgotten meanwhile (the forwarders stopped): nothing to pay off.
      if (!owed.has(repo)) return;
      const slept = sleptBetween(from, deps.sleepStamp());
      if (slept !== null && slept >= 1) {
        deps.log(
          `catching up ${repo} was cut by a ${Math.round(slept / 1000)} s machine sleep (${errorText(err)}); running it again`,
        );
        attempts.trigger(repo);
        return;
      }
      deps.report(repo, err);
      return;
    }
    // A connect after this attempt began owes a catch-up of its own: the
    // listing this one read may predate what that disconnect missed.
    if (owed.get(repo) === owedAt) owed.delete(repo);
  }

  return {
    owe(repo) {
      generation += 1;
      owed.set(repo, generation);
      attempts.trigger(repo);
    },
    retryOwed() {
      for (const repo of owed.keys()) attempts.trigger(repo);
    },
    forgetAll() {
      owed.clear();
    },
    owed: () => [...owed.keys()],
    idle: (repo) => attempts.idle(repo),
  };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
