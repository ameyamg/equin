import type {
  ChangeCursor,
  DraftId,
  ListCursor,
  MailboxId,
  ProviderQuery,
  ThreadId,
} from "./ids";
import type { Mailbox } from "./mailbox";
import type {
  AttachmentRef,
  FoundMessage,
  OutgoingMessage,
  SavedDraft,
  SentMessage,
  ThreadContentResult,
  ThreadListPage,
  ThreadSummaryResult,
} from "./model";
import type { CompiledMailQuery, MailQuery } from "./query";

/**
 * How a call waits. `foreground`: a click or an open view is waiting on it.
 * `background`: prefetch and revalidation, admitted only while no foreground
 * call waits and into part of the budget (Gmail's pacer gives it half).
 */
export type MailCallOptions = {
  priority?: "foreground" | "background";
  signal?: AbortSignal;
};

export type MailProviderCapabilities = {
  /** `labels`: a message is in any number of mailboxes (Gmail). `folders`: exactly one (IMAP, Outlook). */
  mailboxModel: "labels" | "folders";
  /**
   * How a mailbox created, renamed or deleted elsewhere is learned:
   * `in-changes` (JMAP Mailbox/changes) or `relist` (Gmail's history and IMAP
   * carry none — the caller relists mailboxes on its own schedule).
   */
  mailboxDefinitions: "in-changes" | "relist";
  /** The push the provider can give (`none` until one is wired). */
  push: "pubsub" | "eventsource" | "idle" | "none";
};

/** What changed since a cursor, or the cursor is too old to say (resync). */
export type MailChanges =
  | {
      kind: "changes";
      /** Threads to re-read (added to, changed, or maybe gone: `getThreads` says which). */
      threads: ThreadId[];
      /** Whether mailbox counts may have moved. */
      mailboxes: "changed" | "unchanged";
      next: ChangeCursor;
      /** More changes wait past `next`: call again with it. */
      more: boolean;
    }
  | { kind: "reset" };

export type MailFlags = { unread?: boolean; starred?: boolean };

/**
 * One account's mail, provider-neutral. Every read and write goes through it;
 * the cache and the UI never name a provider.
 *
 * Errors: `MailUnreachableError` (offline), `MailNotConnectedError` (the
 * account needs reconnecting), `MailOutcomeUnknownError` (a send or create
 * that may have happened — reconcile with `findMessage`, never resend
 * blindly). Anything else is a bug or a refusal, thrown as is.
 */
export interface MailProvider {
  // — reads —
  /**
   * One page of threads matching a compiled query, newest first. `olderThan`
   * cuts the list: only threads with a matching message before that instant
   * (inclusive of its second) — the provider may also return newer threads
   * (Gmail matches any message of a thread), which the caller drops by key.
   */
  listThreads(
    query: ProviderQuery,
    page: { olderThan: Date | null; limit: number; cursor: ListCursor | null },
    o?: MailCallOptions,
  ): Promise<ThreadListPage>;
  /** Summaries, one result per id in order (batched inside). */
  getThreads(
    ids: readonly ThreadId[],
    o?: MailCallOptions,
  ): Promise<ThreadSummaryResult[]>;
  getThreadContent(
    id: ThreadId,
    o?: MailCallOptions,
  ): Promise<ThreadContentResult>;
  getAttachment(ref: AttachmentRef, o?: MailCallOptions): Promise<Uint8Array>;
  /** Every mailbox, with counts when the provider has them. */
  listMailboxes(o?: MailCallOptions): Promise<Mailbox[]>;
  /** The message carrying this `Message-ID` header, if the account has it. */
  findMessage(
    rfc822MessageId: string,
    o?: MailCallOptions,
  ): Promise<FoundMessage>;

  // — changes —
  currentCursor(o?: MailCallOptions): Promise<ChangeCursor>;
  changesSince(cursor: ChangeCursor, o?: MailCallOptions): Promise<MailChanges>;

  // — writes: semantic, so a folder provider never fakes label math; each
  //   sets a target state, so a replay is harmless —
  archive(ids: readonly ThreadId[], o?: MailCallOptions): Promise<void>;
  moveToInbox(ids: readonly ThreadId[], o?: MailCallOptions): Promise<void>;
  trash(ids: readonly ThreadId[], o?: MailCallOptions): Promise<void>;
  untrash(ids: readonly ThreadId[], o?: MailCallOptions): Promise<void>;
  /** Permanent. */
  deleteForever(ids: readonly ThreadId[], o?: MailCallOptions): Promise<void>;
  setFlags(
    ids: readonly ThreadId[],
    flags: MailFlags,
    o?: MailCallOptions,
  ): Promise<void>;
  /** Labels add / remove. On a folder provider, a move (one add, the current folder removed). */
  setMailboxes(
    ids: readonly ThreadId[],
    change: { add: readonly MailboxId[]; remove: readonly MailboxId[] },
    o?: MailCallOptions,
  ): Promise<void>;
  createMailbox(
    m: { name: string; parentId: MailboxId | null },
    o?: MailCallOptions,
  ): Promise<Mailbox>;
  renameMailbox(
    id: MailboxId,
    name: string,
    o?: MailCallOptions,
  ): Promise<void>;
  deleteMailbox(id: MailboxId, o?: MailCallOptions): Promise<void>;
  /** Creates (existing null) or replaces a draft. */
  saveDraft(
    m: OutgoingMessage,
    existing: DraftId | null,
    o?: MailCallOptions,
  ): Promise<SavedDraft>;
  deleteDraft(id: DraftId, o?: MailCallOptions): Promise<void>;
  send(m: OutgoingMessage, o?: MailCallOptions): Promise<SentMessage>;
}

/**
 * A provider kind, registered with `MailProviders.Provider`. `compileQuery`
 * is pure (no account, no I/O): it needs only the account's mailboxes, which
 * the cache holds. `open` gives the account's ONE provider in this process —
 * a second `open` of the same account answers the same instance, so there is
 * one quota pacer per account and no way to make two.
 */
export interface MailProviderDefinition {
  readonly id: string;
  readonly label: string;
  readonly capabilities: MailProviderCapabilities;
  compileQuery(
    query: MailQuery,
    ctx: { mailboxes: readonly Mailbox[] },
  ): CompiledMailQuery;
  open(accountId: string): MailProvider;
}

/** The provider cannot be reached (offline, DNS): a cached answer still stands, an uncached one cannot be given. */
export class MailUnreachableError extends Error {
  override name = "MailUnreachableError";
  constructor(what: string, cause: unknown) {
    super(
      `Could not reach the mail provider for ${what} (${cause instanceof Error ? cause.message : String(cause)})`,
      { cause },
    );
  }
}

/** The account is not usable: not connected, consent missing or revoked. */
export class MailNotConnectedError extends Error {
  override name = "MailNotConnectedError";
  constructor(
    message: string,
    /** True when the user must (re)grant access; false for another failure to get a token. */
    readonly needsConsent: boolean,
  ) {
    super(message);
  }
}

/**
 * A send or create may or may not have happened, and reconciling did not find
 * it yet. Never resend on this alone: ask `findMessage` again later first.
 */
export class MailOutcomeUnknownError extends Error {
  override name = "MailOutcomeUnknownError";
  constructor(what: string, cause: unknown) {
    super(
      `The mail provider may or may not have done ${what}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}
