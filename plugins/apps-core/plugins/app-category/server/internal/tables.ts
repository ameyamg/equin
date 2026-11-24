import {
  defaultNow,
  defineEntity,
} from "@plugins/infra/plugins/entities/server";
import { defineTagTreeTable } from "@plugins/tag-tree/plugins/engine/server";
import {
  appCategoryAssignmentsEntityRef,
  appCategoryTagsEntityRef,
} from "../../core";

// Physical tables, derived from the refs in `core/`. A load-order leaf (no
// top-level await): drizzle-kit's sync loader evaluates it. Re-exported with a
// leading `_` for its schema glob.

const appCategoryTags = defineTagTreeTable(appCategoryTagsEntityRef);

const appCategories = defineEntity(appCategoryAssignmentsEntityRef, {
  primaryKey: "id",
  updatedAt: {
    touchedBy: { id: false, tagId: true, createdAt: false },
  },
  columns: {
    // A deleted tag's apps get its parent first (the tree's carrier, in the
    // delete's transaction); the FK's SET NULL is the backstop.
    tagId: {
      references: {
        column: () => _appCategoryTags.id,
        onDelete: "set null",
      },
    },
    createdAt: { default: defaultNow() },
    updatedAt: { default: defaultNow() },
  },
});

// drizzle-kit schema-glob discovery.
export const _appCategoryTags = appCategoryTags.table;
export const _appCategories = appCategories.table;
