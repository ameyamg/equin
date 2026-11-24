import { useMemo, type ReactNode } from "react";
import {
  FieldPresentation,
  type ClientFieldReaders,
  type ClientFieldsResolverProps,
  type LiveFieldOptionsRead,
} from "@plugins/network/plugins/live/web";
import { mapResource } from "@plugins/network/plugins/live/plugins/live-state/web";
import { tagFieldOptions } from "@plugins/tag-tree/plugins/engine/core";
import { useTagTree } from "@plugins/tag-tree/plugins/engine/web";
import { appCategoryFields, appCategoryTree } from "../../core";
import { useAppCategories } from "./hooks";

type Fields = NonNullable<(typeof appCategoryFields)["__fields"]>;
type AppRow = NonNullable<(typeof appCategoryFields)["__row"]>;

/**
 * Each app's category from the live assignments: pending while they load (no
 * stand-in "uncategorised"); an app absent from a READY read, or filed as
 * none, is uncategorised (`null`, the None section).
 */
export function CategoryResolver({
  render,
}: ClientFieldsResolverProps<AppRow, Fields>): ReactNode {
  const categories = useAppCategories();
  const values = useMemo(
    () =>
      mapResource(categories, (byApp): ClientFieldReaders<AppRow, Fields> => ({
        category: (a) => byApp.get(a.id)?.tagId ?? null,
      })),
    [categories],
  );
  return render(values);
}

/** The Category field's options: the live tree, pre-order — a grouping nests along it. */
function useCategoryOptions(): LiveFieldOptionsRead {
  const tags = useTagTree(appCategoryTree);
  return useMemo(
    () =>
      mapResource(tags, (tree) =>
        tagFieldOptions(tree).map((o) => ({
          value: o.value,
          label: o.label,
          ...(o.parent !== undefined ? { parent: o.parent } : {}),
        })),
      ),
    [tags],
  );
}

export const categoryPresentation = FieldPresentation.Register({
  owner: appCategoryFields,
  fields: { category: { useOptions: useCategoryOptions } },
});
