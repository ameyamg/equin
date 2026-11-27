import { z } from "zod";
import { nullable } from "@plugins/fields/core";
import { intField } from "@plugins/fields/plugins/int/plugins/config/core";
import { jsonField } from "@plugins/fields/plugins/json/plugins/config/core";
import {
  enumTextField,
  textField,
} from "@plugins/fields/plugins/text/plugins/config/core";
import {
  liveCollection,
  type LiveRowsCollection,
} from "@plugins/network/plugins/live/core";
import { MAILBOX_ROLES } from "@plugins/apps/plugins/mail/plugins/provider/core";

/**
 * Every mailbox of the connected account — roles, categories, labels — with
 * the provider's exact counts (Gmail's `labels.get` threadsTotal /
 * threadsUnread), the sidebar's badges. Served external from the cache,
 * notified when the cache relists them.
 */
export const mailMailboxes = liveCollection("mail.mailboxes", {
  fields: {
    name: textField({ label: "Name", primary: true }),
    role: nullable(enumTextField(MAILBOX_ROLES, { label: "Role" })),
    kind: enumTextField(["system", "user"], { label: "Kind" }),
    parentId: nullable(textField({ label: "Parent" })),
    threadsTotal: nullable(intField({ label: "Threads" })),
    threadsUnread: nullable(intField({ label: "Unread" })),
  },
  carry: {
    fields: {
      id: textField(),
      color: nullable(
        jsonField({
          schema: z.object({ text: z.string(), background: z.string() }),
        }),
      ),
    },
  },
  id: "id",
  // Its reads need the account, as mail.threads' do (MAIL_THREADS_REFUSALS).
  refusals: ["not-connected", "provider-not-chosen", "offline-not-cached"],
  all: {
    orderBy: [["name", "asc"]],
    // Gmail caps an account at 10,000 labels; the account measured on
    // 2026-11-26 has 43 (28 user labels).
    unbounded: {
      reason: "one account's mailboxes, listed whole by the provider",
      budget: 500,
    },
  },
});

/** One mailbox: a row of {@link mailMailboxes}. */
export type MailMailboxRow =
  typeof mailMailboxes extends LiveRowsCollection<infer R> ? R : never;
