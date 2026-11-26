import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { reportServerError } from "@plugins/framework/plugins/server-core/core";
import { crashFieldsOf } from "@plugins/packages/plugins/error-subject/core";
import { defineJob } from "@plugins/infra/plugins/jobs/server";
import { createKeyedMutex } from "@plugins/packages/plugins/keyed-mutex/core";
import { wallNow } from "@plugins/packages/plugins/deadline/core";
import { HttpError, implement } from "@plugins/infra/plugins/endpoints/server";
import {
  isMain,
  runtimeNamespace,
} from "@plugins/infra/plugins/runtime-identity/core";
import { serveValue } from "@plugins/network/plugins/live/server";
import {
  createPubSubClient,
  getPubSubToken,
  subscriptionName,
  topicName,
  type PubSubClient,
} from "@plugins/integrations/plugins/google-pubsub/server";
import {
  PubSubApiError,
  PubSubUnreachableError,
} from "@plugins/integrations/plugins/google-pubsub/core";
import {
  GmailApiError,
  GmailUnreachableError,
} from "@plugins/integrations/plugins/gmail/plugins/api/core";
import {
  MailNotConnectedError,
  type MailPush,
  type MailPushState,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import {
  disableGmailPush,
  enableGmailPush,
  gmailPushStatus,
  type GmailPushSetupResult,
  type GmailPushStatus,
} from "../../../core";
import { GMAIL_PRIMARY_ACCOUNT, gmailClientOf } from "../accounts";
import {
  abortableSleep,
  afterMs,
  startPushConsumer,
  type PushConsumerState,
} from "./consumer";
import { _mailGmailPush } from "../tables";

// Gmail push (design §5, task 8): Gmail publishes "this mailbox changed" to a
// Cloud Pub/Sub topic in the user's own Google Cloud project (`users.watch`),
// and this backend holds pulls open on its OWN subscription to that topic —
// an outbound request, so nothing has to be reachable from the internet.
// Each notification runs the cache's sync step (`changesSince` says what
// moved). One topic for every backend; one subscription per backend (main's
// kept forever, a worktree's deleted by Pub/Sub after a day unused), so a
// worktree set up from itself gets every notification main does.

/** The topic every backend's subscription hangs off, in the user's project. */
const TOPIC_ID = "equin-gmail";
/** Gmail's publisher, which the topic must let publish (Google's push guide). */
const GMAIL_PUBLISHER =
  "serviceAccount:gmail-api-push@system.gserviceaccount.com";
/** A pull asks for at most this many notifications (one sync step folds them all). */
const PULL_MAX = 50;
/** On boot, a watch lapsing within this is renewed at once (it lapses after 7 days; main renews daily). */
const RENEW_WITHIN_MS = 2 * 24 * 60 * 60_000;

/** The Google connection lacks the Pub/Sub scope (or its token could not be had). */
class PubSubNotGrantedError extends Error {
  override name = "PubSubNotGrantedError";
  constructor(
    message: string,
    readonly needsConsent: boolean,
  ) {
    super(message);
  }
}

function pubsub(): PubSubClient {
  return createPubSubClient({
    accessToken: async (o) => {
      const t = await getPubSubToken({ refused: o?.refused });
      if (!t.ok) throw new PubSubNotGrantedError(t.message, t.needsConsent);
      return t.accessToken;
    },
  });
}

/** This backend's subscription id: one per namespace (Pub/Sub allows letters, digits and `-_.~+%`). */
function ownSubscriptionId(): string {
  return `${TOPIC_ID}-${runtimeNamespace().replace(/[^A-Za-z0-9\-_.~+%]/g, "-")}`;
}

type SetupRow = typeof _mailGmailPush.$inferSelect;

async function readSetup(): Promise<SetupRow | null> {
  const [row] = await db
    .select()
    .from(_mailGmailPush)
    .where(eq(_mailGmailPush.accountId, GMAIL_PRIMARY_ACCOUNT));
  return row ?? null;
}

// — the consumer and its state —

/**
 * Every lifecycle step (boot start, enable, disable, the watch renewal) runs
 * under this one lock, so two never interleave: two Enables, or an Enable
 * and a Disable, cannot leave a consumer running that no row describes.
 */
const lifecycle = createKeyedMutex("mail.gmail-push");
const LIFECYCLE = "push";

let setup: SetupRow | null = null;
let consumerState: PushConsumerState | null = null;
let consumer: { stop: () => Promise<void> } | null = null;
/** Bumped by every start and stop: a consumer's callbacks act only while theirs is current. */
let generation = 0;
let lapseTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<{ changed: () => void; state: () => void }>();

function emitState(): void {
  for (const l of listeners) l.state();
  gmailPushServed.notify();
}

/**
 * Push on this backend: not set up (no row), starting (set up, no consumer
 * state yet), the consumer's state — and, on main, `down` once the watch has
 * lapsed whatever the consumer says (the subscription then receives
 * nothing). Main renews the one per-user watch; a worktree's row does not see
 * main's renewals, so its lapse is not judged.
 */
function pushState(): MailPushState {
  if (setup === null) return { kind: "not-set-up" };
  if (consumerState === null) return { kind: "starting" };
  const lapse = setup.watchExpiresAt;
  if (
    isMain() &&
    consumerState.kind === "live" &&
    lapse !== null &&
    lapse.getTime() <= wallNow("external")
  )
    return {
      kind: "down",
      since: lapse.toISOString(),
      message: "the Gmail watch lapsed (its daily renewal has been failing)",
    };
  return consumerState;
}

/** On main, a wake-up at the watch's lapse, so the state moves then (the tick resumes) rather than at the next read. */
function armLapse(row: SetupRow): void {
  if (lapseTimer !== null) clearTimeout(lapseTimer);
  lapseTimer = null;
  const lapse = row.watchExpiresAt?.getTime();
  if (!isMain() || lapse === undefined) return;
  // A watch lasts 7 days, inside setTimeout's 24.8-day range.
  const inMs = Math.max(0, lapse - wallNow("external"));
  lapseTimer = setTimeout(() => {
    lapseTimer = null;
    emitState();
  }, inMs);
}

/** Starts this backend's consumer on `row`. Call under `lifecycle`, after `stopConsumer`. */
function startConsumer(row: SetupRow): void {
  setup = row;
  armLapse(row);
  const mine = ++generation;
  const current = () => mine === generation;
  const client = pubsub();
  consumer = startPushConsumer({
    prepare: async () => {
      await client.ensureSubscription(
        row.subscription,
        subscriptionSpec(row.topic),
      );
    },
    pull: async (signal) => {
      const r = await client.pull(row.subscription, {
        maxMessages: PULL_MAX,
        signal,
      });
      return r.kind === "gone"
        ? r
        : { kind: "messages", ackIds: r.messages.map((m) => m.ackId) };
    },
    ack: (ackIds) => client.acknowledge(row.subscription, ackIds),
    changed: () => {
      if (!current()) return;
      for (const l of listeners) l.changed();
    },
    onState: (s) => {
      if (!current()) return;
      consumerState = s;
      emitState();
    },
    sleep: abortableSleep,
    after: afterMs,
    now: () => wallNow("external"),
  });
}

/** Stops the consumer, if any (its callbacks stop counting at once). Call under `lifecycle`. */
async function stopConsumer(): Promise<void> {
  generation++;
  const c = consumer;
  consumer = null;
  consumerState = null;
  if (c) await c.stop();
}

/** This backend's subscription: main's kept, a worktree's deleted by Pub/Sub after a day unused. */
function subscriptionSpec(topic: string) {
  return {
    topic,
    ackDeadlineSeconds: 10,
    // Notifications are signals, not data: an old one is worthless once a
    // sync step ran. Pub/Sub's minimum.
    messageRetention: "600s",
    expireAfterIdle: isMain() ? null : "86400s",
  };
}

/** The provider contract's push for the Gmail provider. */
export const gmailPush: MailPush = {
  state: pushState,
  listen(l) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

// — setup —

/** Google's refusal of one setup step, typed for the setup card; anything else is thrown. */
function refusal(
  step: "topic" | "grant" | "subscription" | "watch",
  err: unknown,
): GmailPushSetupResult {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof PubSubNotGrantedError)
    return err.needsConsent
      ? { kind: "needs-scope", message }
      : { kind: "unreachable", message };
  if (err instanceof MailNotConnectedError)
    return err.needsConsent
      ? { kind: "needs-gmail", message }
      : { kind: "unreachable", message };
  if (
    err instanceof PubSubUnreachableError ||
    err instanceof GmailUnreachableError
  )
    return { kind: "unreachable", message };
  if (err instanceof PubSubApiError && err.serviceDisabled)
    return {
      kind: "api-disabled",
      activationUrl: err.activationUrl,
      message: err.detail,
    };
  if (err instanceof PubSubApiError || err instanceof GmailApiError)
    return err.transient
      ? { kind: "unreachable", message }
      : { kind: "refused", step, message };
  throw err;
}

async function attempt(
  step: "topic" | "grant" | "subscription" | "watch",
  fn: () => Promise<unknown>,
): Promise<GmailPushSetupResult | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return refusal(step, err);
  }
}

/**
 * Enables push on this backend, idempotently (every step is "make it so"):
 * the topic, Gmail's publisher on it, this backend's subscription, then
 * `users.watch` on the topic — which Gmail accepts only for a topic in the
 * project of the OAuth client the user brought. The first refusal is
 * answered typed (the scope to grant, the API to turn on, Google's words).
 */
export function enablePush(projectId: string): Promise<GmailPushSetupResult> {
  return lifecycle.run(LIFECYCLE, async () => {
    const client = pubsub();
    const topic = topicName(projectId, TOPIC_ID);
    const subscription = subscriptionName(projectId, ownSubscriptionId());
    const refused =
      (await attempt("topic", () => client.ensureTopic(topic))) ??
      (await attempt("grant", () =>
        client.grantOnTopic(topic, "roles/pubsub.publisher", GMAIL_PUBLISHER),
      )) ??
      (await attempt("subscription", () =>
        client.ensureSubscription(subscription, subscriptionSpec(topic)),
      ));
    if (refused) return refused;
    const watched: { expiresAt: Date | null } = { expiresAt: null };
    const watchRefused = await attempt("watch", async () => {
      const w = await gmailClientOf(GMAIL_PRIMARY_ACCOUNT).watch({
        topicName: topic,
      });
      watched.expiresAt = new Date(w.expiration);
    });
    if (watchRefused) return watchRefused;
    const previous = await readSetup();
    const values = {
      projectId,
      topic,
      subscription,
      setUpAt: new Date(),
      watchExpiresAt: watched.expiresAt,
    };
    const [row] = await db
      .insert(_mailGmailPush)
      .values({ accountId: GMAIL_PRIMARY_ACCOUNT, ...values })
      .onConflictDoUpdate({ target: _mailGmailPush.accountId, set: values })
      .returning();
    await stopConsumer();
    startConsumer(row!);
    emitState();
    // Re-enabled on another project: its old subscription would never expire on main.
    if (previous !== null && previous.subscription !== subscription)
      await pubsub().deleteSubscription(previous.subscription);
    return { kind: "enabled" } as const;
  });
}

/**
 * Turns push off on this backend: the row goes first (so a failure after it
 * leaves push off, not half on), then the consumer stops and its
 * subscription is deleted. The topic and the Gmail watch stay: the watch is
 * one per user, and another backend's subscription may still be using it (a
 * watch nobody renews lapses within 7 days; a topic with no subscription
 * drops what is published).
 */
export function disablePush(): Promise<void> {
  return lifecycle.run(LIFECYCLE, async () => {
    const row = await readSetup();
    await db
      .delete(_mailGmailPush)
      .where(eq(_mailGmailPush.accountId, GMAIL_PRIMARY_ACCOUNT));
    await stopConsumer();
    setup = null;
    if (lapseTimer !== null) clearTimeout(lapseTimer);
    lapseTimer = null;
    emitState();
    if (row !== null) await pubsub().deleteSubscription(row.subscription);
  });
}

// — the watch's renewal —

function renewWatch(): Promise<void> {
  return lifecycle.run(LIFECYCLE, renewWatchLocked);
}

async function renewWatchLocked(): Promise<void> {
  const row = await readSetup();
  if (row === null) return;
  const w = await gmailClientOf(GMAIL_PRIMARY_ACCOUNT).watch({
    topicName: row.topic,
  });
  const watchExpiresAt = new Date(w.expiration);
  await db
    .update(_mailGmailPush)
    .set({ watchExpiresAt })
    .where(eq(_mailGmailPush.accountId, GMAIL_PRIMARY_ACCOUNT));
  if (setup !== null) {
    setup = { ...setup, watchExpiresAt };
    armLapse(setup);
  }
  emitState();
}

/** Gmail's watch lapses after 7 days and Google advises renewing it daily: main does (schedules are main-only). */
export const gmailWatchRenewal = defineJob({
  name: "mail.gmail-watch-renew",
  description:
    "Renews the Gmail watch once a day, so Gmail keeps publishing mailbox changes to the instant-updates topic (a watch lapses after 7 days).",
  // One users.watch call.
  hold: "seconds",
  input: z.object({}),
  event: z.never(),
  dedup: "singleton",
  schedule: { cron: "23 5 * * *" },
  run: renewWatch,
});

/**
 * Boot: a backend set up starts its consumer, and renews a watch lapsing
 * within two days (a worktree's, which no schedule renews, or main's after a
 * long sleep). The renewal's failure is reported; the consumer runs anyway.
 */
export async function startPushOnBoot(): Promise<void> {
  const row = await lifecycle.run(LIFECYCLE, async () => {
    const r = await readSetup();
    if (r !== null) startConsumer(r);
    emitState();
    return r;
  });
  if (row === null) return;
  const lapse = row.watchExpiresAt?.getTime() ?? 0;
  if (lapse - wallNow("external") >= RENEW_WITHIN_MS) return;
  try {
    await renewWatch();
  } catch (err) {
    if (
      err instanceof GmailUnreachableError ||
      err instanceof MailNotConnectedError
    )
      return; // offline or disconnected: the health row says so; main's job retries daily
    reportServerError({
      message: `mail: renewing the Gmail watch on boot failed: ${err instanceof Error ? err.message : String(err)}`,
      ...crashFieldsOf(err, "mail-gmail-push"),
    });
  }
}

export function stopPushOnShutdown(): Promise<void> {
  return lifecycle.run(LIFECYCLE, async () => {
    if (lapseTimer !== null) clearTimeout(lapseTimer);
    lapseTimer = null;
    await stopConsumer();
  });
}

// — served —

async function status(): Promise<GmailPushStatus> {
  const row = await readSetup();
  return {
    main: isMain(),
    setup:
      row === null
        ? null
        : {
            projectId: row.projectId,
            topic: row.topic,
            subscription: row.subscription,
            setUpAt: row.setUpAt.toISOString(),
            watchExpiresAt: row.watchExpiresAt?.toISOString() ?? null,
          },
    state: pushState(),
  };
}

export const gmailPushServed = serveValue(gmailPushStatus, {
  source: "external",
  changes: "notified",
  reads: {
    tables: [],
    reason: "the push setup row, which only this module writes",
    notified: {
      relations: [_mailGmailPush],
      reason:
        "written only by enable / disable / the watch renewal here, each of which notifies, as does every consumer state move",
    },
  },
  loader: status,
});

export const handleEnable = implement(enableGmailPush, async ({ body }) =>
  enablePush(body.projectId),
);

export const handleDisable = implement(disableGmailPush, async () => {
  try {
    await disablePush();
  } catch (err) {
    if (
      err instanceof PubSubNotGrantedError ||
      err instanceof PubSubUnreachableError
    )
      throw new HttpError(409, err.message);
    throw err;
  }
});
