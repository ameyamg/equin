/**
 * Why a reading is on the wall clock, which counts machine sleep, rather than
 * on awake time. Work this machine runs is judged on awake time
 * (`awakeClock`, `armAwakeDeadline`, `sleep-clock`'s stamps); what follows ages
 * across a sleep as much as across a run, so the wall clock is right for it.
 */
export type WallClockReason =
  /** A retention cutoff, prune or sweep of old data: data ages whether or not the machine ran. */
  | "retention"
  /** A cache entry or record TTL: its staleness is about the world, not about work this machine did. */
  | "expiry"
  /** An instant someone else set: a token's or certificate's expiry, a remote peer's or a provider's reset time. */
  | "external"
  /** A wall-clock instant work is due at: a job's run-at, a schedule, a retry not-before. */
  | "schedule"
  /** A lease whose point is that its holder may be dead: it fails open, so sleep is allowed to expire it. */
  | "fail-open-lease"
  /** Time as a person lives it: away and idle windows, "x ago", a day's buckets. */
  | "human-time"
  /** A lookback window over records stamped with wall instants ("the last hour of events"). */
  | "lookback"
  /** The sleep itself is measured: a wall gap that an awake clock would not show is how a suspend is seen. */
  | "sleep-detection";

/**
 * `Date.now()`, with the reason it is the right clock stated where it is
 * read. A bare `Date.now()` in an age or a deadline check is reported by
 * `deadline/no-unstated-wall-age`: a deliberate wall-clock judgement cannot
 * otherwise be told from one that forgot the machine sleeps.
 */
export function wallNow(_why: WallClockReason): number {
  return Date.now();
}
