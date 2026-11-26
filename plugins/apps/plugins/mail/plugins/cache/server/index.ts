import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { ConfigV2 } from "@plugins/config_v2/server";
import {
  applyMailThreadOp,
  createMailLabel,
  deleteMailLabel,
  mailCacheConfig,
  updateMailLabel,
} from "../core";
import { implement } from "@plugins/infra/plugins/endpoints/server";
import { refusedAs400 } from "./internal/label-routes";
import { cacheTableExclusions } from "./internal/declarations";
import {
  listenToPush,
  mailApplyOpJob,
  mailCache as cache,
  mailAccountStatusServed,
  mailMailboxesServed,
  mailSync,
  mailThreadsServed,
} from "./internal/served";

export { mailCache, onMailThreadsChanged } from "./internal/served";
export {
  MailThreadUnavailableError,
  type MailAttachmentRead,
  type MailCache,
  type MailThreadRead,
} from "./internal/engine";
import {
  mailQueriesRetention,
  mailThreadsRetention,
} from "./internal/retention";

export {
  _mailAccounts,
  _mailMailboxes,
  _mailQueries,
  _mailQueryMembers,
  _mailThreadBodies,
  _mailThreads,
} from "./internal/tables";

export default {
  description:
    "The Mail cache, server half: the mail_* tables (one account, its mailboxes, cached thread summaries, per-query coverage and members), mail.threads served external — a window answered from coverage, else filled from the provider's date-ordered message list (cut at the coverage floor widened by the provider's declared clock slack, summaries fetched only when not cached, stale or missing the listed message), one sync step per account (coalesced: a read's catch-up, every change the provider's push signals, a 30 s tick while any mail view is subscribed and push is not live — the documented no-polling exception — and a 10-min job on main) applying the provider's changes since the cursor, re-checking locally maintained queries per message and re-listing the others, notifying open windows and relisting the mailbox counts, a reset marking everything stale — mail.account-status (connection, change signal — push state and whether the fallback ticks — last sync and its failure), refused typed when not connected / offline and not cached / a filter rule the provider cannot run — mail.mailboxes with the provider's counts, and the eviction sweeps — and triage (POST /api/mail/threads/apply): an op (Done, read / unread, labels, trash, spam, move to Inbox) written into the cache first (each message as the op leaves it, the locally maintained queries re-checked, the windows notified), then to the provider by the durable mail.apply-op job (serial, retried; given up, the threads re-read from the provider) — and label create (a / path, missing levels made), rename and delete.",
  httpRoutes: {
    [applyMailThreadOp.route]: implement(
      applyMailThreadOp,
      async ({ body }) => ({ undo: await cache.apply(body.ids, body.op) }),
    ),
    [createMailLabel.route]: implement(createMailLabel, ({ body }) =>
      refusedAs400(async () => ({ id: await cache.createLabel(body) })),
    ),
    [updateMailLabel.route]: implement(updateMailLabel, ({ params, body }) =>
      refusedAs400(() => cache.updateLabel(params.id, body)),
    ),
    [deleteMailLabel.route]: implement(deleteMailLabel, ({ params }) =>
      refusedAs400(() => cache.deleteLabel(params.id)),
    ),
  },
  contributions: [
    ...mailThreadsServed.declare,
    ...mailMailboxesServed.declare,
    ...mailAccountStatusServed.declare,
    ...cacheTableExclusions,
    ConfigV2.Register({ descriptor: mailCacheConfig }),
  ],
  register: [
    mailQueriesRetention,
    mailThreadsRetention,
    mailSync.tick,
    mailSync.idleJob,
    mailApplyOpJob,
  ],
  onReady: () => {
    listenToPush();
  },
} satisfies ServerPluginDefinition;
