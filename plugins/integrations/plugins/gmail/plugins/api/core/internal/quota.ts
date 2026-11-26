// Gmail's quota, as Google publishes it
// (developers.google.com/workspace/gmail/api/reference/quota, read 2026-11-26).

/** Gmail's per-user, per-project budget: quota units per rolling minute. */
export const GMAIL_USER_UNITS_PER_MINUTE = 6_000;

/**
 * Calls per HTTP batch. Google allows 100 and recommends 50 or fewer, but runs
 * a batch's parts at once and refuses for rate (429 rateLimitExceeded) the
 * ones past a per-user concurrency it does not publish — and a refused part is
 * charged again when it is re-sent. Measured on the real account (2026-11-26,
 * `scripts/batch-shape-probe.ts`, `threads.get` metadata, each shape on a fresh
 * minute): 50 parts → 24 of 50 refused, 40 → 2 of 50, 30 → 4 of 30; 25 and 20
 * → none, in every run. 20 keeps a margin; batches of 20 one after another
 * read 50 threads in about the time one 50-part batch took (234 vs 281 ms).
 */
export const GMAIL_BATCH_MAX = 20;

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
  "messages.list": 5,
  "messages.get": { minimal: 20, metadata: 20, full: 60, raw: 60 },
  "messages.modify": 5,
  "messages.trash": 5,
  "messages.untrash": 5,
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
