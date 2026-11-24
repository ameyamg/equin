import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { IdKinds } from "@plugins/ids/server";
import { TagTrees } from "@plugins/tag-tree/plugins/engine/server";
import { appCategoryIdKind, setAppCategory } from "../core";
import { handleSetAppCategory } from "./internal/handlers";
import {
  appCategoryAssignmentsServed,
  appCategoryTagsServed,
  servedAppCategoryTree,
} from "./internal/resources";
import { fileNewAppsWarmup } from "./internal/seed";

export default {
  description:
    "App categories in the DB: the app category tree (app_category_tags, served through the tag-tree engine; a deleted tag's apps move to its parent), each app's one category (app_categories) and its PUT, both live collections, and the warm-up filing each newly declared app under the default path its defineApp names.",
  httpRoutes: {
    [setAppCategory.route]: handleSetAppCategory,
  },
  register: [fileNewAppsWarmup],
  contributions: [
    IdKinds.Kind({ kind: appCategoryIdKind }),
    ...appCategoryAssignmentsServed.declare,
    ...appCategoryTagsServed.declare,
    TagTrees.Tree(servedAppCategoryTree),
  ],
} satisfies ServerPluginDefinition;
