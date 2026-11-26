import { z } from "zod";
import {
  roleMailboxId,
  type MailboxId,
} from "@plugins/apps/plugins/mail/plugins/provider/core";

// Triage (design §6): what the user does to threads, provider-neutral. Each
// op SETS a target state (never toggles), so the durable job applying it may
// replay it, and its effect is ONE pure reducer (`applyMailOp`) the server
// writes into the cache and the browser draws as its prediction — never two
// spellings of what a write does.

const INBOX = roleMailboxId("inbox");
const TRASH = roleMailboxId("trash");
const SPAM = roleMailboxId("spam");

export const MailThreadOpSchema = z.discriminatedUnion("kind", [
  /** Done: out of the inbox. */
  z.object({ kind: z.literal("archive") }),
  /** Back to the inbox, out of trash and spam. */
  z.object({ kind: z.literal("move-to-inbox") }),
  /** To the trash (out of the inbox). */
  z.object({ kind: z.literal("trash") }),
  /** Reported as spam: to spam, out of the inbox. */
  z.object({ kind: z.literal("spam") }),
  /** Not spam: out of spam, back to the inbox. */
  z.object({ kind: z.literal("not-spam") }),
  z.object({ kind: z.literal("read"), unread: z.boolean() }),
  /** Labels (any mailbox id, roles included) added and removed. */
  z.object({
    kind: z.literal("labels"),
    add: z.array(z.string()).max(100),
    remove: z.array(z.string()).max(100),
  }),
]);
export type MailThreadOp = z.infer<typeof MailThreadOpSchema>;

/** One op undoing part of another, on the threads it names. */
export const MailOpUndoSchema = z.object({
  op: MailThreadOpSchema,
  ids: z.array(z.string()),
});
export type MailOpUndo = z.infer<typeof MailOpUndoSchema>;

/** A thread's (or one message's) facts an op changes. */
export type MailOpFacts = {
  readonly mailboxes: readonly string[];
  readonly unread: boolean;
};

/** The mailboxes an op adds and removes (`read` moves none). */
export function mailOpMoves(op: MailThreadOp): {
  add: string[];
  remove: string[];
} {
  switch (op.kind) {
    case "archive":
      return { add: [], remove: [INBOX] };
    case "move-to-inbox":
      return { add: [INBOX], remove: [TRASH, SPAM] };
    case "trash":
      return { add: [TRASH], remove: [INBOX] };
    case "spam":
      return { add: [SPAM], remove: [INBOX] };
    case "not-spam":
      return { add: [INBOX], remove: [SPAM] };
    case "labels":
      return { add: op.add, remove: op.remove };
    case "read":
      return { add: [], remove: [] };
  }
}

/**
 * What `op` leaves of a message's facts — and of a thread's, whose facts are
 * the union over its messages: every op acts on every message the same way,
 * so applying it to the union is the union of applying it to each message.
 * The server writes it per message into the cache; the browser draws it on
 * the row.
 */
export function applyMailOp<F extends MailOpFacts>(
  facts: F,
  op: MailThreadOp,
): F {
  if (op.kind === "read") return { ...facts, unread: op.unread };
  const { add, remove } = mailOpMoves(op);
  const out = new Set(facts.mailboxes);
  for (const m of remove) out.delete(m);
  for (const m of add) out.add(m);
  return { ...facts, mailboxes: [...out] };
}

/** The row columns an op changes (a view's filter is re-decided on these). */
export function mailOpColumns(op: MailThreadOp): ("mailboxes" | "unread")[] {
  return op.kind === "read" ? ["unread"] : ["mailboxes"];
}

/**
 * The ops undoing `op` on threads as they were before it (`before`: each
 * thread's facts): per thread, what the op moved put back — the mailboxes it
 * added removed and those it removed added, the read state restored — the
 * threads with the same undo grouped into one op. Ops set states, so the undo
 * is ops too, sent like any other.
 */
export function undoMailOp(
  op: MailThreadOp,
  before: readonly { id: string; facts: MailOpFacts }[],
): MailOpUndo[] {
  const groups = new Map<string, MailOpUndo>();
  for (const { id, facts } of before) {
    const after = applyMailOp(facts, op);
    let undo: MailThreadOp | null;
    if (op.kind === "read") {
      undo =
        after.unread === facts.unread
          ? null
          : { kind: "read", unread: facts.unread };
    } else {
      const was = new Set(facts.mailboxes);
      const now = new Set(after.mailboxes);
      const add = [...was].filter((m) => !now.has(m)).sort();
      const remove = [...now].filter((m) => !was.has(m)).sort();
      undo =
        add.length + remove.length === 0
          ? null
          : { kind: "labels", add, remove };
    }
    if (undo === null) continue;
    const key = JSON.stringify(undo);
    const g = groups.get(key);
    if (g) g.ids.push(id);
    else groups.set(key, { op: undo, ids: [id] });
  }
  return [...groups.values()];
}

/** Which way a thread's primary action goes, by where it is. */
export type MailPrimaryAction = {
  op: "archive" | "not-spam" | "move-to-inbox";
  /** Its words on a button. */
  label: string;
};

/**
 * The one action a thread offers first (the row's trailing button, the
 * reader's, the `e` key): Done in the inbox, Restore (to the inbox) in the
 * trash, Not spam in spam, Move to Inbox anywhere else.
 */
export function primaryMailAction(
  mailboxes: readonly string[],
): MailPrimaryAction {
  if (mailboxes.includes(TRASH))
    return { op: "move-to-inbox", label: "Restore" };
  if (mailboxes.includes(SPAM)) return { op: "not-spam", label: "Not spam" };
  if (mailboxes.includes(INBOX)) return { op: "archive", label: "Done" };
  return { op: "move-to-inbox", label: "Move to Inbox" };
}

/** Whether a thread is in the trash (no Delete offered there). */
export function inMailTrash(mailboxes: readonly string[]): boolean {
  return mailboxes.includes(TRASH);
}

/** Whether a mailbox id is a user label (not a role). */
export function isMailRole(id: MailboxId | string): boolean {
  return id.startsWith("role:");
}
