import type { ReactElement } from "react";
import type { OrphanEntry } from "@plugins/config_v2/core";
import {
  defineItemActions,
  type ItemActionProps,
} from "@plugins/primitives/plugins/data-view/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import { useEndpointMutation } from "@plugins/infra/plugins/endpoints/web";
import { useConfirmDialog } from "@plugins/primitives/plugins/overlay/plugins/imperative-dialog/plugins/confirm/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { discardConfigOrphanEndpoint } from "../../shared/discard";

const discardIcon = symbol("delete");

/** Row actions of the Config Orphans list. */
export const ConfigOrphanItemActions = defineItemActions<OrphanEntry>();

/**
 * Discard — removes the orphan's files from the served config generation,
 * after a confirm (the user layer is not versioned). The row leaves the list
 * when the audit re-reads the dir.
 */
export function DiscardOrphanAction({
  row,
}: ItemActionProps<OrphanEntry>): ReactElement {
  const confirmDialog = useConfirmDialog();
  const discard = useEndpointMutation(discardConfigOrphanEndpoint);
  const holdsData = row.riskClass === "stranded-data";
  // The list only renders from the machine's audit, so a transport without
  // the computer never reaches a row; the arm is still answered, not assumed.
  if (discard.kind === "unavailable") {
    return (
      <IconButton
        icon={discardIcon}
        label="Discard"
        tooltip={discard.message}
        variant="ghost"
        disabled
      />
    );
  }
  return (
    <IconButton
      icon={discardIcon}
      label="Discard"
      tooltip="Delete this config's leftover files"
      variant="ghost"
      onClick={(e) => {
        e.stopPropagation();
        void confirmDialog({
          title: `Discard ${row.storeKey}?`,
          description: holdsData
            ? `This deletes ${row.files.length} file(s), among them saved settings no live config reads any more. Saved settings are not versioned: this cannot be undone.`
            : `This deletes ${row.files.length} leftover file(s) that hold no saved settings.`,
          confirmLabel: "Discard",
          onConfirm: () =>
            discard.mutateAsync({ body: { storeKey: row.storeKey } }),
        });
      }}
    />
  );
}
