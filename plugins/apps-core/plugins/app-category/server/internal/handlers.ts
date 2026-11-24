import { eq } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { declaredApps } from "@plugins/apps-core/server";
import { HttpError, implement } from "@plugins/infra/plugins/endpoints/server";
import { appCategoryIdKind, setAppCategory } from "../../core";
import { _appCategories, _appCategoryTags } from "./tables";

/**
 * `PUT /api/apps/:appId/category` — file an app under one category, or none.
 * 404 for an app this backend does not declare; 400 for a `tagId` naming no
 * app category.
 */
export const handleSetAppCategory = implement(
  setAppCategory,
  async ({ params, body }) => {
    const { appId } = params;
    if (!declaredApps().some((d) => d.app.id === appId)) {
      throw new HttpError(404, `no such app: ${appId}`);
    }
    const { tagId } = body;
    await db.transaction(async (tx) => {
      if (tagId !== null) {
        // Under a KEY SHARE lock, so a concurrent delete of the tag waits for
        // this write (and then lifts it to the parent through the carrier).
        const tag = appCategoryIdKind.is(tagId)
          ? await tx
              .select({ id: _appCategoryTags.id })
              .from(_appCategoryTags)
              .where(eq(_appCategoryTags.id, tagId))
              .for("key share")
          : [];
        if (tag.length === 0) {
          throw new HttpError(400, `no such app category: ${tagId}`);
        }
      }
      await tx
        .insert(_appCategories)
        .values({ id: appId, tagId })
        .onConflictDoUpdate({ target: _appCategories.id, set: { tagId } });
    });
  },
);
