// Gmail's quota, as Google publishes it
// (developers.google.com/workspace/gmail/api/reference/quota, read 2026-11-26).

/** Gmail's per-user, per-project budget: quota units per rolling minute. */
export const GMAIL_USER_UNITS_PER_MINUTE = 6_000;

/** Google: at most 100 calls per HTTP batch, and it recommends 50 or fewer. */
export const GMAIL_BATCH_MAX = 50;

/** What a read returns: `full` / `raw` cost three times `metadata` / `minimal`. */
export type GmailFormat = "minimal" | "metadata" | "full" | "raw";

/**
 * The cost of every call this client makes, in quota units. A batch charges
 * each of its calls, never one for the batch.
 */
export const GMAIL_QUOTA = {
  "users.getProfile": 1,
  "users.watch": 100,
  "users.stop": 50,
  "labels.list": 1,
  "labels.get": 1,
  "labels.create": 5,
  "labels.patch": 5,
  "labels.delete": 5,
  "threads.list": 10,
  "threads.get": { minimal: 40, metadata: 40, full: 120 },
  "threads.modify": 10,
  "threads.trash": 20,
  "threads.untrash": 10,
  "threads.delete": 20,
  "messages.list": 5,
  "messages.get": { minimal: 20, metadata: 20, full: 60, raw: 60 },
  "messages.batchModify": 50,
  "messages.send": 100,
  "messages.attachments.get": 20,
  "history.list": 2,
  "drafts.list": 5,
  "drafts.get": { minimal: 20, metadata: 20, full: 60, raw: 60 },
  "drafts.create": 10,
  "drafts.update": 15,
  "drafts.delete": 10,
  "drafts.send": 100,
} as const satisfies Record<
  string,
  number | Partial<Record<GmailFormat, number>>
>;

export type GmailMethod = keyof typeof GMAIL_QUOTA;
