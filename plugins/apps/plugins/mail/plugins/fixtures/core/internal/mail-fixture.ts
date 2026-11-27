// A mailbox, in Mail's own terms: the account, its labels and its threads of
// messages. Every id is the caller's; times are relative to the writer's now.

export interface MailFixtureParticipant {
  name?: string;
  address: string;
}

export interface MailFixtureAttachment {
  filename: string;
  mimeType: string;
  /** Bytes inline (small text), or a path relative to the demo's data/ folder read by the seed. */
  source: { bytes: Uint8Array } | { dataPath: string };
  /** Set for an inline image an html body references as cid:<contentId>. */
  contentId?: string;
}

export interface MailFixtureMessage {
  /** The message's id (a demo's carries "demo"). */
  id: string;
  /** When it arrived / was sent, relative to the seed's now. */
  ago: { days?: number; hours?: number; minutes?: number };
  from: MailFixtureParticipant;
  to: MailFixtureParticipant[];
  cc?: MailFixtureParticipant[];
  subject: string;
  text?: string;
  html?: string;
  /**
   * Role names ("inbox" | "sent" | "drafts" | "trash" | "spam" | "important")
   * or label paths ("Travel/Lisbon"). Absent: ["inbox"]; `[]` is archived.
   */
  mailboxes?: string[];
  unread?: boolean;
  starred?: boolean;
  draft?: boolean;
  attachments?: MailFixtureAttachment[];
}

/** One conversation, its messages oldest first. */
export interface MailFixtureThread {
  id: string;
  messages: MailFixtureMessage[];
}

/** A label at a `/`-separated path; its colour a background of the provider's palette. */
export interface MailFixtureLabel {
  path: string;
  color?: string;
}

export interface MailFixture {
  account: { address: string; displayName: string; signature?: string };
  labels: MailFixtureLabel[];
  threads: MailFixtureThread[];
}
