import { reportServerError } from "@plugins/framework/plugins/server-core/core";
import { serverDateFormatter } from "@plugins/fields/plugins/date/plugins/format/server";
import { crashFieldsOf } from "@plugins/packages/plugins/error-subject/core";
import { db } from "@plugins/database/server";
import { getConfig } from "@plugins/config_v2/server";
import {
  defineJob,
  NonRetryableError,
} from "@plugins/infra/plugins/jobs/server";
import { defineRetention } from "@plugins/infra/plugins/retention/server";
import {
  getAttachment,
  importAttachment,
  readAttachmentBytes,
} from "@plugins/infra/plugins/attachments/server";
import {
  serveCollection,
  serveValue,
} from "@plugins/network/plugins/live/server";
import { Attachments } from "@plugins/infra/plugins/attachments/server";
import { recordNotification } from "@plugins/shell/plugins/notifications/server";
import { mailCache } from "@plugins/apps/plugins/mail/plugins/cache/server";
import {
  mailApp,
  mailThreadRoute,
  mailThreadsRoute,
} from "@plugins/apps/plugins/mail/plugins/shell/core";
import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import {
  mailComposeConfig,
  mailDraft,
  mailDraftAttachmentLinks,
  mailSignature,
} from "../../core";
import { createOutbox, SendRefusedError } from "./outbox";
import { _mailDrafts } from "./tables";
import { mailDraftAttachments } from "./schema-attachments";
import { mailDraftIdKind } from "../../core";

/** A name-based (v5) UUID of what it names: the same part always keeps one attachment id. */
async function nameUuid(parts: readonly string[]): Promise<string> {
  const hash = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-1",
      new TextEncoder().encode(["mail-compose-part", ...parts].join("\0")),
    ),
  ).subarray(0, 16);
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = [...hash].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function onBackgroundError(what: string, err: unknown): void {
  reportServerError({
    message: `mail compose ${what} failed: ${err instanceof Error ? err.message : String(err)}`,
    ...crashFieldsOf(err, "mail-compose"),
  });
}

export const outbox = createOutbox({
  db,
  dateFormatter: serverDateFormatter,
  sender: () => mailCache.sender(),
  thread: (id) => mailCache.thread(id),
  forwardedFileId: (a) => nameUuid([a.threadId, a.messageId, a.partId]),
  forwardedFile: async (a) => {
    const attachmentId = await nameUuid([a.threadId, a.messageId, a.partId]);
    if ((await getAttachment(attachmentId)) !== null) {
      return { attachmentId, bytes: await readAttachmentBytes(attachmentId) };
    }
    const { bytes } = await mailCache.attachment(
      a.threadId,
      a.messageId,
      a.partId,
    );
    await importAttachment({
      id: attachmentId,
      filename: a.filename,
      mime: a.mimeType,
      bytes: new Blob([new Uint8Array(bytes)]).stream(),
      size: bytes.byteLength,
    });
    return { attachmentId, bytes };
  },
  uploadBytes: (id) => readAttachmentBytes(id),
  importFile: async (f) => {
    const id = crypto.randomUUID();
    await importAttachment({
      id,
      filename: f.filename,
      mime: f.mimeType,
      bytes: new Blob([new Uint8Array(f.bytes)]).stream(),
      size: f.bytes.byteLength,
    });
    return id;
  },
  // A forwarded part not fetched yet has no row: only the ones held are linked.
  linkFiles: async (draftId, ids) => {
    const held = [];
    for (const id of ids) if ((await getAttachment(id)) !== null) held.push(id);
    await mailDraftAttachments.set(draftId, held);
  },
  undoSendMs: () => getConfig(mailComposeConfig).undoSendSeconds * 1000,
  enqueueMirror: async (draftId) => {
    await mailDraftMirrorJob.enqueue({ draftId });
  },
  enqueueSend: async (draftId, at) => {
    await mailSendJob.enqueue(
      { draftId, sendAt: at.toISOString() },
      { runAt: at },
    );
  },
  syncSoon: () => {
    mailCache
      .sync()
      .catch((err: unknown) => onBackgroundError("sync after a write", err));
  },
});

/**
 * Mirrors a draft to the provider's drafts once its saves settle — created
 * the first time, replaced after, deleted when discarded — so a draft is on
 * every device, and a keystroke is never lost to the network: the row is the
 * working copy, the provider's draft its copy.
 */
export const mailDraftMirrorJob = defineJob({
  name: "mail.draft-mirror",
  description:
    "Copies a mail draft you are writing to your mail provider's drafts a moment after you stop typing (and deletes it there when you discard it), so it is on your other devices too.",
  // A paced provider write (Gmail: one drafts upload).
  hold: "seconds",
  input: z.object({ draftId: z.string() }),
  event: z.never(),
  dedup: {
    key: (i) => i.draftId,
    settle: { quietMs: 2_000, maxWaitMs: 10_000 },
  },
  maxAttempts: 8,
  run: ({ input }) => outbox.mirror(input.draftId),
  onDead: async ({ input, death }) => {
    onBackgroundError(
      `mirroring draft ${input.draftId} to the provider`,
      new Error(death.error),
    );
  },
});

/**
 * Sends a queued message once the undo-send delay is over. Never sends twice:
 * a lost answer is settled by looking the message up, not by sending again.
 */
export const mailSendJob = defineJob({
  name: "mail.send",
  description:
    "Sends a message you sent from Mail once its undo-send delay is over, retrying through an outage; a message whose send may or may not have gone is looked up in your mail rather than sent a second time.",
  hold: "seconds",
  input: z.object({ draftId: z.string(), sendAt: z.string() }),
  event: z.never(),
  dedup: "none",
  maxAttempts: 8,
  run: async ({ input }) => {
    try {
      await outbox.sendDue(input.draftId, input.sendAt);
    } catch (err) {
      if (err instanceof SendRefusedError) {
        throw new NonRetryableError(err.message, { cause: err });
      }
      throw err;
    }
  },
  onDead: async ({ input, death }) => {
    const back = await outbox.sendFailed(input.draftId, death.error);
    if (back === null) return;
    await recordNotification({
      type: "mail.send-failed",
      category: "other",
      title: `Couldn't send "${back.content.subject.trim() || "(no subject)"}"`,
      description: back.sendError ?? death.error,
      variant: "error",
      linkTo:
        back.threadId !== null
          ? mailThreadRoute.link(mailApp, { threadId: back.threadId })
          : mailThreadsRoute.link(mailApp, {}),
    });
  },
});

/**
 * Drafts done with, cleared a day after their last write: a sent one (the
 * message itself is in its thread), and a reply box opened and left with
 * nothing typed (never saved — revision 0 — nor mirrored).
 */
export const mailDraftsRetention = defineRetention({
  table: _mailDrafts,
  column: "updatedAt",
  ttlDays: 1,
  cron: "40 4 * * *",
  perWorktree: true,
  where: or(
    eq(_mailDrafts.state, "sent"),
    and(
      eq(_mailDrafts.state, "editing"),
      eq(_mailDrafts.revision, 0),
      isNull(_mailDrafts.providerDraftId),
    ),
  )!,
});

/** One draft as its editor reads it, pushed on every write to its row. */
export const mailDraftServed = serveValue(mailDraft, {
  source: "db",
  reads: {
    tables: [_mailDrafts],
    reason: "a draft is one row of mail_drafts",
  },
  loader: async ({ id }) => {
    const d = await outbox.read(mailDraftIdKind.key(id));
    if (d === null)
      throw mailDraft.refuse(
        "missing",
        "This draft is gone (discarded or sent).",
      );
    return d;
  },
});

/** The account's signature as the editor shows it, read from the provider when an editor opens. */
export const mailSignatureServed = serveValue(mailSignature, {
  source: "external",
  changes: {
    snapshot: {
      reason:
        "the provider's send-as settings have no change signal: read when an editor opens (the message built reads them again)",
    },
  },
  loader: () => outbox.signature(),
});

const linksServed = serveCollection(mailDraftAttachmentLinks, {
  from: mailDraftAttachments.table,
});

/** The drafts' link set, served for `attachments.by-owner` to follow. */
export const attachmentLinkContributions = [
  ...linksServed.declare,
  Attachments.Link({ link: mailDraftAttachments, served: linksServed }),
];
