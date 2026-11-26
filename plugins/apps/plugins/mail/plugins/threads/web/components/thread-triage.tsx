import type { ReactNode } from "react";
import type { ItemActionProps } from "@plugins/primitives/plugins/data-view/web";
import { useMultiSelect } from "@plugins/primitives/plugins/multi-select/web";
import type { MailThreadRow } from "@plugins/apps/plugins/mail/plugins/cache/core";
import { BulkThreadActions, ThreadActions } from "../internal/actions";

/** A row's hover cluster: Label, Delete, the primary action. */
export function RowTriage({ row }: ItemActionProps<MailThreadRow>): ReactNode {
  return (
    // A click on an action is not a click on the row (which opens it).
    <span onClick={(e) => e.stopPropagation()}>
      <ThreadActions row={row} />
    </span>
  );
}

/**
 * The selection bar's actions, over the checked threads by id (the bar acts
 * on ids: the server answers each op's undo, so it needs no thread's facts).
 */
export function MailBulkActions({ inTrash }: { inTrash: boolean }): ReactNode {
  const { selectedIds, clearAll } = useMultiSelect();
  return (
    <BulkThreadActions
      ids={[...selectedIds]}
      inTrash={inTrash}
      clear={clearAll}
    />
  );
}
