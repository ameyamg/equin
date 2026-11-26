import { z } from "zod";
import { liveValue } from "@plugins/network/plugins/live/core";

/**
 * The provider's push as the cache sees it: `none` (the provider has no
 * push), else its `MailPushState` — not set up, starting, live (changes
 * arrive as they happen) or down (set up, not delivering: `message`).
 */
export const MailPushStatusSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("not-set-up") }),
  z.object({ kind: z.literal("starting") }),
  z.object({ kind: z.literal("live"), since: z.string() }),
  z.object({
    kind: z.literal("down"),
    since: z.string(),
    message: z.string(),
  }),
]);
export type MailPushStatus = z.infer<typeof MailPushStatusSchema>;

/**
 * How changes reach the cache: the provider's `push` when it is live, else
 * the documented fallback — a change read every `everyMs` while anyone
 * watches a mail view (`watching`; `ticking` says the tick runs: watched and
 * push not live), and a scheduled job every `idleEveryMs` whatever push says
 * (it also catches a notification push dropped) — on main only (null: this
 * backend runs no idle job, a worktree).
 */
export const MailChangeSignalSchema = z.object({
  push: MailPushStatusSchema,
  everyMs: z.number(),
  idleEveryMs: z.number().nullable(),
  watching: z.boolean(),
  ticking: z.boolean(),
});

/**
 * The mail account as the cache sees it:
 * - `none` — the cache holds no account: Mail was never opened (or is not
 *   set up) — nothing to report.
 * - `not-connected` — the cache holds `address`'s mail but the account needs
 *   (re)consent: nothing syncs until it is reconnected.
 * - `account` — connected (or `offline`: the connection cannot be checked
 *   now, the cached mail still answers), with the last sync step that read
 *   the provider's changes through (`syncedAt`, ISO; null before the first)
 *   and the failure of a later one (`syncFailure`, cleared by a success).
 */
export const MailAccountStatusSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("not-connected"),
    address: z.string(),
    message: z.string(),
  }),
  z.object({
    kind: z.literal("account"),
    address: z.string(),
    connection: z.enum(["connected", "offline"]),
    changeSignal: MailChangeSignalSchema,
    /**
     * The colours a mailbox may take, as the provider declares them
     * (`MailProviderCapabilities.mailboxColors`): the label picker's palette.
     */
    mailboxColors: z
      .object({
        // A provider's offered colours: Gmail's whole palette is ~100 pairs
        // (Mail offers 18 of them).
        palette: z
          .array(z.object({ text: z.string(), background: z.string() }))
          .max(128),
        clearable: z.boolean(),
      })
      .nullable(),
    syncedAt: z.string().nullable(),
    syncFailure: z
      .object({
        at: z.string(),
        kind: z.enum(["offline", "fault"]),
        message: z.string(),
      })
      .nullable(),
  }),
]);
export type MailAccountStatus = z.infer<typeof MailAccountStatusSchema>;

/** `mail.account-status`: pushed on every sync step, whenever the tick starts or stops and whenever push moves. */
export const mailAccountStatus = liveValue("mail.account-status", {
  schema: MailAccountStatusSchema,
});
