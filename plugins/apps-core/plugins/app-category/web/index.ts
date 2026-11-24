import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { IdKinds } from "@plugins/ids/web";
import { ClientFields } from "@plugins/network/plugins/live/web";
import { AppLauncherSlots } from "@plugins/apps-core/plugins/app-launcher/web";
import { appCategoryFields, appCategoryIdKind } from "../core";
import { CategoryAction } from "./internal/category-action";
import { CategoryResolver, categoryPresentation } from "./internal/fields";

export { useAppCategories, useSetAppCategory } from "./internal/hooks";
export type { AppCategory } from "./internal/hooks";

export default {
  description:
    "App categories, web half: each app's category as a `tag` field of every list of apps (group, sort and filter by it — grouping nests along the tree), a Change category action on every app of an app gallery (AppLauncherSlots.AppActions) (the shared tag picker over the app category tree), the app category id kind (`apcat-…`), and useAppCategories / useSetAppCategory for surfaces placing or filing apps by category.",
  contributions: [
    IdKinds.Kind({ kind: appCategoryIdKind }),
    ClientFields.Resolve({
      fields: appCategoryFields,
      component: CategoryResolver,
    }),
    categoryPresentation,
    AppLauncherSlots.AppActions({
      id: "change-category",
      component: CategoryAction,
    }),
  ],
} satisfies PluginDefinition;
