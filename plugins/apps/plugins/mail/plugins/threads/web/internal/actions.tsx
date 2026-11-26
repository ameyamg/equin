import { useState, type ReactNode } from "react";
import { writeRows } from "@plugins/network/plugins/live/plugins/optimistic-mutation/web";
import { useFetchEndpoint } from "@plugins/infra/plugins/endpoints/web";
import { useToast } from "@plugins/shell/plugins/notifications/web";
import {
  Button,
  DialogDescription,
  DialogTitle,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { useOpenDialog } from "@plugins/primitives/plugins/overlay/plugins/imperative-dialog/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { transient } from "@plugins/primitives/plugins/kept-state/core";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import {
  applyMailOp,
  applyMailThreadOp,
  createMailLabel,
  inMailTrash,
  mailOpColumns,
  mailThreads,
  primaryMailAction,
  type MailThreadOp,
  type MailThreadRow,
} from "@plugins/apps/plugins/mail/plugins/cache/core";
import { labelColor } from "../../core";
import { labelLines } from "./label-lines";
import { useMailboxes, userLabels } from "./mailboxes";

const labelIcon = symbol("label");
const deleteIcon = symbol("delete");
const doneIcon = symbol("check");
const inboxIcon = symbol("inbox");
const restoreIcon = symbol("restore-from-trash");
const notSpamIcon = symbol("report-off");
const readIcon = symbol("drafts");
const unreadIcon = symbol("mark-email-unread");
const addIcon = symbol("add");

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
 * draw them: Label, Delete (not in the trash), Mark as unread (`withUnread`:
 * the reader) and the primary action — Done in the inbox, Restore in the
 * trash, Not spam in spam, Move to Inbox elsewhere.
 */
export function ThreadActions({
  row,
  withUnread = false,
  onLeave,
}: {
  row: MailActionRow;
  withUnread?: boolean;
  /** After an action that moves the thread away (the reader closes on it). */
  onLeave?: () => void;
}): ReactNode {
  const { run } = useMailActions();
  const primary = primaryMailAction(row.mailboxes);
  const leave = (op: MailThreadOp) => {
    run([row.id], op);
    onLeave?.();
  };
  return (
    <Line className="gap-2xs">
      <LabelMenu ids={[row.id]} has={(l) => row.mailboxes.includes(l)} />
      {withUnread ? (
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
      <IconButton
        icon={primaryIcon(primary)}
        label={primary.label}
        onClick={() => leave({ kind: primary.op })}
      />
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
      <LabelMenu ids={ids} has={() => false} />
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
 * "Label as": every user label as its `/` tree, checked when the threads
 * have it (`has`: a click removes it from them; else adds it to all), and
 * "New label" (a `/` path nests it), applied to the threads once made.
 * Interim: the shared tag picker replaces it (task-1795721629-kk5kdx).
 */
export function LabelMenu({
  ids,
  has,
}: {
  ids: readonly string[];
  /** Whether every thread has the label (a selection says no: a click adds). */
  has: (labelId: string) => boolean;
}): ReactNode {
  const { state } = useMailboxes();
  const { run } = useMailActions();
  const newLabel = useNewLabel();
  const labels = state.kind === "ready" ? userLabels(state.mailboxes) : [];
  const lines = labelLines(labels, new Set());
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<IconButton icon={labelIcon} label="Label" />}
      />
      <DropdownMenuContent align="end" className="max-h-96 min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Label as</DropdownMenuLabel>
          {state.kind === "loading" ? (
            <Loading variant="rows" count={3} />
          ) : null}
          {lines.map(({ label, depth }) => {
            const all = has(label.id);
            const color =
              state.kind === "ready"
                ? labelColor(label, state.mailboxes)
                : null;
            return (
              <DropdownMenuCheckboxItem
                key={label.id}
                checked={all}
                onClick={() =>
                  run(
                    ids,
                    all
                      ? { kind: "labels", add: [], remove: [label.id] }
                      : { kind: "labels", add: [label.id], remove: [] },
                    { toast: false },
                  )
                }
              >
                <Line
                  className="gap-xsm"
                  style={{ paddingLeft: `${depth}rem` }}
                >
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ background: color ?? "var(--muted-foreground)" }}
                  />
                  {label.name}
                </Line>
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            void newLabel().then((id) => {
              if (id !== null) {
                run(
                  ids,
                  { kind: "labels", add: [id], remove: [] },
                  {
                    toast: false,
                  },
                );
              }
            })
          }
        >
          <Icon icon={addIcon} className="size-4" />
          New label
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Asks for a new label's name (a `/` path nests it: "Travel/Ski 2027") and
 * makes it; answers its id, or null when dismissed.
 */
export function useNewLabel(): () => Promise<string | null> {
  const openDialog = useOpenDialog();
  const fetchEndpoint = useFetchEndpoint();
  return async () => {
    let made: string | null = null;
    await openDialog((close) => (
      <LabelNameForm
        title="New label"
        description="Nest it under another with a slash: Travel/Ski 2027."
        initial=""
        submit="Create"
        onSubmit={async (path) => {
          const r = await fetchEndpoint(
            createMailLabel,
            {},
            { body: { path } },
          );
          made = r.id;
          close();
        }}
      />
    ));
    return made;
  };
}

/** A label's name, asked in a dialog (create, rename). */
export function LabelNameForm({
  title,
  description,
  initial,
  submit,
  onSubmit,
}: {
  title: string;
  description: string;
  initial: string;
  submit: string;
  onSubmit: (name: string) => Promise<void>;
}): ReactNode {
  const [name, setName] = useState(initial);
  const ok = name.trim() !== "" && name.trim() !== initial;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      <Stack gap="md">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <Input
          autoFocus
          keep={transient("a label name typed once, sent with the dialog")}
          value={name}
          aria-label="Label name"
          onChange={(e) => setName(e.target.value)}
        />
        <Line>
          <Fill />
          <Button
            type="submit"
            disabled={!ok}
            onClick={() => onSubmit(name.trim())}
          >
            {submit}
          </Button>
        </Line>
      </Stack>
    </form>
  );
}
