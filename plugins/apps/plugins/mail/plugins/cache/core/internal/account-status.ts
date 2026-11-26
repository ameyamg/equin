import { z } from "zod";
import { liveValue } from "@plugins/network/plugins/live/core";

/**
 * How changes reach the cache. v1 has no change signal from the provider
 * (Gmail push needs Pub/Sub, design step 8): the documented fallback is a
 * `tick` — a change read every `everyMs` while anyone watches a mail view
 * (`watching`), else a scheduled job every `idleEveryMs` — on main only
 * (null: this backend runs no idle job, a worktree).
 */
export const MailChangeSignalSchema = z.object({
  kind: z.literal("tick"),
  everyMs: z.number(),
  idleEveryMs: z.number().nullable(),
  watching: z.boolean(),
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

/** `mail.account-status`: pushed on every sync step and whenever the tick starts or stops. */
export const mailAccountStatus = liveValue("mail.account-status", {
  schema: MailAccountStatusSchema,
});
