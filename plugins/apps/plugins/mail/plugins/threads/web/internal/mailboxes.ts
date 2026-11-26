import { useMemo } from "react";
import { useLive } from "@plugins/network/plugins/live/web";
import type {
  FieldOption,
  FieldOptionsResult,
} from "@plugins/primitives/plugins/data-view/core";
import { tagFieldOptions } from "@plugins/tag-tree/plugins/engine/core";
import {
  mailMailboxes,
  type MailMailboxRow,
} from "@plugins/apps/plugins/mail/plugins/cache/core";
import {
  mailboxRoleOf,
  type Mailbox,
  type MailboxId,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import { Rank } from "@plugins/primitives/plugins/rank/core";
import type { TagPickerRow } from "@plugins/tag-tree/plugins/picker/web";

/** The account's mailboxes as the read stands: not known yet, failed, or known. */
export type MailboxesState =
  | { kind: "loading" }
  /** The read failed: a refusal (not connected, offline — the list says why
   *  in place) or any other error, shown where the labels go. */
  | { kind: "failed"; error: Error; refetch: () => Promise<void> }
  | {
      kind: "ready";
      mailboxes: readonly Mailbox[];
      byId: ReadonlyMap<MailboxId, Mailbox>;
    };

/** A `mail.mailboxes` row as the provider contract's `Mailbox`. */
export function mailboxOfRow(row: MailMailboxRow): Mailbox {
  return {
    id: row.id as MailboxId,
    name: row.name,
    role: row.role,
    kind: row.kind,
    parentId: row.parentId as MailboxId | null,
    counts:
      row.threadsTotal === null || row.threadsUnread === null
        ? null
        : { threads: row.threadsTotal, unread: row.threadsUnread },
    color: row.color,
  };
}

/**
 * The connected account's mailboxes (`mail.mailboxes`, whole): the sidebar's
 * labels and counts, the label views, the Labels field's options. A refused
 * read (not connected) is `failed` here — the list itself says why.
 */
export function useMailboxes(): {
  state: MailboxesState;
  options: FieldOptionsResult;
} {
  const read = useLive(mailMailboxes);
  return useMemo(() => {
    if (read.status === "loading") {
      return { state: { kind: "loading" } as const, options: read };
    }
    if (read.status === "error") {
      return {
        state: {
          kind: "failed",
          error: read.error,
          refetch: read.refetch,
        } as const,
        options: read,
      };
    }
    const mailboxes = read.data.map(mailboxOfRow);
    return {
      state: {
        kind: "ready",
        mailboxes,
        byId: new Map(mailboxes.map((m) => [m.id, m])),
      },
      options: { status: "ready", options: mailboxOptions(mailboxes) },
    };
  }, [read]);
}

/**
 * The mailboxes field's options: the user's labels as a tag forest (the tag
 * tree's own `tagFieldOptions` over `labelTagRows` — each named by its own
 * name under its parent, its colour as `swatch`), so the standard tags cell,
 * editor (the tag picker) and nested filters read them; then the roles and
 * the provider's categories, `fixed` (triage moves a thread in and out of
 * them, never a label edit) and `quiet` (a filter names them, a cell does not).
 */
function mailboxOptions(mailboxes: readonly Mailbox[]): FieldOption[] {
  return [
    ...tagFieldOptions(labelTagRows(mailboxes)),
    ...mailboxes
      .filter((m) => m.kind !== "user")
      .map((m) => ({
        value: m.id,
        label: m.name,
        fixed: true as const,
        quiet: true as const,
      })),
  ];
}

/** A mailbox as a person names it: a role's own name, a label's `/` path. */
export function mailboxLabel(
  mailbox: Mailbox,
  mailboxes: readonly Mailbox[],
): string {
  if (mailboxRoleOf(mailbox.id) !== null) return mailbox.name;
  const parts = [mailbox.name];
  const seen = new Set([mailbox.id]);
  let parent = mailbox.parentId;
  while (parent !== null && !seen.has(parent)) {
    seen.add(parent);
    const at = mailboxes.find((m) => m.id === parent);
    if (at === undefined) break;
    parts.unshift(at.name);
    parent = at.parentId;
  }
  return parts.join(" / ");
}

/** The user's own labels (not roles, not provider categories). */
export function userLabels(mailboxes: readonly Mailbox[]): Mailbox[] {
  return mailboxes.filter((m) => m.kind === "user");
}

/**
 * The user's labels as tag-picker rows: each its own name under its parent,
 * its own colour (the provider's background; a label without one wears its
 * nearest coloured ancestor's, as the picker draws an uncoloured tag), no
 * icon. The provider keeps no label order (Gmail sorts by name), so siblings
 * are ranked by name.
 */
export function labelTagRows(mailboxes: readonly Mailbox[]): TagPickerRow[] {
  const labels = userLabels(mailboxes).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const ids = new Set(labels.map((l) => l.id));
  const ranks = Rank.nBetween(null, null, labels.length);
  return labels.map((l, i) => ({
    id: l.id,
    name: l.name,
    parentId: l.parentId !== null && ids.has(l.parentId) ? l.parentId : null,
    color: l.color?.background ?? null,
    childColors: null,
    icon: null,
    rank: ranks[i]!.toString(),
  }));
}
