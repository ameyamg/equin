import { LEGACY_IDS } from "@plugins/framework/plugins/product-name/core";

/**
 * A commit trailer that was renamed: commits are stamped with `key` from now
 * on, while history keeps every key it was written under before. History is
 * never rewritten, so a reader asks for all of `readKeys`, forever.
 *
 * Read through {@link trailerPlaceholder} / {@link isTrailerKey}, written
 * through {@link trailerArg}: neither half spells a key, so a reader cannot
 * ask for the new key alone and miss every older commit.
 */
export interface TrailerKeys {
  /** The key every new commit is stamped with. */
  readonly key: string;
  /** Every key a commit may carry it under: `key` first, then the older ones. */
  readonly readKeys: readonly string[];
}

function defineTrailer(
  key: string,
  legacyKeys: readonly string[],
): TrailerKeys {
  return { key, readKeys: [key, ...legacyKeys] };
}

/** The conversation a commit came from (`.githooks/prepare-commit-msg`). */
export const CONVERSATION_TRAILER = defineTrailer("Equin-Conversation", [
  LEGACY_IDS.conversationTrailer,
]);

/** The push a commit landed with (`./equin push`'s rebase `--exec`). */
export const PUSH_TRAILER = defineTrailer("Equin-Push", [
  LEGACY_IDS.pushTrailer,
]);

/**
 * Stamped by `./equin push` beside the push trailer when the branch is an
 * attempt's (`claude-web/<attemptId>`): the attempt the push is credited to,
 * derived from the checkout itself (tasks-core's `attemptOfBranch`) — so a
 * session equin did not launch still lands attributed. The conversation
 * trailer, when present, stays the authority.
 */
export const ATTEMPT_TRAILER = defineTrailer("Equin-Attempt", []);

/**
 * Stamped by `./equin push --unattributed "<reason>"`: a push that names no
 * conversation and no attempt ON PURPOSE, with the reason. The ledger writes
 * no row for it; git history keeps why.
 */
export const UNATTRIBUTED_TRAILER = defineTrailer("Equin-Unattributed", []);

/**
 * The `git log --format=` placeholder printing a trailer's values under any
 * of its keys, in message order: `%(trailers:key=A,key=B,valueonly…)` (git
 * shows a trailer matching any `key=` given).
 *
 * A commit normally carries one key. One re-stamped across the rename (an old
 * commit replayed by a newer push) can carry both, so a single-valued reader
 * takes the first value ({@link firstTrailerValue}).
 */
export function trailerPlaceholder(
  trailer: TrailerKeys,
  options: { separator?: string } = {},
): string {
  const keys = trailer.readKeys.map((k) => `key=${k}`).join(",");
  const separator =
    options.separator === undefined ? "" : `,separator=${options.separator}`;
  return `%(trailers:${keys},valueonly${separator})`;
}

/** The first non-empty value of a field printed with a separator, or null. */
export function firstTrailerValue(
  field: string,
  separator: string,
): string | null {
  for (const value of field.split(separator)) {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/** A `--trailer` value stamping it under its current key: `<key>=<value>`. */
export function trailerArg(trailer: TrailerKeys, value: string): string {
  return `${trailer.key}=${value}`;
}

/** Whether a parsed trailer key is this trailer, under any of its keys (case-insensitive, as git matches). */
export function isTrailerKey(trailer: TrailerKeys, key: string): boolean {
  const wanted = key.toLowerCase();
  return trailer.readKeys.some((k) => k.toLowerCase() === wanted);
}
