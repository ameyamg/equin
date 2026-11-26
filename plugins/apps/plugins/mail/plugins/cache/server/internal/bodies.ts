import type {
  ThreadContent,
  ThreadSummary,
} from "@plugins/apps/plugins/mail/plugins/provider/core";

// The reader's bodies, pure: when a stored content still answers a thread,
// and the thread as the reader reads it (the content's bytes, the summary's
// per-message facts).

/** The default byte budget of the stored bodies (the user's call: 500 MB). */
export const MAIL_BODY_BUDGET_BYTES = 500 * 1024 * 1024;

/** The default cap on cached thread summaries (the user's call, design §3: about 50k, ~50 MB). */
export const MAIL_SUMMARY_CAP = 50_000;

/**
 * Whether content holding `messageIds` answers `summary`: exactly the same
 * messages, in order. A flag or a label moves the thread's version (Gmail's
 * historyId) without touching a message's bytes, so the version is never
 * compared — a new reply, a deleted message or a saved draft (a new message
 * id on every provider) is what makes a body stale.
 */
export function bodyAnswers(
  messageIds: readonly string[],
  summary: ThreadSummary,
): boolean {
  return (
    messageIds.length === summary.messages.length &&
    summary.messages.every((m, i) => m.id === messageIds[i])
  );
}

/**
 * The thread as the reader reads it: the content's messages with the
 * summary's per-message facts (mailboxes, read, starred, draft) — what the
 * change sync keeps current — over the content's own, as of its fetch.
 */
export function readerContent(
  content: ThreadContent,
  summary: ThreadSummary,
): ThreadContent {
  const facts = new Map(summary.messages.map((m) => [m.id as string, m]));
  return {
    id: content.id,
    version: summary.version,
    messages: content.messages.map((m) => {
      const f = facts.get(m.id);
      return f === undefined
        ? m
        : {
            ...m,
            mailboxes: f.mailboxes,
            unread: f.unread,
            starred: f.starred,
            isDraft: f.isDraft,
          };
    }),
  };
}
