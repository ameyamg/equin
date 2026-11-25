import { defineServerContribution } from "@plugins/framework/plugins/server-core/core";
import type { FieldsRecord, InferFieldsObject } from "@plugins/fields/core";
import type {
  SyndicatedPost,
  SyndicationPostResult,
  SyndicationRemoveResult,
  SyndicationTargetDecl,
} from "../../core";

/** What a target's calls are handed besides the post and its config. */
export interface SyndicationCallCtx {
  /** The job's signal: an abort ends the call (and any re-encode) with its reason. */
  readonly signal: AbortSignal;
  /** A directory of this run's own, removed when the run ends (re-encoded files go here). */
  readonly workDir: string;
}

/** A target's calls, its config already parsed against its declaration. */
export interface SyndicationTargetCalls<C> {
  /** Post one item; answers its id on the target. */
  post: (
    post: SyndicatedPost,
    config: C,
    ctx: SyndicationCallCtx,
  ) => Promise<SyndicationPostResult>;
  /**
   * Replace an existing post with the item's current text and files. May
   * answer another id (the post was gone, so it was posted anew). Absent: an
   * edited item's post stays as it was.
   */
  edit?: (
    remoteId: string,
    post: SyndicatedPost,
    config: C,
    ctx: SyndicationCallCtx,
  ) => Promise<SyndicationPostResult>;
  /** Delete a post (already gone is done). Absent: an unpublished item's post stays. */
  remove?: (
    remoteId: string,
    config: C,
    ctx: SyndicationCallCtx,
  ) => Promise<SyndicationRemoveResult>;
  /** Why a config cannot be used, in words — refused at save, before anything is posted. Null: usable. */
  validate?: (config: C) => string | null;
}

/** One target as the syndication job sees it: config as a plain record, parsed per call. */
export interface SyndicationTargetContribution {
  readonly target: SyndicationTargetDecl;
  readonly calls: SyndicationTargetCalls<Record<string, unknown>>;
}

/**
 * The targets this app posts to — contributed by each target plugin's
 * machine half (`SyndicationTargets.Target(syndicationTarget(decl, calls))`).
 * Read only through {@link syndicationTargetOf} / {@link syndicationTargets}:
 * nothing here names a target.
 */
export const SyndicationTargets = {
  Target: defineServerContribution<SyndicationTargetContribution>(
    "site-feeds.syndication-target",
    { docLabel: (c) => c.target.id },
  ),
};

/** Bind a target's typed calls to its declaration: each call's config is parsed first. */
export function syndicationTarget<F extends FieldsRecord>(
  target: SyndicationTargetDecl<F>,
  calls: SyndicationTargetCalls<InferFieldsObject<F>>,
): SyndicationTargetContribution {
  const parse = (config: Record<string, unknown>) =>
    target.configSchema.parse(config);
  const { edit, remove, validate } = calls;
  return {
    target: target as unknown as SyndicationTargetDecl,
    calls: {
      post: (post, config, ctx) => calls.post(post, parse(config), ctx),
      ...(edit !== undefined
        ? {
            edit: (remoteId, post, config, ctx) =>
              edit(remoteId, post, parse(config), ctx),
          }
        : {}),
      ...(remove !== undefined
        ? {
            remove: (remoteId, config, ctx) =>
              remove(remoteId, parse(config), ctx),
          }
        : {}),
      ...(validate !== undefined
        ? { validate: (config) => validate(parse(config)) }
        : {}),
    },
  };
}

/** Every target this app declares. */
export function syndicationTargets(): readonly SyndicationTargetContribution[] {
  return SyndicationTargets.Target.getContributions();
}

/** The target `targetId`, or null when no plugin of this app provides it. */
export function syndicationTargetOf(
  targetId: string,
): SyndicationTargetContribution | null {
  const matches = syndicationTargets().filter((c) => c.target.id === targetId);
  if (matches.length > 1) {
    throw new Error(
      `site-feeds: syndication target "${targetId}" is contributed ${matches.length} times — a target id is declared once`,
    );
  }
  return matches[0] ?? null;
}
