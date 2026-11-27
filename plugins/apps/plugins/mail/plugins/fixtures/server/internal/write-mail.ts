import { wallNow } from "@plugins/packages/plugins/deadline/core";
import {
  MAILBOX_ROLES,
  roleMailboxId,
  type MailboxId,
  type MailboxRole,
  type MailProvider,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import {
  LOCAL_ACCOUNT_ID,
  LOCAL_MAILBOX_COLORS,
  localMail,
} from "@plugins/apps/plugins/mail/plugins/providers/plugins/local/server";
import type {
  MailFixture,
  MailFixtureAttachment,
  MailFixtureMessage,
} from "../../core";

const MINUTE_MS = 60 * 1000;

export interface WriteMailFixtureOptions {
  /**
   * The bytes of an attachment's `dataPath` (relative to the demo's data/
   * folder); a fixture naming one with no reader given is refused.
   */
  readData?: (dataPath: string) => Uint8Array;
  /** The instant `ago` counts back from (default: now). */
  now?: number;
}

/**
 * Write `fixture` into the local mail provider's mailbox through its real
 * write paths: the account (`localMail.setAccount`), each label through the
 * provider's own mailbox writes (`createMailbox` level by level, then
 * `setMailboxColor` — what the label endpoints call, without the cache, so a
 * seed leaves the Mail cache empty and it fills on first open), and each
 * message through `localMail.deliver`, the inbound write (mail arriving), in
 * thread order — a reply In-Reply-To the message before it, its References
 * every earlier one. Derives nothing else.
 */
export async function writeMailFixture(
  fixture: MailFixture,
  opts: WriteMailFixtureOptions = {},
): Promise<void> {
  const now = opts.now ?? wallNow("human-time");
  const { address, displayName, signature } = fixture.account;
  await localMail.setAccount({
    address,
    displayName,
    signature: signature ?? null,
  });
  const provider = localMail.definition.open(LOCAL_ACCOUNT_ID);
  const labels = await writeLabels(provider, fixture.labels);
  const domain = address.slice(address.indexOf("@") + 1);
  for (const thread of fixture.threads) {
    const rfcIds: string[] = [];
    let previousAt = -Infinity;
    for (const message of thread.messages) {
      const date = new Date(now - agoMs(message));
      if (date.getTime() < previousAt) {
        throw new Error(
          `[mail fixture] thread ${thread.id}: message ${message.id} is older than the one before it (oldest first)`,
        );
      }
      previousAt = date.getTime();
      const rfc = `<${message.id}@${domain}>`;
      await localMail.deliver({
        threadId: thread.id,
        id: message.id,
        date,
        from: message.from,
        to: message.to,
        cc: message.cc ?? [],
        subject: message.subject,
        text: message.text ?? null,
        html: message.html ?? null,
        mailboxes: mailboxesOf(message, labels),
        unread: message.unread ?? false,
        starred: message.starred ?? false,
        isDraft: message.draft ?? false,
        rfc822MessageId: rfc,
        inReplyTo: rfcIds.at(-1) ?? null,
        references: [...rfcIds],
        attachments: (message.attachments ?? []).map((a) => ({
          filename: a.filename,
          mimeType: a.mimeType,
          bytes: bytesOf(a, message.id, opts.readData),
          contentId: a.contentId ?? null,
        })),
      });
      rfcIds.push(rfc);
    }
  }
}

function agoMs(m: MailFixtureMessage): number {
  const { days = 0, hours = 0, minutes = 0 } = m.ago;
  return ((days * 24 + hours) * 60 + minutes) * MINUTE_MS;
}

/** Each label path, made level by level (a level another path made is reused), coloured from the provider's palette. */
async function writeLabels(
  provider: MailProvider,
  labels: MailFixture["labels"],
): Promise<Map<string, MailboxId>> {
  const ids = new Map<string, MailboxId>();
  const pathOf = async (path: string): Promise<MailboxId> => {
    const names = path.split("/").map((n) => n.trim());
    if (names.some((n) => n === "")) {
      throw new Error(`[mail fixture] label path "${path}" has an empty level`);
    }
    let parent: MailboxId | null = null;
    for (let i = 0; i < names.length; i++) {
      const key = names.slice(0, i + 1).join("/");
      let id = ids.get(key);
      if (id === undefined) {
        id = (
          await provider.createMailbox({ name: names[i]!, parentId: parent })
        ).id;
        ids.set(key, id);
      }
      parent = id;
    }
    return parent!;
  };
  for (const label of labels) {
    const id = await pathOf(label.path);
    if (label.color === undefined) continue;
    const background = label.color.toLowerCase();
    const color = LOCAL_MAILBOX_COLORS.find((c) => c.background === background);
    if (color === undefined) {
      throw new Error(
        `[mail fixture] label "${label.path}": ${label.color} is not a colour of the provider's palette (${LOCAL_MAILBOX_COLORS.map((c) => c.background).join(", ")})`,
      );
    }
    await provider.setMailboxColor(id, color);
  }
  return ids;
}

/** A message's mailboxes: role names as role ids, label paths as the labels written. Absent: the Inbox (Drafts for a draft). */
function mailboxesOf(
  m: MailFixtureMessage,
  labels: ReadonlyMap<string, MailboxId>,
): MailboxId[] {
  const names = m.mailboxes ?? [m.draft ? "drafts" : "inbox"];
  return names.map((name) => {
    if ((MAILBOX_ROLES as readonly string[]).includes(name)) {
      return roleMailboxId(name as MailboxRole);
    }
    const id = labels.get(name);
    if (id === undefined) {
      throw new Error(
        `[mail fixture] message ${m.id} names "${name}", which is neither a mailbox role nor a fixture label`,
      );
    }
    return id;
  });
}

function bytesOf(
  a: MailFixtureAttachment,
  messageId: string,
  readData: WriteMailFixtureOptions["readData"],
): Uint8Array {
  if ("bytes" in a.source) return a.source.bytes;
  if (readData === undefined) {
    throw new Error(
      `[mail fixture] message ${messageId}'s attachment ${a.filename} is read from data/${a.source.dataPath}, but no readData was given`,
    );
  }
  return readData(a.source.dataPath);
}
