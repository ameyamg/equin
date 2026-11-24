import { z } from "zod";
import { nullable } from "@plugins/fields/core";
import { externalIdField } from "@plugins/ids/core";
import { textField } from "@plugins/fields/plugins/text/plugins/config/core";
import { dateField } from "@plugins/fields/plugins/date/plugins/config/core";
import { entityRef } from "@plugins/infra/plugins/entities/core";
import { defineEndpoint } from "@plugins/infra/plugins/endpoints/core";
import { liveCollection } from "@plugins/network/plugins/live/core";

// Which category each app is filed under. Apps are code (the `Apps.App`
// registry), not rows, so the assignment is its own table, keyed by app id.
// A row is written once per app — at first sight, under the default path its
// `defineApp({ category })` declares (the server's seed warm-up) — and from
// then on only by the user. No row = never filed; `tagId: null` = the user
// left it uncategorised (or its tag tree was deleted from under it).

export const appCategoryAssignmentFields = {
  /** The app's id (`defineApp({ id })`). */
  id: externalIdField({
    reason:
      "an app's id is declared in code (`defineApp({ id })`), not minted by this table",
    meta: { label: "App" },
  }),
  /** One tag of `appCategoryTree`, or none. */
  tagId: nullable(textField({ label: "Category" })),
  createdAt: dateField(),
  updatedAt: dateField(),
};

export const appCategoryAssignmentsEntityRef = entityRef(
  "app_categories",
  appCategoryAssignmentFields,
);

/**
 * Every app's category, live — the whole set: one row per installed app,
 * which every list of apps joins onto the apps it already holds.
 */
export const appCategoryAssignments = liveCollection(
  "apps.categories.assignments.all",
  {
    from: appCategoryAssignmentsEntityRef,
    carry: { pick: ["id", "tagId", "createdAt", "updatedAt"] },
    id: "id",
    all: {
      orderBy: [["id", "asc"]],
      unbounded: {
        reason:
          "one row per installed app; every list of apps joins it onto the whole app list it already holds",
        // Measured on main, 2026-11-24: 19 apps.
        budget: 200,
      },
    },
  },
);

export const SetAppCategoryBodySchema = z
  .object({ tagId: z.string().min(1).nullable() })
  .strict();
export type SetAppCategoryBody = z.infer<typeof SetAppCategoryBodySchema>;

/**
 * File an app under one category (`tagId`), or none (`null`). 404 for an app
 * the backend does not declare, 400 for a `tagId` naming no app category.
 */
export const setAppCategory = defineEndpoint({
  route: "PUT /api/apps/:appId/category",
  body: SetAppCategoryBodySchema,
});
