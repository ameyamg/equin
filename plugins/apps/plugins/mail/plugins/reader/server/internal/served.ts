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
  inlineImageToken,
  mailImageProxy,
  mailInlineImages,
  mailThread,
  type ReaderInlineImage,
  type ReaderThread,
} from "../../core";
import { messagePreview, remoteImageUrls, renderMailHtml } from "./render";
import { readPart } from "./routes";
import { signMail } from "./sign";

type ContentMessage = MailThreadRead["content"]["messages"][number];

/** A message's inline parts (`cid:` images), one per Content-ID, in order — the `inlineImages` order. */
function inlineParts(m: ContentMessage): ContentMessage["attachments"] {
  const seen = new Set<string>();
  return m.attachments.filter((a) => {
    if (a.contentId === null || seen.has(a.contentId)) return false;
    seen.add(a.contentId);
    return true;
  });
}

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
      const inlineImages: ReaderInlineImage[] = [];
      if (raw !== null) {
        const images = new Map<string, string>();
        await Promise.all(
          remoteImageUrls(raw).map(async (u) => {
            const sig = await signMail("image", [u]);
            images.set(u, endpointPath(mailImageProxy, { sig }, { u }));
          }),
        );
        // Each inline part as a token the page resolves over its own
        // transport (`inlineImageToken`): a route written here would load
        // from the page's server, which an in-browser host is not.
        const inline = new Map<string, string>();
        for (const a of inlineParts(m)) {
          const sig = await signMail("inline", [
            threadId,
            m.id as string,
            a.ref.partId,
          ]);
          inline.set(a.contentId!, inlineImageToken(inlineImages.length));
          inlineImages.push({ partId: a.ref.partId, sig });
        }
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
        inlineImages,
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

/** `bytes` as a `data:` URL of `mime` — only an image type; anything else draws nothing. */
function dataUrl(bytes: Uint8Array, mime: string): string {
  if (!/^image\/[\w.+-]+$/i.test(mime)) return "";
  // `btoa` over chunks: portable (a browser host has no Buffer), and no
  // spread of a whole image into one call's arguments.
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/**
 * One message's inline images as `data:` URLs (`mailInlineImages`), for a
 * reader no URL of this server reaches.
 */
export const mailInlineImagesServed = serveValue(mailInlineImages, {
  source: "external",
  // Read through the cache like the thread itself (and a part kept in
  // infra/attachments): re-read when the cache says the thread moved.
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
  loader: async ({ threadId, messageId }) => {
    try {
      const read = await mailCache.thread(threadId);
      const m = read.content.messages.find((x) => x.id === messageId);
      if (m === undefined) {
        throw mailInlineImages.refuse(
          "gone",
          `No message ${messageId} in thread ${threadId}`,
        );
      }
      const srcs = await Promise.all(
        inlineParts(m).map(async (a) => {
          const part = await readPart(threadId, messageId, a.ref.partId);
          return dataUrl(part.bytes, part.mime);
        }),
      );
      return { srcs };
    } catch (err) {
      if (err instanceof MailThreadUnavailableError) {
        throw mailInlineImages.refuse(err.reason, err.message);
      }
      throw err;
    }
  },
});

onMailThreadsChanged((ids) => {
  if (ids === undefined) mailThreadServed.notify();
  else for (const id of ids) mailThreadServed.notify({ id });
  // Only the open messages' images are subscribed: a handful, re-read whole.
  mailInlineImagesServed.notify();
});
