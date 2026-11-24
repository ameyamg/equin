import { nullable } from "@plugins/fields/core";
import { textField } from "@plugins/fields/plugins/text/plugins/config/core";
import { tagFieldType } from "@plugins/fields/plugins/tag/core";
import { clientFields } from "@plugins/network/plugins/live/core";
import { installedApp } from "@plugins/apps-core/plugins/app-launcher/core";

/**
 * Each installed app's category, as a field of every list of apps (the Home
 * gallery groups, sorts, filters and edits by it): the id of its tag in the
 * app category tree — a `tag` field, so grouping nests along the tree. Its
 * options are the live tree (this plugin's web presentation), its values the
 * browser's read of the assignments (`ClientFields.Resolve`).
 */
export const appCategoryFields = clientFields(installedApp, "category", {
  fields: {
    category: nullable(
      Object.freeze({
        ...textField({ label: "Category" }),
        type: tagFieldType,
      }),
    ),
  },
});
