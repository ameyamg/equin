export { mailDraftIdKind, type MailDraftId } from "./internal/id-kinds";
export {
  formatAddressList,
  parseAddressList,
  type AddressListParse,
} from "./internal/addresses";
export {
  DRAFT_KINDS,
  DRAFT_STATES,
  DraftAttachmentSchema,
  DraftContentSchema,
  DraftStartSchema,
  discardMailDraft,
  EMPTY_DRAFT_CONTENT,
  isDraftEmpty,
  MAIL_ATTACHMENTS_MAX_BYTES,
  MAIL_DRAFT_ATTACHMENTS_MAX,
  MAIL_DRAFT_REFUSALS,
  mailDraft,
  mailSignature,
  MailDraftSchema,
  saveMailDraft,
  sendMailDraft,
  startMailDraft,
  undoSendMailDraft,
  type DraftAttachment,
  type DraftContent,
  type DraftKind,
  type DraftStart,
  type DraftState,
  type MailDraft,
} from "./internal/draft";
export {
  bodySigned,
  htmlToPlainText,
  messageIdsIn,
  messageText,
  plainTextOf,
  prefixedSubject,
  quoteOf,
  signatureText,
  startFrom,
  type DraftStartContent,
} from "./internal/reply";
export { mailComposeConfig } from "./internal/config";
export {
  asDocumentContent,
  bodyText,
  MAIL_BODY_DIALECT,
  messageParts,
  plainTextBody,
  quoteBody,
  quoteForest,
  type MessageParts,
} from "./internal/body";
export {
  mailDraftAttachmentLinks,
  mailDraftAttachmentLinksEntityRef,
} from "./internal/attachment-links";
