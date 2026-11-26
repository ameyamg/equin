export {
  MAIL_THREAD_REFUSALS,
  mailThread,
  READER_MESSAGES_MAX,
  ReaderAttachmentSchema,
  ReaderMessageSchema,
  ReaderThreadSchema,
  type MailThreadRefusal,
  type ReaderAttachment,
  type ReaderMessage,
  type ReaderThread,
} from "./internal/thread";
export {
  mailAttachment,
  mailImageProxy,
  mailInlinePart,
} from "./internal/endpoints";
