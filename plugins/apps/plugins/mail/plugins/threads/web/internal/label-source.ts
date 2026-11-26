import { useMemo } from "react";
import { useEndpointMutation } from "@plugins/infra/plugins/endpoints/web";
import { useLive } from "@plugins/network/plugins/live/web";
import { useConfirmDialog } from "@plugins/primitives/plugins/overlay/plugins/imperative-dialog/plugins/confirm/web";
import {
  mapResource,
  useCombinedResources,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import type {
  TagPickerSource,
  TagPickerWrites,
} from "@plugins/tag-tree/plugins/picker/web";
import {
  createMailLabel,
  deleteMailLabel,
  mailAccountStatus,
  mailMailboxes,
  updateMailLabel,
  type MailLabelChange,
} from "@plugins/apps/plugins/mail/plugins/cache/core";
import { labelTagRows, mailboxOfRow } from "./mailboxes";

/**
 * The mail account's labels as a tag-picker source (`TagPickerSource`): the
 * rows live (`mail.mailboxes`, user labels only), the writes the label
 * endpoints, and what the provider can do — no manual order (labels sort by
 * name), no icons, no shading, its own colour palette (`mail.account-status`'s
 * `mailboxColors`; a colour cleared only where it says so). Loading until
 * both reads are in; either failing fails it.
 */
export function useMailLabelSource(): TagPickerSource {
  const mailboxes = useLive(mailMailboxes);
  const status = useLive(mailAccountStatus);
  const create = useEndpointMutation(createMailLabel).mutateAsync;
  const update = useEndpointMutation(updateMailLabel).mutateAsync;
  const remove = useEndpointMutation(deleteMailLabel).mutateAsync;

  const combined = useCombinedResources({ mailboxes, status });
  const read = useMemo(
    () =>
      mapResource(combined, ({ mailboxes: rows, status: account }) => {
        const colors =
          account.kind === "account" ? account.mailboxColors : null;
        return {
          tags: labelTagRows(rows.map(mailboxOfRow)),
          abilities: {
            reorder: false,
            icons: false,
            shadeChildren: false,
            palette: colors?.palette.map((c) => c.background) ?? [],
            inheritColor: colors?.clearable ?? false,
          },
        };
      }),
    [combined],
  );
  const confirm = useConfirmDialog();
  const writes = useMemo((): TagPickerWrites => {
    const change = (id: string, body: MailLabelChange) =>
      update({ params: { id }, body });
    return {
      create: ({ name, parentId, color, icon, extra }) => {
        if (icon != null || extra !== undefined || color != null) {
          throw new Error(
            "mail: a label is made with a name only (the picker offers no icon, and colours it after)",
          );
        }
        return create({
          body: parentId == null ? { path: name } : { name, parentId },
        });
      },
      createPath: (segments) => create({ body: { path: segments.join("/") } }),
      update: async (id, body) => {
        if (
          body.icon !== undefined ||
          body.childColors !== undefined ||
          body.extra !== undefined
        ) {
          throw new Error(
            "mail: a label has no icon or child shading — the picker's abilities say so, so nothing may ask",
          );
        }
        if (body.name !== undefined) {
          await change(id, { kind: "rename", name: body.name });
        }
        if (body.color !== undefined) {
          await change(id, { kind: "color", background: body.color });
        }
      },
      // Labels keep no order: a move is a change of parent only.
      move: (id, dest) => change(id, { kind: "move", parentId: dest.parentId }),
      // Unlike a tag tree's delete (its carriers get its parent), a label's
      // threads lose it at the provider for good: asked first.
      remove: async (id) => {
        const name =
          read.status === "ready"
            ? read.data.tags.find((t) => t.id === id)?.name
            : undefined;
        await confirm({
          title: `Delete the label “${name ?? id}”?`,
          description:
            "Its threads lose it and keep their other labels; its sub-labels move up to its parent.",
          confirmLabel: "Delete label",
          onConfirm: () => remove({ params: { id } }),
        });
      },
    };
  }, [read, create, update, remove, confirm]);

  return useMemo(() => ({ read, writes }), [read, writes]);
}
