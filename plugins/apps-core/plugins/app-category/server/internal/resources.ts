import { serveCollection } from "@plugins/network/plugins/live/server";
import {
  serveTagTree,
  singleTagCarrier,
} from "@plugins/tag-tree/plugins/engine/server";
import {
  appCategoryAssignments,
  appCategoryTags,
  appCategoryTree,
} from "../../core";
import { _appCategories, _appCategoryTags } from "./tables";

// Both collections are their tables whole (`all` sets): the change feed routes
// each write — an assignment, a tag edit, a tag delete's carrier rewrite.
export const appCategoryAssignmentsServed = serveCollection(
  appCategoryAssignments,
  { from: _appCategories },
);

export const appCategoryTagsServed = serveCollection(appCategoryTags, {
  from: _appCategoryTags,
});

/** The tree as the engine serves it: deleting a tag lifts its apps to its parent. */
export const servedAppCategoryTree = serveTagTree(appCategoryTree, {
  table: _appCategoryTags,
  carriers: [singleTagCarrier(_appCategories, _appCategories.tagId)],
});
