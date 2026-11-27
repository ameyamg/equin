import { useState, type ReactNode } from "react";
import { writeRows } from "@plugins/network/plugins/live/plugins/optimistic-mutation/web";
import { useFetchEndpoint } from "@plugins/infra/plugins/endpoints/web";
import { useToast } from "@plugins/shell/plugins/notifications/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import { Button } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Icon } from "@plugins/ui/plugins/icons/web";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { TagPickerPopover } from "@plugins/tag-tree/plugins/picker/web";
import {
  applyMailOp,
  applyMailThreadOp,
  inMailTrash,
  mailOpColumns,
  mailThreads,
  primaryMailAction,
  type MailThreadOp,
  type MailThreadRow,
} from "@plugins/apps/plugins/mail/plugins/cache/core";
import { useMailLabelSource } from "./label-source";

const labelIcon = symbol("label");
const deleteIcon = symbol("delete");
const doneIcon = symbol("check");
const inboxIcon = symbol("inbox");
const restoreIcon = symbol("restore-from-trash");
const notSpamIcon = symbol("report-off");
const readIcon = symbol("drafts");
const unreadIcon = symbol("mark-email-unread");

/** The facts a triage op reads of a thread (any row of `mail.threads`). */
export type MailActionRow = Pick<MailThreadRow, "id" | "mailboxes" | "unread">;

/** How each op reads in a toast, for `n` threads. */
function sentence(op: MailThreadOp, n: number): string {
  const many = n > 1;
  switch (op.kind) {
    case "archive":
      return many ? `${n} marked done` : "Marked done";
    case "move-to-inbox":
      return many ? `${n} moved to Inbox` : "Moved to Inbox";
    case "trash":
      return many ? `${n} moved to Trash` : "Moved to Trash";
    case "spam":
      return many ? `${n} reported as spam` : "Reported as spam";
    case "not-spam":
      return many ? `${n} moved to Inbox` : "Not spam: moved to Inbox";
    case "read":
      return op.unread
        ? many
          ? `${n} marked as unread`
          : "Marked as unread"
        : many
          ? `${n} marked as read`
          : "Marked as read";
    case "labels":
      return many ? `Labels changed on ${n}` : "Labels changed";
  }
}

/**
 * Triage, as the Mail list and reader call it: `run(ids, op)` draws the op
 * at once on every read of `mail.threads` (the row leaves each view it no
 * longer belongs in — `writeRows`, the same reducer the server writes),
 * sends it, and raises a toast with Undo — the inverse ops the server
 * answered, each thread as the cache held it before. A failed send says so;
 * nothing reverts silently.
 */
export function useMailActions(): {
  run: (
    ids: readonly string[],
    op: MailThreadOp,
    opts?: { toast?: boolean },
  ) => void;
} {
  const fetchEndpoint = useFetchEndpoint();
  const toast = useToast();
  const send = (ids: readonly string[], op: MailThreadOp) =>
    writeRows(mailThreads, {
      ids,
      columns: mailOpColumns(op),
      apply: (row) => applyMailOp(row, op),
      send: () =>
        fetchEndpoint(applyMailThreadOp, {}, { body: { ids: [...ids], op } }),
    });
  const failed = (err: unknown) =>
    toast({
      type: "mail-op-failed",
      title: "Mail could not save that",
      description: err instanceof Error ? err.message : String(err),
      category: "other",
      variant: "error",
    });
  const run = (
    ids: readonly string[],
    op: MailThreadOp,
    opts: { toast?: boolean } = {},
  ) => {
    if (ids.length === 0) return;
    const sent = send(ids, op);
    sent.catch(failed);
    if (opts.toast === false) return;
    toast({
      type: "mail-op",
      title: sentence(op, ids.length),
      description: "",
      category: "confirmations",
      replaces: "mail-op",
      liveAction: {
        label: "Undo",
        onClick: () => {
          // The undo is the server's answer: wait for it if it is not in yet.
          sent.then(
            ({ undo }) => {
              for (const u of undo) send(u.ids, u.op).catch(failed);
            },
            () => {},
          );
        },
      },
    });
  };
  return { run };
}

/** The icon of a thread's primary action. */
function primaryIcon(op: ReturnType<typeof primaryMailAction>) {
  if (op.label === "Restore") return restoreIcon;
  if (op.op === "not-spam") return notSpamIcon;
  if (op.op === "archive") return doneIcon;
  return inboxIcon;
}

/**
 * A thread's own actions, as the row's hover cluster and the reader's bar
 * draw them: Label, Delete (not in the trash), Mark as unread (the reader)
 * and the primary action — Done in the inbox, Restore in the trash, Not spam
 * in spam, Move to Inbox elsewhere: an icon on a row, a labelled button
 * ending the reader's bar (the prototype's).
 */
export function ThreadActions({
  row,
  place = "row",
  onLeave,
}: {
  row: MailActionRow;
  /** Where they are drawn: a row's hover cluster, or the reader's bar. */
  place?: "row" | "reader";
  /**
   * Run as an action moves the thread away, before the op is drawn (the
   * reader opens the next thread of the list, else closes).
   */
  onLeave?: () => void;
}): ReactNode {
  const { run } = useMailActions();
  const primary = primaryMailAction(row.mailboxes);
  const leave = (op: MailThreadOp) => {
    // Leave first: the reader steps on over the list as it was drawn.
    onLeave?.();
    run([row.id], op);
  };
  return (
    <Line className="gap-2xs">
      <LabelPicker ids={[row.id]} selected={row.mailboxes} />
      {place === "reader" ? (
        <IconButton
          icon={row.unread ? readIcon : unreadIcon}
          label={row.unread ? "Mark as read" : "Mark as unread"}
          onClick={() =>
            run(
              [row.id],
              { kind: "read", unread: !row.unread },
              { toast: false },
            )
          }
        />
      ) : null}
      {inMailTrash(row.mailboxes) ? null : (
        <IconButton
          icon={deleteIcon}
          label="Delete"
          onClick={() => leave({ kind: "trash" })}
        />
      )}
      {place === "reader" ? (
        <Button variant="outline" onClick={() => leave({ kind: primary.op })}>
          <Icon icon={primaryIcon(primary)} />
          {primary.label}
        </Button>
      ) : (
        <IconButton
          icon={primaryIcon(primary)}
          label={primary.label}
          onClick={() => leave({ kind: primary.op })}
        />
      )}
    </Line>
  );
}

/**
 * The selection bar's actions over the checked threads (`ids`): Done, Label,
 * Mark as read, Delete — Restore in the trash — then the selection cleared.
 */
export function BulkThreadActions({
  ids,
  inTrash,
  clear,
}: {
  ids: readonly string[];
  /** The view is the trash: Restore in place of Delete. */
  inTrash: boolean;
  clear: () => void;
}): ReactNode {
  const { run } = useMailActions();
  const act = (op: MailThreadOp) => {
    run(ids, op);
    clear();
  };
  return (
    <Line className="gap-2xs">
      <IconButton
        icon={doneIcon}
        label="Done"
        onClick={() => act({ kind: "archive" })}
      />
      <LabelPicker ids={ids} />
      <IconButton
        icon={readIcon}
        label="Mark as read"
        onClick={() => run(ids, { kind: "read", unread: false })}
      />
      {inTrash ? (
        <IconButton
          icon={restoreIcon}
          label="Restore"
          onClick={() => act({ kind: "move-to-inbox" })}
        />
      ) : (
        <IconButton
          icon={deleteIcon}
          label="Delete"
          onClick={() => act({ kind: "trash" })}
        />
      )}
    </Line>
  );
}

/**
 * Label: the shared tag picker (`tag-tree/picker`) over the account's labels
 * (`useMailLabelSource`) — search, a typed `/` path made, the tree with its
 * ＋ / ⋯ / double-click rename / drag-to-nest — a pick toggling the label on
 * the threads: removed when they have it, else added. It stays open across
 * picks, so one visit sets several labels.
 *
 * On one thread `selected` is its labels, live. On a selection (no
 * `selected`) a pick adds the label to all, is ✓ from then on, and a second
 * pick takes it off all again.
 */
export function LabelPicker({
  ids,
  selected,
}: {
  ids: readonly string[];
  /**
   * The thread's labels (it is one thread, read live), or absent for a
   * selection, whose labels the picker tracks itself.
   */
  selected?: readonly string[];
}): ReactNode {
  const source = useMailLabelSource();
  const { run } = useMailActions();
  // A selection: what this picker added, so it reads ✓ and toggles back.
  const [added, setAdded] = useState<readonly string[]>([]);
  const has = selected ?? added;
  return (
    <TagPickerPopover
      source={source}
      noun="label"
      selected={has}
      closeOnPick={false}
      onPick={(id) => {
        if (id === null) return;
        const on = has.includes(id);
        run(
          ids,
          on
            ? { kind: "labels", add: [], remove: [id] }
            : { kind: "labels", add: [id], remove: [] },
          { toast: false },
        );
        if (selected === undefined) {
          setAdded((prev) =>
            on ? prev.filter((x) => x !== id) : [...prev, id],
          );
        }
      }}
      trigger={<IconButton icon={labelIcon} label="Label" />}
    />
  );
}
