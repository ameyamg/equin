import { useMemo } from "react";
import { ControlSizeProvider } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import type { ItemActionProps } from "@plugins/primitives/plugins/data-view/web";
import { mapRow, useLive } from "@plugins/network/plugins/live/web";
import {
  combineResources,
  foldResource,
  ResourceErrorInline,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import { rolledUpTagCounts } from "@plugins/tag-tree/plugins/engine/core";
import { useTagTree } from "@plugins/tag-tree/plugins/engine/web";
import { TagPickerPopover } from "@plugins/tag-tree/plugins/picker/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import type { AppRow } from "@plugins/apps-core/plugins/app-launcher/web";
import { appCategoryAssignments, appCategoryTree } from "../../core";
import { useSetAppCategory } from "./hooks";

const categoryIcon = symbol("label");

/**
 * Change category — a revealed item action on every app of an app gallery: the shared tag picker over the app category tree (pick, create a
 * typed path, rename, recolour, nest, reorder, delete), on the row's app.
 */
export function CategoryAction({ row }: ItemActionProps<AppRow>) {
  const appId = row.id;
  const tagRead = mapRow(
    useLive(appCategoryAssignments, { id: appId }),
    (r) => r?.tagId ?? null,
  );
  const { pending, setCategory } = useSetAppCategory();
  const counts = useCategoryCounts();
  return (
    <ControlSizeProvider size="sm">
      {foldResource(tagRead, {
        // Pending until the app's category is known, never "uncategorised".
        loading: () => (
          <IconButton
            icon={categoryIcon}
            label="Change category"
            variant="ghost"
            loading
          />
        ),
        error: (error) => (
          <ResourceErrorInline
            variant="icon"
            icon={categoryIcon}
            subject="the app's category"
            error={error}
            refetch={tagRead.refetch}
          />
        ),
        ready: (tagId) => (
          <TagPickerPopover
            tree={appCategoryTree}
            selected={tagId === null ? [] : [tagId]}
            offerNone
            counts={counts}
            onPick={(id) => setCategory(appId, id)}
            trigger={
              <IconButton
                icon={categoryIcon}
                label="Change category"
                variant="ghost"
                loading={pending}
              />
            }
          />
        ),
      })}
    </ControlSizeProvider>
  );
}

/** How many apps each category holds, itself or below — the picker's count column. */
function useCategoryCounts(): ReadonlyMap<string, number> | undefined {
  const assignments = useLive(appCategoryAssignments);
  const tags = useTagTree(appCategoryTree);
  return useMemo(
    () =>
      // No count column until both are known (or while either failed).
      foldResource(combineResources({ assignments, tags }), {
        loading: () => undefined,
        error: () => undefined,
        ready: ({ assignments: rows, tags: tree }) =>
          rolledUpTagCounts(
            rows.flatMap((a) => (a.tagId === null ? [] : [[a.tagId]])),
            tree,
          ),
      }),
    [assignments, tags],
  );
}
