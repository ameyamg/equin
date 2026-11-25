import type { SyndicatedPost, SyndicationFailure } from "../../core";
import type {
  SyndicationCallCtx,
  SyndicationTargetContribution,
} from "../../server";

/**
 * What one (item, target) run does, from where the item stands and what the
 * target already holds:
 *
 * | item | target holds a post | → |
 * |---|---|---|
 * | published | no | `post` |
 * | published | yes, target edits | `edit` |
 * | published | yes, target cannot edit | `keep` (the post stays as it was) |
 * | not published | no | `forget` (nothing there: the row goes) |
 * | not published | yes, target removes | `remove` |
 * | not published | yes, target cannot remove | `cannot-remove` (failed, in words) |
 *
 * Read from the CURRENT state at run time, never from the event that queued
 * the run — so a publish and an unpublish folded into one keyed run, or run
 * in either order, end where the item is.
 */
export type SyndicationAction =
  "post" | "edit" | "keep" | "forget" | "remove" | "cannot-remove";

export function decideSyndication(input: {
  published: boolean;
  remoteId: string | null;
  canEdit: boolean;
  canRemove: boolean;
}): SyndicationAction {
  if (input.published) {
    if (input.remoteId === null) return "post";
    return input.canEdit ? "edit" : "keep";
  }
  if (input.remoteId === null) return "forget";
  return input.canRemove ? "remove" : "cannot-remove";
}

/** How one run ended — what the job writes to the item's row on that target. */
export type SyndicationOutcome =
  /** The target holds the item's post (posted, edited, or kept as it was). */
  | { kind: "posted"; remoteId: string }
  /** Nothing of the item is on the target (removed, or never there): the row goes. */
  | { kind: "gone" }
  /** Ended for good: what the user reads and acts on. */
  | { kind: "failed"; error: string }
  /** A later attempt may succeed: the job retries (the error is shown meanwhile). */
  | { kind: "retry"; error: string }
  /** The item no longer exists (its row went with it). */
  | { kind: "nothing" };

/** An item's post, staged on disk for the target; `dispose` removes the copies. */
export interface StagedPost {
  post: SyndicatedPost;
  dispose: () => Promise<void>;
}

/** What one run reads from the world — injected, so the routing is tested against a fake target. */
export interface SyndicationWorld {
  /** The item, or null when it is gone. */
  item: () => Promise<{
    published: boolean;
    /** Why it can't be posted, in words (its feed is gone, or declares no `syndicate`); null: it can. */
    unpostable: string | null;
  } | null>;
  /** What the target holds of the item (its row's remote id). */
  remoteId: () => Promise<string | null>;
  /** The target, or null when no plugin of this app provides it any more. */
  target: SyndicationTargetContribution | null;
  /** The target's settings for the item's site and feed, secrets included; null when never saved. */
  settings: () => Promise<{
    enabled: boolean;
    config: Record<string, unknown>;
  } | null>;
  /** Copy the item's files out and build its post (only for a post or an edit). */
  stage: () => Promise<StagedPost>;
}

/**
 * One run for one item on one target: decide (see {@link decideSyndication}),
 * then call the target. A target's own refusal (`retryable: false`) ends the
 * run failed; a retryable one is `retry`. A call that throws (no answer at
 * all: DNS, connection, the job's deadline) throws through — the job's retry
 * policy, and its `onDead` writes the last error. A disabled target still removes what it
 * posted (unpublishing never leaves a post behind), but posts and edits nothing.
 */
export async function syndicateOnce(
  world: SyndicationWorld,
  targetId: string,
  ctx: SyndicationCallCtx,
): Promise<SyndicationOutcome> {
  const item = await world.item();
  if (item === null) return { kind: "nothing" };
  const remoteId = await world.remoteId();
  const target = world.target;
  if (target === null) {
    return {
      kind: "failed",
      error: `No plugin of this app posts to "${targetId}" any more.`,
    };
  }
  const { calls } = target;
  const label = target.target.label;
  const action = decideSyndication({
    published: item.published,
    remoteId,
    canEdit: calls.edit !== undefined,
    canRemove: calls.remove !== undefined,
  });

  if (action === "forget") return { kind: "gone" };
  if (action === "cannot-remove") {
    return {
      kind: "failed",
      error: `${label} cannot delete a post — remove it there by hand.`,
    };
  }
  if (action === "keep" && remoteId !== null) {
    return { kind: "posted", remoteId };
  }

  const settings = await world.settings();
  if (settings === null) {
    return { kind: "failed", error: `${label} is not set up for this feed.` };
  }

  if (action === "remove" && calls.remove !== undefined && remoteId !== null) {
    return judged(await calls.remove(remoteId, settings.config, ctx), () => ({
      kind: "gone",
    }));
  }

  if (item.unpostable !== null) {
    return { kind: "failed", error: item.unpostable };
  }
  if (!settings.enabled) {
    return {
      kind: "failed",
      error: `Posting to ${label} is off for this feed.`,
    };
  }
  const staged = await world.stage();
  try {
    const result =
      action === "edit" && calls.edit !== undefined && remoteId !== null
        ? await calls.edit(remoteId, staged.post, settings.config, ctx)
        : await calls.post(staged.post, settings.config, ctx);
    return judged(result, (ok) => ({ kind: "posted", remoteId: ok.remoteId }));
  } finally {
    await staged.dispose();
  }
}

/** A target's answer as an outcome: its success mapped, its failure retried or not as it says. */
function judged<T extends { ok: true }>(
  result: T | SyndicationFailure,
  onOk: (ok: T) => SyndicationOutcome,
): SyndicationOutcome {
  if (result.ok) return onOk(result);
  return result.retryable
    ? { kind: "retry", error: result.error }
    : { kind: "failed", error: result.error };
}
