import { reportServerError } from "@plugins/framework/plugins/server-core/core";
import { crashFieldsOf } from "@plugins/packages/plugins/error-subject/core";
import { db } from "@plugins/database/server";
import { isMain } from "@plugins/infra/plugins/runtime-identity/core";
import { serveCollection } from "@plugins/network/plugins/live/server";
import { MailProviders } from "@plugins/apps/plugins/mail/plugins/provider/server";
import type { MailProviderDefinition } from "@plugins/apps/plugins/mail/plugins/provider/core";
import { serveValue } from "@plugins/network/plugins/live/server";
import { getConfig } from "@plugins/config_v2/server";
import {
  mailAccountStatus,
  mailCacheConfig,
  mailInboxView,
  mailMailboxes,
  mailThreads,
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

/** The one provider kind v1 serves; the cache never names it. */
function soleProvider(): MailProviderDefinition {
  const all = MailProviders.Provider.getContributions();
  if (all.length !== 1) {
    throw new Error(
      `mail cache: v1 serves one mail provider, ${all.length} are registered (${all.map((p) => p.id).join(", ") || "none"})`,
    );
  }
  return all[0]!;
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
  definition: soleProvider,
  refuse: (code, message) => mailThreads.refuse(code, message),
  notifyThreads: (ids) => {
    mailThreadsServed.notify(ids === undefined ? undefined : { ids: [...ids] });
    for (const l of threadListeners) l(ids);
  },
  notifyMailboxes: () => mailMailboxesServed.notify(),
  notifyStatus: () => mailAccountStatusServed.notify(),
  changeSignal: () => ({
    push: pushStatus(),
    everyMs: SYNC_TICK_MS,
    idleEveryMs: isMain() ? SYNC_IDLE_MS : null,
    watching,
    ticking: mailSync.tick.running,
  }),
  // Settings → Config (`mail-cache`), read per use: a change applies at once.
  bodyBudgetBytes: () => getConfig(mailCacheConfig).bodyBudgetMb * 1024 * 1024,
  prefetch: { perRun: () => getConfig(mailCacheConfig).prefetchPerRun },
  onBackgroundError,
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

function pushStatus(): MailPushStatus {
  const push = soleProvider().push;
  return push === null ? { kind: "none" } : push.state();
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
 * Listens to the provider's push (a no-op without one): every change it
 * signals runs a sync step (coalesced with any other), and every move of its
 * state re-decides the tick — a push going live also syncs, catching up
 * what moved while it was not. Returns the unsubscribe.
 */
export function listenToPush(): () => void {
  const push = soleProvider().push;
  if (push === null) return () => {};
  const syncNow = () => {
    mailCache
      .sync()
      .catch((err: unknown) => onBackgroundError("push sync", err));
  };
  let wasLive = push.state().kind === "live";
  const unlisten = push.listen({
    changed: syncNow,
    state: () => {
      const live = push.state().kind === "live";
      if (live && !wasLive) syncNow();
      wasLive = live;
      reconcileTick();
    },
  });
  // Push may have moved before this listener existed (plugins' onReady run
  // in no set order): decide the tick on its state now.
  reconcileTick();
  return unlisten;
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
  window: (q) => mailCache.window(q),
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
