import { reportServerError } from "@plugins/framework/plugins/server-core/core";
import { crashFieldsOf } from "@plugins/packages/plugins/error-subject/core";
import { db } from "@plugins/database/server";
import { isMain } from "@plugins/infra/plugins/runtime-identity/core";
import { serveCollection } from "@plugins/network/plugins/live/server";
import { MailProviders } from "@plugins/apps/plugins/mail/plugins/provider/server";
import type { MailProviderDefinition } from "@plugins/apps/plugins/mail/plugins/provider/core";
import { serveValue } from "@plugins/network/plugins/live/server";
import { getConfig, watchConfig } from "@plugins/config_v2/server";
import { z } from "zod";
import { defineJob } from "@plugins/infra/plugins/jobs/server";
import {
  mailAccountStatus,
  mailAccountConfig,
  mailCacheConfig,
  mailInboxView,
  mailMailboxes,
  mailThreads,
  MailThreadOpSchema,
  type MailPushStatus,
} from "../../core";
import { mailChangeSignal, SYNC_IDLE_MS, SYNC_TICK_MS } from "./sync";
import { createMailCache } from "./engine";
import {
  _mailAccounts,
  _mailMailboxes,
  _mailQueries,
  _mailQueryMembers,
  _mailThreads,
} from "./tables";

/**
 * The registered provider kinds and the one chosen in Settings (empty:
 * automatic). The engine resolves the account's provider from them — the
 * cache never names one, and never assumes only one is registered.
 */
function providers(): {
  all: readonly MailProviderDefinition[];
  chosen: string | null;
} {
  const chosen = getConfig(mailAccountConfig).provider;
  return {
    all: MailProviders.Provider.getContributions(),
    chosen: chosen === "" ? null : chosen,
  };
}

/** Who hears that threads changed (the reader's `mail.thread` value): `undefined` is "maybe any". */
const threadListeners = new Set<(ids: readonly string[] | undefined) => void>();

/**
 * Hear every change the cache learns of a thread (a sync step, a fill, a
 * reset — `undefined`: any thread may have moved). The reader's served
 * `mail.thread` re-reads its subscribed threads on it. Returns the unsubscribe.
 */
export function onMailThreadsChanged(
  listener: (ids: readonly string[] | undefined) => void,
): () => void {
  threadListeners.add(listener);
  return () => threadListeners.delete(listener);
}

export const mailCache = createMailCache({
  db,
  providers,
  refuse: (code, message) => mailThreads.refuse(code, message),
  notifyThreads: (ids) => {
    mailThreadsServed.notify(ids === undefined ? undefined : { ids: [...ids] });
    for (const l of threadListeners) l(ids);
  },
  notifyMailboxes: () => mailMailboxesServed.notify(),
  notifyStatus: () => mailAccountStatusServed.notify(),
  changeSignal: (definition) => ({
    push: pushStatusOf(definition),
    everyMs: SYNC_TICK_MS,
    idleEveryMs: isMain() ? SYNC_IDLE_MS : null,
    watching,
    ticking: mailSync.tick.running,
  }),
  // Settings → Config (`mail-cache`), read per use: a change applies at once.
  bodyBudgetBytes: () => getConfig(mailCacheConfig).bodyBudgetMb * 1024 * 1024,
  summaryCap: () => getConfig(mailCacheConfig).summaryCap,
  prefetch: { perRun: () => getConfig(mailCacheConfig).prefetchPerRun },
  onBackgroundError,
  enqueueOp: async (job) => {
    await mailApplyOpJob.enqueue(job);
  },
});

/**
 * The provider's half of a triage op (design §6): run after the cache holds
 * the op's prediction, one at a time in the order they were made (`serial`:
 * an undo lands after its op), retried through an outage. One that fails
 * for good re-reads its threads from the provider — the truth replaces the
 * prediction — and is reported.
 */
export const mailApplyOpJob = defineJob({
  name: "mail.apply-op",
  description:
    "Writes a mail action you took (Done, read or unread, labels, trash, spam) to your mail provider right after the app shows it, retrying through an outage; one that cannot be written puts the threads back as the provider holds them.",
  // One paced provider write (Gmail: a batchModify per 1,000 messages).
  hold: "seconds",
  input: z.object({
    accountId: z.string(),
    opId: z.string(),
    op: MailThreadOpSchema,
    targets: z
      .array(z.object({ thread: z.string(), messages: z.array(z.string()) }))
      .max(1000),
  }),
  event: z.never(),
  dedup: "none",
  serial: true,
  maxAttempts: 8,
  run: ({ input }) => mailCache.applyAtProvider(input),
  onDead: async ({ input }) => {
    onBackgroundError(
      `writing ${input.op.kind} on ${input.targets.length} thread(s) to the provider`,
      new Error(
        "gave up; its threads are marked stale and re-read from the provider on their next listing or open",
      ),
    );
    await mailCache.restoreThreads(input);
  },
});

function onBackgroundError(what: string, err: unknown): void {
  reportServerError({
    message: `mail cache ${what} failed: ${err instanceof Error ? err.message : String(err)}`,
    ...crashFieldsOf(err, "mail-cache"),
  });
}

/** The change signal: the fallback tick while a view is open, the idle job otherwise (`sync.ts`). */
export const mailSync = mailChangeSignal(() => mailCache.sync());

/** Whether any mail view is subscribed (`mail.threads`' one watcher). */
let watching = false;

function pushStatusOf(
  definition: MailProviderDefinition | null,
): MailPushStatus {
  const push = definition?.push ?? null;
  return push === null ? { kind: "none" } : push.state();
}

/** The push of the account's provider as last resolved (none before the first read: the tick runs). */
function pushStatus(): MailPushStatus {
  return pushStatusOf(mailCache.currentProvider());
}

/**
 * The fallback tick runs while a mail view is open AND the provider's push
 * is not live (none, not set up, starting or down). Push live, a view gets
 * its changes as they happen; the idle job still runs, catching a
 * notification Google dropped.
 */
function reconcileTick(): void {
  if (watching && pushStatus().kind !== "live") mailSync.tick.start();
  else mailSync.tick.stop();
  mailAccountStatusServed.notify();
}

/**
 * Listens to every registered provider's push (one without is skipped): a
 * change signalled by the account's provider runs a sync step (coalesced
 * with any other), and every move of a push's state re-decides the tick — the
 * account's push going live also syncs, catching up what moved while it was
 * not. Another provider's push is not the account's: its changes are not
 * synced once the account is known. Returns the unsubscribe.
 */
export function listenToPush(): () => void {
  const syncNow = () => {
    mailCache
      .sync()
      .catch((err: unknown) => onBackgroundError("push sync", err));
  };
  // Before the first read resolved the account (a restart), any push's
  // change syncs: the step resolves the account itself.
  const isAccounts = (definition: MailProviderDefinition) => {
    const current = mailCache.currentProvider();
    return current === null || current.id === definition.id;
  };
  const unlisten = MailProviders.Provider.getContributions().flatMap(
    (definition) => {
      const push = definition.push;
      if (push === null) return [];
      let wasLive = push.state().kind === "live";
      return [
        push.listen({
          changed: () => {
            if (isAccounts(definition)) syncNow();
          },
          state: () => {
            const live = push.state().kind === "live";
            if (live && !wasLive && isAccounts(definition)) syncNow();
            wasLive = live;
            reconcileTick();
          },
        }),
      ];
    },
  );
  // Push may have moved before this listener existed (plugins' onReady run
  // in no set order): decide the tick on its state now.
  reconcileTick();
  return () => {
    for (const u of unlisten) u();
  };
}

/**
 * A provider chosen in Settings → Config → Mail account applies at once:
 * every open view, the sidebar and the status re-read (the next read
 * resolves the account on the chosen provider, dropping the other's cache),
 * and the tick is re-decided on the provider the status now names.
 */
export function watchProviderChoice(): void {
  let chosen: string | undefined;
  watchConfig(mailAccountConfig, ({ provider }) => {
    // The watcher fires at once with the current value: nothing moved.
    if (chosen === undefined || chosen === provider) {
      chosen = provider;
      return;
    }
    chosen = provider;
    mailThreadsServed.notify();
    mailMailboxesServed.notify();
    mailAccountStatusServed.notify();
    reconcileTick();
  });
}

const CACHE_READS = {
  tables: [],
  reason: "the Mail cache's own tables, which only the cache writes",
  notified: {
    relations: [
      _mailAccounts,
      _mailMailboxes,
      _mailThreads,
      _mailQueries,
      _mailQueryMembers,
    ],
    reason:
      "the cache writes them only while answering or catching up, and notifies the served collections itself when what they answer moved",
  },
};

/**
 * Any window of the connected account's threads: from coverage when it
 * reaches, else filled from the provider (the window stays loading); refused,
 * typed, when it cannot be answered.
 */
export const mailThreadsServed = serveCollection(mailThreads, {
  source: "external",
  changes: "notified",
  reads: CACHE_READS,
  window: (q, read) => mailCache.window(q, read),
  rows: (ids) => mailCache.rows(ids),
  keyText: { date: (d: Date) => d.toISOString() },
  // ONE watcher for every open mail view: the fallback tick runs while any
  // is, unless push is live (`reconcileTick`).
  whileSubscribed: () => {
    watching = true;
    reconcileTick();
    return () => {
      watching = false;
      reconcileTick();
    };
  },
  throttleMs: 500,
  // Opening Mail paints the Inbox from the cache: its first page rides Mail's
  // own boot snapshot (the app this plugin lies in, no other), answered from
  // coverage alone — nothing cached, no preload, never a wait on the provider.
  preloadWindows: {
    windows: () => [mailInboxView],
    held: (q) => mailCache.held(q),
  },
});

/** The account's mailboxes with the provider's counts, relisted by the cache. */
export const mailMailboxesServed = serveCollection(mailMailboxes, {
  source: "external",
  changes: "notified",
  reads: CACHE_READS,
  all: () => mailCache.mailboxes(),
  rows: async (ids) => {
    const want = new Set(ids);
    return (await mailCache.mailboxes()).filter((m) => want.has(m.id));
  },
  throttleMs: 500,
});

/** The account's connection, change signal and last sync, pushed on every sync step, tick start / stop and push move. */
export const mailAccountStatusServed = serveValue(mailAccountStatus, {
  source: "external",
  changes: "notified",
  reads: {
    tables: [],
    reason: "the cache's own account row, which only the cache writes",
    notified: {
      relations: [_mailAccounts],
      reason:
        "the account row's sync outcome, written only by the cache's sync step, which notifies this value itself",
    },
  },
  loader: () => mailCache.status(),
});
