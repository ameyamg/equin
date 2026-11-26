// The contract's ids. Each is a string a provider mints and only the
// provider reads; the brand keeps one kind from being passed as another.

declare const mailBrand: unique symbol;
type Branded<B extends string> = string & { readonly [mailBrand]: B };

export type ThreadId = Branded<"ThreadId">;
export type MessageId = Branded<"MessageId">;
export type DraftId = Branded<"DraftId">;
/** A mailbox: `role:<role>` for a role mailbox, else the provider's own id. */
export type MailboxId = Branded<"MailboxId">;
/** The account's change cursor (Gmail historyId, JMAP state, IMAP modseq). Opaque. */
export type ChangeCursor = Branded<"ChangeCursor">;
/** A thread's version: moves whenever anything in the thread changes. Opaque. */
export type ThreadVersion = Branded<"ThreadVersion">;
/** Where a provider's list left off, inside one fill. Opaque, short-lived. */
export type ListCursor = Branded<"ListCursor">;
/** A compiled query, as only the provider that compiled it reads it. */
export type ProviderQuery = Branded<"ProviderQuery">;

export const threadId = (s: string) => s as ThreadId;
export const messageId = (s: string) => s as MessageId;
export const draftId = (s: string) => s as DraftId;
export const changeCursor = (s: string) => s as ChangeCursor;
export const threadVersion = (s: string) => s as ThreadVersion;
export const listCursor = (s: string) => s as ListCursor;
/** A query read back from storage, as `compileQuery` once produced it. */
export const providerQuery = (s: string) => s as ProviderQuery;
