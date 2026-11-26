import type {
  ChangeCursor,
  DraftId,
  ListCursor,
  MailboxId,
  MessageId,
  ProviderQuery,
  ThreadId,
} from "./ids";
import type { Mailbox, MailboxColor } from "./mailbox";
import type {
  AttachmentRef,
  FoundMessage,
  OutgoingMessage,
  SavedDraft,
  MessageListPage,
  SentMessage,
  ThreadContentResult,
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
  /**
   * How far the provider's list order and `olderThan` cut may stray from
   * `MessageFacts.date`, in ms: a message listed after another is at most this
   * much newer by `date`, and the cut decides by a clock at most half this
   * far from it. 0 for a provider that orders and cuts by `date` itself.
   * Gmail searches and orders by its own receipt time, which differs from
   * `internalDate` by seconds (measured: −9 s to +12 s), so it declares a
   * bound with headroom. The cache widens every cut and every coverage claim
   * by it, so a skewed message is never missed.
   */
  listOrderSlackMs: number;
  /**
   * The colours a mailbox may take, or null when the provider colours none:
   * `palette` the pairs `setMailboxColor` accepts (Gmail's label palette — it
   * refuses any other), `clearable` whether a colour can be taken off again.
   */
  mailboxColors: {
    palette: readonly MailboxColor[];
    clearable: boolean;
  } | null;
};

/**
 * The account a provider kind is connected to, or why none can be named:
 * `not-connected` — the user must connect or (re)consent; `unreachable` —
 * the connection could not be checked now (offline: a token refresh failed),
 * so a caller holding the account's cached mail may still serve it.
 */
export type ConnectedMailAccount =
  | { kind: "connected"; accountId: string; address: string }
  | { kind: "not-connected"; message: string }
  | { kind: "unreachable"; message: string };

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
 * What a write acts on: a thread and the messages of it the caller knows
 * (its summary's `messages`). A provider writes per message where it can
 * (Gmail's `messages.batchModify`: one call for up to 1,000 messages, where a
 * per-thread modify costs a call each; IMAP, JMAP and Outlook write messages
 * anyway), so a message that arrived after the caller's summary is left as
 * it is — as in a mail client, which acts on the messages it showed.
 */
export type MailWriteTarget = {
  thread: ThreadId;
  messages: readonly MessageId[];
};

/**
 * Where the provider's push stands in this process:
 * - `not-set-up` — push needs a setup the user has not done (Gmail: the
 *   Pub/Sub topic), or this backend does not consume it;
 * - `starting` — set up, connecting;
 * - `live` — changes are pushed as they happen (since `since`, ISO);
 * - `down` — set up but not delivering (`message` says why), retrying.
 */
export type MailPushState =
  | { kind: "not-set-up" }
  | { kind: "starting" }
  | { kind: "live"; since: string }
  | { kind: "down"; since: string; message: string };

/**
 * A provider's change signal: it calls `changed` whenever the account's mail
 * may have moved (the cache then runs a sync step — the push says only
 * "something changed", `changesSince` says what), and `state` whenever its
 * `state()` moves. A provider without push has none (`push: null`), and the
 * cache's documented fallback tick is its change signal.
 */
export interface MailPush {
  state(): MailPushState;
  /** Returns the unsubscribe. */
  listen(l: { changed: () => void; state: () => void }): () => void;
}

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
   * One page of the messages matching a compiled query, newest first by the
   * provider's clock, each naming its thread — so a thread's place is its
   * latest matching message, exactly the order a date-sorted thread list
   * pages in. `olderThan` keeps only messages before that instant (by the
   * provider's clock, so within `listOrderSlackMs` of `date`); the answer may
   * also hold newer ones, which the caller drops by key. `limit` counts
   * messages, `cursor` is the previous page's `next` within one fill.
   */
  listMessages(
    query: ProviderQuery,
    page: { olderThan: Date | null; limit: number; cursor: ListCursor | null },
    o?: MailCallOptions,
  ): Promise<MessageListPage>;
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
  archive(
    targets: readonly MailWriteTarget[],
    o?: MailCallOptions,
  ): Promise<void>;
  /** Back to the inbox, out of trash and spam. */
  moveToInbox(
    targets: readonly MailWriteTarget[],
    o?: MailCallOptions,
  ): Promise<void>;
  trash(
    targets: readonly MailWriteTarget[],
    o?: MailCallOptions,
  ): Promise<void>;
  untrash(
    targets: readonly MailWriteTarget[],
    o?: MailCallOptions,
  ): Promise<void>;
  // No permanent delete: the trash is emptied by the provider (Gmail after
  // 30 days), and Gmail's delete needs the full mail.google.com scope, which
  // Mail does not ask for (gmail.modify covers every write here).
  setFlags(
    targets: readonly MailWriteTarget[],
    flags: MailFlags,
    o?: MailCallOptions,
  ): Promise<void>;
  /** Labels add / remove. On a folder provider, a move (one add, the current folder removed). */
  setMailboxes(
    targets: readonly MailWriteTarget[],
    change: { add: readonly MailboxId[]; remove: readonly MailboxId[] },
    o?: MailCallOptions,
  ): Promise<void>;
  createMailbox(
    m: { name: string; parentId: MailboxId | null },
    o?: MailCallOptions,
  ): Promise<Mailbox>;
  /** A mailbox's own name; its sub-mailboxes stay under it. */
  renameMailbox(
    id: MailboxId,
    name: string,
    o?: MailCallOptions,
  ): Promise<void>;
  /** Nests a mailbox (and everything under it) under `parentId` (null: a root). */
  moveMailbox(
    id: MailboxId,
    parentId: MailboxId | null,
    o?: MailCallOptions,
  ): Promise<void>;
  /** A mailbox's colour: one of `capabilities.mailboxColors.palette`, or null to clear it (`clearable`). */
  setMailboxColor(
    id: MailboxId,
    color: MailboxColor | null,
    o?: MailCallOptions,
  ): Promise<void>;
  /** Deletes a mailbox: its sub-mailboxes move up to its parent; its threads keep their other mailboxes. */
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
  /** The provider's push, or null when it has none (the cache's fallback tick then is the change signal). */
  readonly push: MailPush | null;
  compileQuery(
    query: MailQuery,
    ctx: { mailboxes: readonly Mailbox[] },
  ): CompiledMailQuery;
  open(accountId: string): MailProvider;
  /**
   * The account this provider kind is connected to (v1: one), read from the
   * provider's own connection — no mail call — so the cache can name the
   * account before its first read, and say "not connected" without one.
   */
  connectedAccount(): Promise<ConnectedMailAccount>;
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

/**
 * The provider refuses a write as asked, and nothing was written: a mailbox
 * name already taken, a move under itself, a colour off its palette, a system
 * mailbox renamed. The caller's request is wrong (an HTTP 400), not the
 * provider's state.
 */
export class MailRefusedError extends Error {
  override name = "MailRefusedError";
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
