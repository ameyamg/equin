import type {
  SyndicationCallCtx,
  SyndicationTargetContribution,
} from "../../server";
import type { StagedPost } from "./flow";

/** What a test post answers: the target's own words either way. */
export type TestPostAnswer =
  | { kind: "posted"; remoteId: string; url?: string }
  | { kind: "failed"; error: string };

/** What one test post reads — injected, so the routing is tested against a fake target. */
export interface TestPostWorld {
  /** The target, or null when no plugin of this app provides it. */
  target: SyndicationTargetContribution | null;
  /** The item, or null when it is gone. */
  item: () => Promise<{ unpostable: string | null } | null>;
  /** The target's saved settings for the feed, secrets read back; null when never saved. */
  settings: () => Promise<{ config: Record<string, unknown> } | null>;
  /** Copy the item's files out and build its post. */
  stage: () => Promise<StagedPost>;
}

/**
 * Post one item to one target as a test: the settings as saved — on or off —
 * checked by the target's `validate`, the item's files staged, then the
 * target's `post`. Nothing is recorded (the caller writes no row), so the
 * answer — the remote id and, when the target gives one, the post's link — is
 * all there is. A throw (no answer at all) throws through to the caller.
 */
export async function testPostOnce(
  world: TestPostWorld,
  targetId: string,
  ctx: SyndicationCallCtx,
): Promise<TestPostAnswer> {
  const target = world.target;
  if (target === null) {
    return {
      kind: "failed",
      error: `No plugin of this app posts to "${targetId}".`,
    };
  }
  const label = target.target.label;
  const item = await world.item();
  if (item === null) {
    return { kind: "failed", error: "This item no longer exists." };
  }
  if (item.unpostable !== null)
    return { kind: "failed", error: item.unpostable };
  const settings = await world.settings();
  if (settings === null) {
    return { kind: "failed", error: `Set ${label} up first.` };
  }
  const why = target.calls.validate?.(settings.config) ?? null;
  if (why !== null) return { kind: "failed", error: why };
  const staged = await world.stage();
  try {
    const result = await target.calls.post(staged.post, settings.config, ctx);
    if (!result.ok) return { kind: "failed", error: result.error };
    return {
      kind: "posted",
      remoteId: result.remoteId,
      ...(result.url !== undefined ? { url: result.url } : {}),
    };
  } finally {
    await staged.dispose();
  }
}
