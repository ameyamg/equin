import {
  CONVERSATION_TRAILER,
  PUSH_TRAILER,
  firstTrailerValue,
  trailerPlaceholder,
} from "@plugins/infra/plugins/git/plugins/commit-trailers/core";
import {
  attemptBranchName,
  stripAttemptBranchPrefix,
} from "@plugins/infra/plugins/worktree/core";
import { attemptIdKind } from "@plugins/tasks/plugins/task-ids/core";

/**
 * The READER half of the commit-trailer grammar: the trailer key names, the
 * `git log --format=` fragment that emits them, and the parse of that output.
 *
 * One home instead of two copies. Both readers — the pushes ledger's projection
 * (`tasks-core/server/internal/push-ledger/reconcile.ts`) and the git-measured
 * landed set (`attempt-work/server/internal/measure.ts`) — ask git the same
 * question, so the format string and the parse that consumes it must move
 * together.
 *
 * It lives in `tasks-core`, the plugin that owns the `pushes` table this grammar
 * fills, rather than in `attempt-work`: the projection has to sit beside
 * `insertPush`, and `tasks-core` cannot import `attempt-work` (which imports
 * `tasks-core/server`).
 *
 * The conversation and push trailers were renamed (`Equin-Conversation`,
 * `Equin-Push`); their keys, old and new, are `infra/git/commit-trailers`'s,
 * and every read here accepts both. The pre-push
 * `conversation-trailer` check is what binds writers to readers — it FAILS a
 * push whose commits name neither their conversation nor their attempt (nor say
 * why they are unattributed), so an attributable commit on `main` is an
 * enforced invariant rather than a convention.
 */

/**
 * Stamped by `./equin push` beside the push trailer when the branch is an
 * attempt's (`claude-web/<attemptId>`): the attempt the push is credited to,
 * derived from the checkout itself rather than delivered by an env var — so a
 * session equin did not launch (no `EQUIN_CONVERSATION_ID`, e.g. while
 * recovering a broken main) still lands attributed. The conversation trailer,
 * when present, stays the authority.
 */
export const ATTEMPT_TRAILER_KEY = "Equin-Attempt";
/**
 * Stamped by `./equin push --unattributed "<reason>"`: a push that names no
 * conversation and no attempt ON PURPOSE, with the reason. The ledger writes no
 * row for it (there is no attempt to hang one on); git history keeps why.
 */
export const UNATTRIBUTED_TRAILER_KEY = "Equin-Unattributed";

/**
 * The attempt a branch belongs to — the value of the attempt trailer push
 * stamps from it — or null for a branch that is no attempt's (`main`, a
 * hand-made one). One definition, read by the push CLI that writes the trailer
 * and by the `conversation-trailer` check that vouches for it.
 */
export function attemptOfBranch(branch: string): string | null {
  const id = stripAttemptBranchPrefix(branch);
  return attemptBranchName(id) === branch && attemptIdKind.is(id) ? id : null;
}

/** Between the values of one trailer field (a commit can repeat a trailer). */
const VALUE_SEPARATOR = "\x1f";

/**
 * `git log --format=` fragment: NUL-separated fields, each record terminated by
 * a NUL so `parseTrailerLog` can split records on `\0\n`. A field's repeated
 * values are joined by a unit separator, never a NUL, so a commit carrying a
 * trailer twice (under its old and new key) cannot shift the fields after it.
 */
export const TRAILER_LOG_FORMAT =
  "%H%x00%cI%x00" +
  `${trailerPlaceholder(CONVERSATION_TRAILER, { separator: "%x1f" })}%x00` +
  `${trailerPlaceholder(PUSH_TRAILER, { separator: "%x1f" })}%x00` +
  `%(trailers:key=${ATTEMPT_TRAILER_KEY},valueonly,separator=%x1f)%x00` +
  "%s%x00";

/**
 * One commit `./equin push` landed and attributed, as emitted by
 * {@link TRAILER_LOG_FORMAT}: it carries the push trailer and at least one of
 * the conversation and attempt trailers.
 */
export interface TrailerCommit {
  sha: string;
  committedAt: Date;
  /** The conversation that wrote it; null when only the attempt is named. */
  conversationId: string | null;
  /** The attempt the push credits; null on commits pushed before the trailer existed. */
  attemptId: string | null;
  pushId: string;
  subject: string;
}

// Commits naming neither a conversation nor an attempt get rejected: the
// pushes table joins through the attempt graph, and such a commit (e.g. a
// `--from-main` or `--unattributed` push) can't be attributed. The git-watcher
// event still fires for those commits — auto-build runs regardless of trailers.
export function parseTrailerLog(raw: string): TrailerCommit[] {
  const records = raw.split("\0\n").filter((r) => r.length > 0);
  const out: TrailerCommit[] = [];
  for (const record of records) {
    const fields = record.split("\0");
    if (fields.length < 6) continue;
    const [sha, cIso, convRaw, pushRaw, attemptRaw, subject] = fields;
    if (!sha || !cIso) continue;
    const conversationId = firstTrailerValue(convRaw ?? "", VALUE_SEPARATOR);
    const attemptId = firstTrailerValue(attemptRaw ?? "", VALUE_SEPARATOR);
    const pushId = firstTrailerValue(pushRaw ?? "", VALUE_SEPARATOR);
    if (!pushId || (!conversationId && !attemptId)) continue;
    out.push({
      sha,
      committedAt: new Date(cIso),
      conversationId,
      attemptId,
      pushId,
      subject: subject ?? "",
    });
  }
  return out;
}
