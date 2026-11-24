import { defineIdKind } from "@plugins/ids/core";
import { liveCollection } from "@plugins/network/plugins/live/core";
import {
  defineTagTree,
  TAG_TREE_MAX,
  tagTreeEntityRef,
} from "@plugins/tag-tree/plugins/engine/core";

// The app categories — one `tag-tree` declaration (table, live collection,
// tree handle). Each app carries at most one tag of it (`app_categories.tagId`,
// `./assignments.ts`).

/** An app category's id: `apcat-<epochSeconds>-<6 base36>`. */
export const appCategoryIdKind = defineIdKind({
  prefix: "apcat",
  label: "App category",
});

export const appCategoryTagsEntityRef = tagTreeEntityRef("app_category_tags", {
  idKind: appCategoryIdKind,
});

/**
 * Every app category, live, in rank order — the whole tree, capped at the
 * engine's `TAG_TREE_MAX`. The tag-tree spelling written out: the resource
 * scanners read a spec only as an inline object literal.
 */
export const appCategoryTags = liveCollection("apps.categories.tags.all", {
  from: appCategoryTagsEntityRef,
  pick: ["name"],
  carry: {
    pick: [
      "id",
      "parentId",
      "color",
      "childColors",
      "icon",
      "rank",
      "createdAt",
      "updatedAt",
    ],
  },
  id: "id",
  all: {
    orderBy: [["rank", "asc"]],
    max: TAG_TREE_MAX,
  },
});

/** The app category tree: the `:tree` id `app-categories` of the tag-tree endpoints. */
export const appCategoryTree = defineTagTree({
  id: "app-categories",
  entity: appCategoryTagsEntityRef,
  collection: appCategoryTags,
});
