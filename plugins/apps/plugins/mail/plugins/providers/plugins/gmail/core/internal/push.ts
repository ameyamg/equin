import { z } from "zod";
import { defineEndpoint } from "@plugins/infra/plugins/endpoints/core";
import { liveValue } from "@plugins/network/plugins/live/core";

/** Where Gmail push stands on this backend (the provider contract's MailPushState). */
export const GmailPushStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("not-set-up") }),
  z.object({ kind: z.literal("starting") }),
  z.object({ kind: z.literal("live"), since: z.string() }),
  z.object({
    kind: z.literal("down"),
    since: z.string(),
    message: z.string(),
  }),
]);

/**
 * `mail.gmail-push`: Gmail push ("instant updates") on this backend — its
 * setup (the user's Google Cloud project, the shared topic, this backend's
 * own pull subscription, and when the Gmail watch lapses; null before
 * setup), and the consumer's state. `main`: whether this backend is main
 * (which renews the watch daily); a worktree consumes push only once set up
 * from it.
 */
export const GmailPushStatusSchema = z.object({
  main: z.boolean(),
  setup: z
    .object({
      projectId: z.string(),
      topic: z.string(),
      subscription: z.string(),
      setUpAt: z.string(),
      watchExpiresAt: z.string().nullable(),
    })
    .nullable(),
  state: GmailPushStateSchema,
});
export type GmailPushStatus = z.infer<typeof GmailPushStatusSchema>;

export const gmailPushStatus = liveValue("mail.gmail-push", {
  schema: GmailPushStatusSchema,
});

/** A Google Cloud project id: 6–30 lowercase letters, digits and hyphens, starting with a letter. */
export const GCP_PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/**
 * What enabling instant updates came to:
 * - `enabled` — topic, publisher grant, subscription and watch all in place;
 * - `needs-scope` — the Google connection lacks the Pub/Sub scope: grant it;
 * - `needs-gmail` — Gmail access itself is not granted (the watch needs it);
 * - `unreachable` — Google could not be reached, or failed on its side: try again;
 * - `api-disabled` — the project has the Cloud Pub/Sub API off (`activationUrl` turns it on);
 * - `refused` — Google refused `step` (`message` in its words): a wrong
 *   project, missing permission, an org policy.
 */
export const GmailPushSetupResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("enabled") }),
  z.object({ kind: z.literal("needs-scope"), message: z.string() }),
  z.object({ kind: z.literal("needs-gmail"), message: z.string() }),
  z.object({ kind: z.literal("unreachable"), message: z.string() }),
  z.object({
    kind: z.literal("api-disabled"),
    activationUrl: z.string().nullable(),
    message: z.string(),
  }),
  z.object({
    kind: z.literal("refused"),
    step: z.enum(["topic", "grant", "subscription", "watch"]),
    message: z.string(),
  }),
]);
export type GmailPushSetupResult = z.infer<typeof GmailPushSetupResultSchema>;

/** Enable instant updates on this backend, in the user's own Google Cloud project. */
export const enableGmailPush = defineEndpoint({
  route: "POST /api/mail/gmail/push/enable",
  body: z.object({
    projectId: z
      .string()
      .regex(
        GCP_PROJECT_ID,
        "a Google Cloud project ID (lowercase letters, digits and hyphens)",
      ),
  }),
  response: GmailPushSetupResultSchema,
});

/**
 * Turn instant updates off on this backend: its consumer stops and its
 * subscription is deleted (the topic stays; on main, the Gmail watch is
 * stopped too).
 */
export const disableGmailPush = defineEndpoint({
  route: "POST /api/mail/gmail/push/disable",
});
