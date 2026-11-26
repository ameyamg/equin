import { z } from "zod";

// Gmail's REST resources as the API spells them (developers.google.com/
// workspace/gmail/api/reference/rest), parsed at the boundary. Only the fields
// a mail client reads are declared; zod drops the rest. Gmail writes its int64
// fields as strings: `historyId` stays a string (an opaque cursor, compared by
// Gmail only), `internalDate` becomes epoch milliseconds.

/** An int64 Gmail spells as a decimal string, read as a JS number (ms dates, sizes). */
const Int64String = z
  .string()
  .regex(/^\d+$/, "an int64 written as a decimal string")
  .transform(Number);

/** Gmail's change cursor: opaque, monotone per mailbox, only ever handed back. */
export const HistoryIdSchema = z.string().regex(/^\d+$/);

export const HeaderSchema = z.object({ name: z.string(), value: z.string() });
export type GmailHeader = z.infer<typeof HeaderSchema>;

export const MessagePartBodySchema = z.object({
  /** Present when the bytes live behind `messages.attachments.get`. */
  attachmentId: z.string().optional(),
  size: z.number().int().nonnegative(),
  /** base64url bytes, inline when small (decode with `decodeBase64Url`). */
  data: z.string().optional(),
});

export type GmailMessagePart = {
  partId?: string;
  mimeType: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: z.infer<typeof MessagePartBodySchema>;
  parts?: GmailMessagePart[];
};

/** One node of a message's parsed MIME tree (`format=full`), recursive. */
export const MessagePartSchema: z.ZodType<GmailMessagePart> = z.lazy(() =>
  z.object({
    partId: z.string().optional(),
    mimeType: z.string(),
    filename: z.string().optional(),
    headers: z.array(HeaderSchema).optional(),
    body: MessagePartBodySchema.optional(),
    parts: z.array(MessagePartSchema).optional(),
  }),
);

/**
 * A message as `messages.get` / `threads.get` return it. Which fields are
 * present depends on the format: `minimal` has ids, labels, snippet, dates;
 * `metadata` adds `payload.headers` (only the `metadataHeaders` asked for);
 * `full` adds the whole MIME tree; `raw` replaces `payload` with `raw`.
 */
export const MessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  labelIds: z.array(z.string()).optional(),
  snippet: z.string().optional(),
  historyId: HistoryIdSchema.optional(),
  internalDate: Int64String.optional(),
  sizeEstimate: z.number().int().nonnegative().optional(),
  payload: MessagePartSchema.optional(),
  /** base64url RFC 2822 bytes (`format=raw` only). */
  raw: z.string().optional(),
});
export type GmailMessage = z.infer<typeof MessageSchema>;

export const ThreadSchema = z.object({
  id: z.string().min(1),
  /** The thread's latest change; moves whenever any of its messages changes. */
  historyId: HistoryIdSchema,
  snippet: z.string().optional(),
  messages: z.array(MessageSchema).min(1),
});
export type GmailThread = z.infer<typeof ThreadSchema>;

/** One `threads.list` item: no messages, but the thread's `historyId`. */
export const ThreadRefSchema = z.object({
  id: z.string().min(1),
  snippet: z.string(),
  historyId: HistoryIdSchema,
});
export type GmailThreadRef = z.infer<typeof ThreadRefSchema>;

export const ThreadListSchema = z.object({
  threads: z.array(ThreadRefSchema).optional(),
  nextPageToken: z.string().optional(),
  /** Gmail's ESTIMATE of the total — never a count. */
  resultSizeEstimate: z.number().int().nonnegative(),
});
export type GmailThreadList = z.infer<typeof ThreadListSchema>;

export const MessageRefSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
});
export type GmailMessageRef = z.infer<typeof MessageRefSchema>;

export const MessageListSchema = z.object({
  messages: z.array(MessageRefSchema).optional(),
  nextPageToken: z.string().optional(),
  resultSizeEstimate: z.number().int().nonnegative(),
});
export type GmailMessageList = z.infer<typeof MessageListSchema>;

export const ProfileSchema = z.object({
  emailAddress: z.string().min(1),
  messagesTotal: z.number().int().nonnegative(),
  threadsTotal: z.number().int().nonnegative(),
  historyId: HistoryIdSchema,
});
export type GmailProfile = z.infer<typeof ProfileSchema>;

export const LabelColorSchema = z.object({
  textColor: z.string(),
  backgroundColor: z.string(),
});

/**
 * A label. `labels.list` omits the counts; `labels.get` carries them
 * (`threadsTotal` / `threadsUnread` are exact, unlike a list's estimate).
 */
export const LabelSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: z.enum(["system", "user"]),
  messageListVisibility: z.enum(["show", "hide"]).optional(),
  labelListVisibility: z
    .enum(["labelShow", "labelShowIfUnread", "labelHide"])
    .optional(),
  messagesTotal: z.number().int().nonnegative().optional(),
  messagesUnread: z.number().int().nonnegative().optional(),
  threadsTotal: z.number().int().nonnegative().optional(),
  threadsUnread: z.number().int().nonnegative().optional(),
  color: LabelColorSchema.optional(),
});
export type GmailLabel = z.infer<typeof LabelSchema>;

/**
 * A label as `labels.create` / `labels.patch` answer it: the label, but with no
 * `type` (measured 2026-11-26: a create's answer carries id, name and the two
 * visibilities only, while `labels.get` of the same label says
 * `type: "user"`). Only a user label can be created or renamed, so the
 * absent type IS "user".
 */
export const LabelWriteAnswerSchema = LabelSchema.extend({
  type: z.enum(["system", "user"]).default("user"),
});

export const LabelListSchema = z.object({
  labels: z.array(LabelSchema),
});

const HistoryMessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  labelIds: z.array(z.string()).optional(),
});
const HistoryMessageChangeSchema = z.object({ message: HistoryMessageSchema });
const HistoryLabelChangeSchema = z.object({
  message: HistoryMessageSchema,
  labelIds: z.array(z.string()),
});

/** One history record: what one change did, by kind. */
export const HistoryRecordSchema = z.object({
  id: HistoryIdSchema,
  messages: z.array(HistoryMessageSchema).optional(),
  messagesAdded: z.array(HistoryMessageChangeSchema).optional(),
  messagesDeleted: z.array(HistoryMessageChangeSchema).optional(),
  labelsAdded: z.array(HistoryLabelChangeSchema).optional(),
  labelsRemoved: z.array(HistoryLabelChangeSchema).optional(),
});
export type GmailHistoryRecord = z.infer<typeof HistoryRecordSchema>;

export const HistoryListSchema = z.object({
  history: z.array(HistoryRecordSchema).optional(),
  nextPageToken: z.string().optional(),
  /** The mailbox's current cursor as of this answer. */
  historyId: HistoryIdSchema,
});

export const DraftSchema = z.object({
  id: z.string().min(1),
  message: MessageSchema,
});
export type GmailDraft = z.infer<typeof DraftSchema>;

/** A `drafts.list` item: the draft id and its message's ids only. */
export const DraftRefSchema = z.object({
  id: z.string().min(1),
  message: MessageRefSchema,
});
export type GmailDraftRef = z.infer<typeof DraftRefSchema>;

export const DraftListSchema = z.object({
  drafts: z.array(DraftRefSchema).optional(),
  nextPageToken: z.string().optional(),
  resultSizeEstimate: z.number().int().nonnegative(),
});

/** What `messages.send` / `drafts.send` answer: the sent message's ids and labels. */
export const SentMessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  labelIds: z.array(z.string()).optional(),
});
export type GmailSentMessage = z.infer<typeof SentMessageSchema>;

export const AttachmentSchema = z.object({
  size: z.number().int().nonnegative(),
  data: z.string(),
});

export const WatchResponseSchema = z.object({
  historyId: HistoryIdSchema,
  /** When the watch lapses, epoch ms. */
  expiration: Int64String,
});
export type GmailWatch = z.infer<typeof WatchResponseSchema>;

/** Gmail's error envelope (Google's JSON error format). */
export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.number().int(),
    message: z.string(),
    status: z.string().optional(),
    errors: z
      .array(
        z.object({
          reason: z.string().optional(),
          message: z.string().optional(),
          domain: z.string().optional(),
        }),
      )
      .optional(),
    /** Newer Google answers carry the reason here (`ErrorInfo`), `errors` absent. */
    details: z.array(z.object({ reason: z.string().optional() })).optional(),
  }),
});

/** Every answer that is just `{}` (delete, stop): nothing to read back. */
export const EmptySchema = z.object({}).strict();

/**
 * What `threads.modify` / `trash` / `untrash` answer: the thread with its
 * messages' ids and labels after the change (no headers, no bodies).
 */
export const ThreadLabelsSchema = z.object({
  id: z.string().min(1),
  historyId: HistoryIdSchema.optional(),
  messages: z
    .array(
      z.object({
        id: z.string().min(1),
        threadId: z.string().min(1),
        labelIds: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});
export type GmailThreadLabels = z.infer<typeof ThreadLabelsSchema>;

/** What `messages.modify` / `trash` / `untrash` answer: the message's ids and labels after the change. */
export const MessageLabelsSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  labelIds: z.array(z.string()).optional(),
});
export type GmailMessageLabels = z.infer<typeof MessageLabelsSchema>;
