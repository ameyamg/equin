import {
  AttachmentSchema,
  decodeBase64Url,
  DraftListSchema,
  DraftSchema,
  EmptySchema,
  encodeRelatedUpload,
  GMAIL_QUOTA,
  HistoryListSchema,
  LabelListSchema,
  LabelSchema,
  MessageLabelsSchema,
  MessageListSchema,
  MessageSchema,
  newBatchBoundary,
  ProfileSchema,
  SentMessageSchema,
  ThreadLabelsSchema,
  ThreadListSchema,
  ThreadSchema,
  WatchResponseSchema,
  type GmailDraft,
  type GmailDraftRef,
  type GmailFormat,
  type GmailHistoryRecord,
  type GmailLabel,
  type GmailMessage,
  type GmailMessageLabels,
  type GmailMessageList,
  type GmailProfile,
  type GmailSentMessage,
  type GmailThread,
  type GmailThreadLabels,
  type GmailThreadList,
  type GmailWatch,
} from "../../core";
import {
  createGmailTransport,
  queryString,
  type GmailBatchResult,
  type GmailCallOptions,
  type GmailTransportOptions,
} from "./transport";

const ME = "/gmail/v1/users/me";
const UPLOAD = "/upload/gmail/v1/users/me";
const seg = encodeURIComponent;

/** `threads.get` has no `raw`. */
export type GmailThreadFormat = Exclude<GmailFormat, "raw">;

export type GmailReadFormat<F> = {
  format: F;
  /** With `metadata`: the headers to return (all of them when omitted). */
  metadataHeaders?: readonly string[];
};

export type GmailListQuery = {
  /** Gmail search-box syntax (`from:ana has:attachment before:1700000000`). */
  q?: string;
  labelIds?: readonly string[];
  /** 1–500. Gmail's default is 100. */
  maxResults?: number;
  pageToken?: string;
  includeSpamTrash?: boolean;
};

export type GmailHistoryType =
  "messageAdded" | "messageDeleted" | "labelAdded" | "labelRemoved";

/**
 * One page of changes, or the cursor is too old: Gmail keeps history for
 * about a week (sometimes hours), then answers 404 and the caller must
 * resync from scratch.
 */
export type GmailHistoryPage =
  | {
      kind: "page";
      history: GmailHistoryRecord[];
      nextPageToken: string | null;
      historyId: string;
    }
  | { kind: "expired" };

export type GmailLabelInput = {
  name?: string;
  labelListVisibility?: "labelShow" | "labelShowIfUnread" | "labelHide";
  messageListVisibility?: "show" | "hide";
  color?: { textColor: string; backgroundColor: string };
};

export type GmailLabelChange = {
  addLabelIds?: readonly string[];
  removeLabelIds?: readonly string[];
};

/** An RFC 2822 message, as bytes, with the thread it belongs to (a reply's). */
export type GmailOutgoing = { rfc822: Uint8Array; threadId?: string };

export type GmailClient = ReturnType<typeof createGmailClient>;

function readQuery(f: GmailReadFormat<string>) {
  return queryString({ format: f.format, metadataHeaders: f.metadataHeaders });
}

function listQuery(q: GmailListQuery) {
  if (
    q.maxResults !== undefined &&
    !(
      Number.isInteger(q.maxResults) &&
      q.maxResults >= 1 &&
      q.maxResults <= 500
    )
  ) {
    throw new Error(`Gmail list maxResults must be 1–500, got ${q.maxResults}`);
  }
  return queryString({
    q: q.q,
    labelIds: q.labelIds,
    maxResults: q.maxResults,
    pageToken: q.pageToken,
    includeSpamTrash: q.includeSpamTrash,
  });
}

/**
 * A typed Gmail REST client for one account (`users/me` of the token's
 * owner). Every call is charged its quota units on the account's pacer
 * before it is sent, retried within a bound when Google refuses for rate or
 * fails on its side, and its answer zod-parsed — a shape Gmail does not
 * document throws `GmailResponseShapeError`, a refusal `GmailApiError`.
 *
 * Batched reads (`getThreads`, `getMessages`) answer per id: a thread
 * deleted since it was listed is `{ ok: false, error }` (404) beside the
 * others, never a throw for the whole page.
 */
export function createGmailClient(opts: GmailTransportOptions) {
  const t = createGmailTransport(opts);

  const threadRead = (id: string, f: GmailReadFormat<GmailThreadFormat>) => ({
    method: "GET" as const,
    path: `${ME}/threads/${seg(id)}${readQuery(f)}`,
  });
  const messageRead = (id: string, f: GmailReadFormat<GmailFormat>) => ({
    method: "GET" as const,
    path: `${ME}/messages/${seg(id)}${readQuery(f)}`,
  });
  const upload = (metadata: unknown, m: GmailOutgoing) => {
    const u = encodeRelatedUpload(metadata, m.rfc822, newBatchBoundary());
    return {
      kind: "upload" as const,
      contentType: u.contentType,
      bytes: u.body,
    };
  };

  return {
    // — account —
    getProfile(o?: GmailCallOptions): Promise<GmailProfile> {
      return t.call(
        {
          what: "users.getProfile",
          units: GMAIL_QUOTA["users.getProfile"],
          replay: "safe",
          method: "GET",
          path: `${ME}/profile`,
          schema: ProfileSchema,
        },
        o,
      );
    },

    // — labels —
    /** Every label, without counts (`getLabel` has them). */
    async listLabels(o?: GmailCallOptions): Promise<GmailLabel[]> {
      const r = await t.call(
        {
          what: "labels.list",
          units: GMAIL_QUOTA["labels.list"],
          replay: "safe",
          method: "GET",
          path: `${ME}/labels`,
          schema: LabelListSchema,
        },
        o,
      );
      return r.labels;
    },
    /** One label with its exact thread / message counts. */
    getLabel(id: string, o?: GmailCallOptions): Promise<GmailLabel> {
      return t.call(
        {
          what: `labels.get ${id}`,
          units: GMAIL_QUOTA["labels.get"],
          replay: "safe",
          method: "GET",
          path: `${ME}/labels/${seg(id)}`,
          schema: LabelSchema,
        },
        o,
      );
    },
    /** Several labels' counts in one batch. */
    getLabels(
      ids: readonly string[],
      o?: GmailCallOptions,
    ): Promise<GmailBatchResult<GmailLabel>[]> {
      return t.batch(
        "labels.get",
        ids.map((id) => ({
          part: { method: "GET", path: `${ME}/labels/${seg(id)}` },
          units: GMAIL_QUOTA["labels.get"],
        })),
        LabelSchema,
        o,
      );
    },
    createLabel(
      input: GmailLabelInput & { name: string },
      o?: GmailCallOptions,
    ): Promise<GmailLabel> {
      return t.call(
        {
          what: `labels.create ${input.name}`,
          units: GMAIL_QUOTA["labels.create"],
          replay: "rate-only",
          method: "POST",
          path: `${ME}/labels`,
          body: { kind: "json", value: input },
          schema: LabelSchema,
        },
        o,
      );
    },
    patchLabel(
      id: string,
      input: GmailLabelInput,
      o?: GmailCallOptions,
    ): Promise<GmailLabel> {
      return t.call(
        {
          what: `labels.patch ${id}`,
          units: GMAIL_QUOTA["labels.patch"],
          replay: "safe",
          method: "PATCH",
          path: `${ME}/labels/${seg(id)}`,
          body: { kind: "json", value: input },
          schema: LabelSchema,
        },
        o,
      );
    },
    async deleteLabel(id: string, o?: GmailCallOptions): Promise<void> {
      await t.call(
        {
          what: `labels.delete ${id}`,
          units: GMAIL_QUOTA["labels.delete"],
          replay: "safe",
          method: "DELETE",
          path: `${ME}/labels/${seg(id)}`,
          schema: EmptySchema,
        },
        o,
      );
    },

    // — threads —
    /** One page of thread ids (newest first), each with its `historyId`. */
    listThreads(
      q: GmailListQuery,
      o?: GmailCallOptions,
    ): Promise<GmailThreadList> {
      return t.call(
        {
          what: "threads.list",
          units: GMAIL_QUOTA["threads.list"],
          replay: "safe",
          method: "GET",
          path: `${ME}/threads${listQuery(q)}`,
          schema: ThreadListSchema,
        },
        o,
      );
    },
    getThread(
      id: string,
      f: GmailReadFormat<GmailThreadFormat>,
      o?: GmailCallOptions,
    ): Promise<GmailThread> {
      return t.call(
        {
          what: `threads.get ${id}`,
          units: GMAIL_QUOTA["threads.get"][f.format],
          replay: "safe",
          ...threadRead(id, f),
          schema: ThreadSchema,
        },
        o,
      );
    },
    /** Many threads, batched ≤ GMAIL_BATCH_MAX (20) per HTTP request; one result per id, in order. */
    getThreads(
      ids: readonly string[],
      f: GmailReadFormat<GmailThreadFormat>,
      o?: GmailCallOptions,
    ): Promise<GmailBatchResult<GmailThread>[]> {
      return t.batch(
        "threads.get",
        ids.map((id) => ({
          part: threadRead(id, f),
          units: GMAIL_QUOTA["threads.get"][f.format],
        })),
        ThreadSchema,
        o,
      );
    },
    modifyThread(
      id: string,
      change: GmailLabelChange,
      o?: GmailCallOptions,
    ): Promise<GmailThreadLabels> {
      return t.call(
        {
          what: `threads.modify ${id}`,
          units: GMAIL_QUOTA["threads.modify"],
          replay: "safe",
          method: "POST",
          path: `${ME}/threads/${seg(id)}/modify`,
          body: { kind: "json", value: change },
          schema: ThreadLabelsSchema,
        },
        o,
      );
    },
    trashThread(id: string, o?: GmailCallOptions): Promise<GmailThreadLabels> {
      return t.call(
        {
          what: `threads.trash ${id}`,
          units: GMAIL_QUOTA["threads.trash"],
          replay: "safe",
          method: "POST",
          path: `${ME}/threads/${seg(id)}/trash`,
          schema: ThreadLabelsSchema,
        },
        o,
      );
    },
    untrashThread(
      id: string,
      o?: GmailCallOptions,
    ): Promise<GmailThreadLabels> {
      return t.call(
        {
          what: `threads.untrash ${id}`,
          units: GMAIL_QUOTA["threads.untrash"],
          replay: "safe",
          method: "POST",
          path: `${ME}/threads/${seg(id)}/untrash`,
          schema: ThreadLabelsSchema,
        },
        o,
      );
    },

    // — messages —
    listMessages(
      q: GmailListQuery,
      o?: GmailCallOptions,
    ): Promise<GmailMessageList> {
      return t.call(
        {
          what: "messages.list",
          units: GMAIL_QUOTA["messages.list"],
          replay: "safe",
          method: "GET",
          path: `${ME}/messages${listQuery(q)}`,
          schema: MessageListSchema,
        },
        o,
      );
    },
    getMessage(
      id: string,
      f: GmailReadFormat<GmailFormat>,
      o?: GmailCallOptions,
    ): Promise<GmailMessage> {
      return t.call(
        {
          what: `messages.get ${id}`,
          units: GMAIL_QUOTA["messages.get"][f.format],
          replay: "safe",
          ...messageRead(id, f),
          schema: MessageSchema,
        },
        o,
      );
    },
    getMessages(
      ids: readonly string[],
      f: GmailReadFormat<GmailFormat>,
      o?: GmailCallOptions,
    ): Promise<GmailBatchResult<GmailMessage>[]> {
      return t.batch(
        "messages.get",
        ids.map((id) => ({
          part: messageRead(id, f),
          units: GMAIL_QUOTA["messages.get"][f.format],
        })),
        MessageSchema,
        o,
      );
    },
    /** Label changes on one message (a thread's other messages keep theirs). */
    modifyMessage(
      id: string,
      change: GmailLabelChange,
      o?: GmailCallOptions,
    ): Promise<GmailMessageLabels> {
      return t.call(
        {
          what: `messages.modify ${id}`,
          units: GMAIL_QUOTA["messages.modify"],
          replay: "safe",
          method: "POST",
          path: `${ME}/messages/${seg(id)}/modify`,
          body: { kind: "json", value: change },
          schema: MessageLabelsSchema,
        },
        o,
      );
    },
    trashMessage(
      id: string,
      o?: GmailCallOptions,
    ): Promise<GmailMessageLabels> {
      return t.call(
        {
          what: `messages.trash ${id}`,
          units: GMAIL_QUOTA["messages.trash"],
          replay: "safe",
          method: "POST",
          path: `${ME}/messages/${seg(id)}/trash`,
          schema: MessageLabelsSchema,
        },
        o,
      );
    },
    untrashMessage(
      id: string,
      o?: GmailCallOptions,
    ): Promise<GmailMessageLabels> {
      return t.call(
        {
          what: `messages.untrash ${id}`,
          units: GMAIL_QUOTA["messages.untrash"],
          replay: "safe",
          method: "POST",
          path: `${ME}/messages/${seg(id)}/untrash`,
          schema: MessageLabelsSchema,
        },
        o,
      );
    },
    /** Label changes on up to 1,000 messages in one call. */
    async batchModifyMessages(
      ids: readonly string[],
      change: GmailLabelChange,
      o?: GmailCallOptions,
    ): Promise<void> {
      if (ids.length === 0 || ids.length > 1000) {
        throw new Error(
          `messages.batchModify takes 1–1000 ids, got ${ids.length}`,
        );
      }
      await t.call(
        {
          what: `messages.batchModify (${ids.length})`,
          units: GMAIL_QUOTA["messages.batchModify"],
          replay: "safe",
          method: "POST",
          path: `${ME}/messages/batchModify`,
          body: { kind: "json", value: { ids, ...change } },
          schema: EmptySchema,
        },
        o,
      );
    },
    /** An attachment's bytes. */
    async getAttachment(
      messageId: string,
      attachmentId: string,
      o?: GmailCallOptions,
    ): Promise<Uint8Array> {
      const a = await t.call(
        {
          what: `messages.attachments.get ${messageId}`,
          units: GMAIL_QUOTA["messages.attachments.get"],
          replay: "safe",
          method: "GET",
          path: `${ME}/messages/${seg(messageId)}/attachments/${seg(attachmentId)}`,
          schema: AttachmentSchema,
        },
        o,
      );
      return decodeBase64Url(a.data);
    },
    /** Sends an RFC 2822 message (uploaded as bytes, up to 35 MB). */
    sendMessage(
      m: GmailOutgoing,
      o?: GmailCallOptions,
    ): Promise<GmailSentMessage> {
      return t.call(
        {
          what: "messages.send",
          units: GMAIL_QUOTA["messages.send"],
          replay: "rate-only",
          method: "POST",
          path: `${UPLOAD}/messages/send?uploadType=multipart`,
          body: upload(m.threadId ? { threadId: m.threadId } : {}, m),
          schema: SentMessageSchema,
        },
        o,
      );
    },

    // — history —
    /** Changes since `startHistoryId`, one page; `expired` when Gmail no longer has them. */
    async listHistory(
      q: {
        startHistoryId: string;
        historyTypes?: readonly GmailHistoryType[];
        labelId?: string;
        maxResults?: number;
        pageToken?: string;
      },
      o?: GmailCallOptions,
    ): Promise<GmailHistoryPage> {
      const out = await t.callOutcome(
        {
          what: `history.list since ${q.startHistoryId}`,
          units: GMAIL_QUOTA["history.list"],
          replay: "safe",
          method: "GET",
          path: `${ME}/history${queryString({ startHistoryId: q.startHistoryId, historyTypes: q.historyTypes, labelId: q.labelId, maxResults: q.maxResults, pageToken: q.pageToken })}`,
          schema: HistoryListSchema,
          expect: [404],
        },
        o,
      );
      if (!out.ok) return { kind: "expired" };
      return {
        kind: "page",
        history: out.value.history ?? [],
        nextPageToken: out.value.nextPageToken ?? null,
        historyId: out.value.historyId,
      };
    },

    // — drafts —
    async listDrafts(
      q: { q?: string; maxResults?: number; pageToken?: string },
      o?: GmailCallOptions,
    ): Promise<{ drafts: GmailDraftRef[]; nextPageToken: string | null }> {
      const r = await t.call(
        {
          what: "drafts.list",
          units: GMAIL_QUOTA["drafts.list"],
          replay: "safe",
          method: "GET",
          path: `${ME}/drafts${listQuery(q)}`,
          schema: DraftListSchema,
        },
        o,
      );
      return { drafts: r.drafts ?? [], nextPageToken: r.nextPageToken ?? null };
    },
    getDraft(
      id: string,
      format: GmailFormat,
      o?: GmailCallOptions,
    ): Promise<GmailDraft> {
      return t.call(
        {
          what: `drafts.get ${id}`,
          units: GMAIL_QUOTA["drafts.get"][format],
          replay: "safe",
          method: "GET",
          path: `${ME}/drafts/${seg(id)}${queryString({ format })}`,
          schema: DraftSchema,
        },
        o,
      );
    },
    createDraft(m: GmailOutgoing, o?: GmailCallOptions): Promise<GmailDraft> {
      return t.call(
        {
          what: "drafts.create",
          units: GMAIL_QUOTA["drafts.create"],
          replay: "rate-only",
          method: "POST",
          path: `${UPLOAD}/drafts?uploadType=multipart`,
          body: upload(
            { message: m.threadId ? { threadId: m.threadId } : {} },
            m,
          ),
          schema: DraftSchema,
        },
        o,
      );
    },
    /** Replaces a draft's whole message. */
    updateDraft(
      id: string,
      m: GmailOutgoing,
      o?: GmailCallOptions,
    ): Promise<GmailDraft> {
      return t.call(
        {
          what: `drafts.update ${id}`,
          units: GMAIL_QUOTA["drafts.update"],
          replay: "safe",
          method: "PUT",
          path: `${UPLOAD}/drafts/${seg(id)}?uploadType=multipart`,
          body: upload(
            { id, message: m.threadId ? { threadId: m.threadId } : {} },
            m,
          ),
          schema: DraftSchema,
        },
        o,
      );
    },
    async deleteDraft(id: string, o?: GmailCallOptions): Promise<void> {
      await t.call(
        {
          what: `drafts.delete ${id}`,
          units: GMAIL_QUOTA["drafts.delete"],
          replay: "safe",
          method: "DELETE",
          path: `${ME}/drafts/${seg(id)}`,
          schema: EmptySchema,
        },
        o,
      );
    },
    /** Sends a draft as saved. */
    sendDraft(id: string, o?: GmailCallOptions): Promise<GmailSentMessage> {
      return t.call(
        {
          what: `drafts.send ${id}`,
          units: GMAIL_QUOTA["drafts.send"],
          replay: "rate-only",
          method: "POST",
          path: `${ME}/drafts/send`,
          body: { kind: "json", value: { id } },
          schema: SentMessageSchema,
        },
        o,
      );
    },

    // — push —
    /** Publishes mailbox changes to a Cloud Pub/Sub topic; renew daily (it lapses after 7 days). */
    watch(
      w: {
        topicName: string;
        labelIds?: readonly string[];
        labelFilterBehavior?: "include" | "exclude";
      },
      o?: GmailCallOptions,
    ): Promise<GmailWatch> {
      return t.call(
        {
          what: "users.watch",
          units: GMAIL_QUOTA["users.watch"],
          replay: "safe",
          method: "POST",
          path: `${ME}/watch`,
          body: { kind: "json", value: w },
          schema: WatchResponseSchema,
        },
        o,
      );
    },
    async stopWatch(o?: GmailCallOptions): Promise<void> {
      await t.call(
        {
          what: "users.stop",
          units: GMAIL_QUOTA["users.stop"],
          replay: "safe",
          method: "POST",
          path: `${ME}/stop`,
          schema: EmptySchema,
        },
        o,
      );
    },
  };
}
