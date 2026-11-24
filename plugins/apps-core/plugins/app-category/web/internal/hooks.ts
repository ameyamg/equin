import { useMemo } from "react";
import { useEndpointMutation } from "@plugins/infra/plugins/endpoints/web";
import { useLive } from "@plugins/network/plugins/live/web";
import {
  combineResources,
  mapResource,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import { useTagTree } from "@plugins/tag-tree/plugins/engine/web";
import {
  appCategoryAssignments,
  appCategoryTree,
  setAppCategory,
} from "../../core";

/** One app's category as a surface reads it: its tag, and the path to it from the root. */
export interface AppCategory {
  /** The leaf tag the app is filed under. */
  readonly tagId: string;
  /** Root first, ending at `tagId`: each tag's id and name. */
  readonly path: readonly { readonly id: string; readonly name: string }[];
}

/**
 * Every app's category, live: app id → its category, or `null` for an app
 * filed as uncategorised. An app with no row yet (not filed — the warm-up
 * files it on the backend's next boot) is absent from the map, which a
 * surface treats as uncategorised too.
 */
export function useAppCategories() {
  const assignments = useLive(appCategoryAssignments);
  const tags = useTagTree(appCategoryTree);
  return useMemo(
    () =>
      mapResource(
        combineResources({ rows: assignments, tree: tags }),
        ({ rows, tree }): ReadonlyMap<string, AppCategory | null> => {
          const byId = new Map<string, (typeof tree)[number]>(
            tree.map((t) => [t.id, t]),
          );
          const pathOf = (tagId: string) => {
            const path: { id: string; name: string }[] = [];
            const seen = new Set<string>();
            for (
              let t = byId.get(tagId);
              t !== undefined && !seen.has(t.id);
              t = t.parentId === null ? undefined : byId.get(t.parentId)
            ) {
              seen.add(t.id);
              path.unshift({ id: t.id, name: t.name });
            }
            return path;
          };
          return new Map(
            rows.map((r): [string, AppCategory | null] => [
              r.id,
              r.tagId === null || !byId.has(r.tagId)
                ? null
                : { tagId: r.tagId, path: pathOf(r.tagId) },
            ]),
          );
        },
      ),
    [assignments, tags],
  );
}

/**
 * File an app under one category (or none). A failed write surfaces through
 * the endpoint layer's global error toast; every surface keeps showing the
 * stored value (the live rows).
 */
export function useSetAppCategory(): {
  pending: boolean;
  setCategory: (appId: string, tagId: string | null) => void;
} {
  const mutation = useEndpointMutation(setAppCategory);
  return {
    pending: mutation.isPending,
    setCategory: (appId, tagId) =>
      mutation.mutate({ params: { appId }, body: { tagId } }),
  };
}
