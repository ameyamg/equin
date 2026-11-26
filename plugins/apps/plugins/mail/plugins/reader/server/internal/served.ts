import { endpointPath } from "@plugins/infra/plugins/endpoints/server";
import { serveValue } from "@plugins/network/plugins/live/server";
import {
  _mailAccounts,
  _mailMailboxes,
  _mailQueries,
  _mailQueryMembers,
  _mailThreadBodies,
  _mailThreads,
  mailCache,
  MailThreadUnavailableError,
  onMailThreadsChanged,
  type MailThreadRead,
} from "@plugins/apps/plugins/mail/plugins/cache/server";
import {
  mailImageProxy,
  mailInlinePart,
  mailThread,
  type ReaderThread,
} from "../../core";
import { messagePreview, remoteImageUrls, renderMailHtml } from "./render";
import { signMail } from "./sign";

/** The thread as the reader draws it: every body made safe to frame, every URL signed. */
export async function readerThread(
  read: MailThreadRead,
): Promise<ReaderThread> {
  const { summary, content } = read;
  const threadId = content.id as string;
  const messages = await Promise.all(
    content.messages.map(async (m) => {
      const raw = m.html?.content ?? null;
      let html: string | null = null;
      if (raw !== null) {
        const images = new Map<string, string>();
        await Promise.all(
          remoteImageUrls(raw).map(async (u) => {
            const sig = await signMail("image", [u]);
            images.set(u, endpointPath(mailImageProxy, { sig }, { u }));
          }),
        );
        const inline = new Map<string, string>();
        await Promise.all(
          m.attachments.map(async (a) => {
            if (a.contentId === null) return;
            const parts = [threadId, m.id as string, a.ref.partId];
            const sig = await signMail("inline", parts);
            inline.set(
              a.contentId,
              endpointPath(
                mailInlinePart,
                { sig },
                { t: parts[0]!, m: parts[1]!, p: parts[2]! },
              ),
            );
          }),
        );
        html = renderMailHtml(raw, {
          image: (u) => images.get(u) ?? null,
          inline: (cid) => inline.get(cid) ?? null,
        });
      }
      return {
        id: m.id as string,
        from: m.from,
        to: m.to,
        cc: m.cc,
        replyTo: m.replyTo,
        subject: m.subject,
        date: m.date.toISOString(),
        unread: m.unread,
        starred: m.starred,
        isDraft: m.isDraft,
        mailboxes: [...m.mailboxes],
        preview: messagePreview(m.text?.content ?? null, raw),
        text: m.text?.content ?? null,
        html,
        unknownCharset:
          m.html?.unknownCharset ?? m.text?.unknownCharset ?? null,
        attachments: m.attachments.map((a) => ({
          partId: a.ref.partId,
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
          inline: a.inline,
        })),
      };
    }),
  );
  return {
    id: threadId,
    subject: summary.subject,
    mailboxes: [...summary.mailboxes],
    unread: summary.unread,
    messages,
  };
}

/**
 * One thread as the reader opens it, from the Mail cache (its stored body,
 * else the provider), re-read whenever the cache learns the thread moved.
 */
export const mailThreadServed = serveValue(mailThread, {
  source: "external",
  changes: "notified",
  reads: {
    tables: [],
    reason: "the Mail cache's own tables, which only the cache writes",
    notified: {
      relations: [
        _mailAccounts,
        _mailMailboxes,
        _mailThreads,
        _mailThreadBodies,
        _mailQueries,
        _mailQueryMembers,
      ],
      reason:
        "the cache writes them only while answering or catching up, and tells this value (onMailThreadsChanged) when a thread moved",
    },
  },
  loader: async ({ id }) => {
    try {
      return await readerThread(await mailCache.thread(id));
    } catch (err) {
      if (err instanceof MailThreadUnavailableError) {
        throw mailThread.refuse(err.reason, err.message);
      }
      throw err;
    }
  },
  throttleMs: 500,
});

onMailThreadsChanged((ids) => {
  if (ids === undefined) mailThreadServed.notify();
  else for (const id of ids) mailThreadServed.notify({ id });
});
