import { db } from "@plugins/database/server";
import { implement } from "@plugins/infra/plugins/endpoints/server";
import {
  createTag,
  createTagPath,
  deleteTag,
  moveTag,
  updateTag,
} from "../../core";
import {
  createTagIn,
  createTagPathIn,
  deleteTagIn,
  moveTagIn,
  updateTagIn,
} from "./repo";
import { resolveServedTree, TagTrees, type ServedTagTree } from "./serve";

// Each handler resolves `:tree` against the registered trees at call time —
// the generic handlers never name a tree.
const served = (treeId: string) =>
  resolveServedTree(treeId, TagTrees.Tree.getContributions());

export const handleCreateTag = implement(createTag, ({ params, body }) =>
  createTagIn(served(params.tree), db, body),
);

export const handleCreateTagPath = implement(
  createTagPath,
  ({ params, body }) => createTagPathIn(served(params.tree), db, body),
);

export const handleUpdateTag = implement(updateTag, ({ params, body }) =>
  updateTagIn(served(params.tree), db, params.id, body),
);

export const handleMoveTag = implement(moveTag, ({ params, body }) =>
  moveTagIn(served(params.tree), db, params.id, body),
);

export const handleDeleteTag = implement(deleteTag, ({ params }) =>
  deleteTagIn(served(params.tree), db, params.id),
);

/**
 * Make sure `segments` exists as a path of `tree` (each missing segment
 * created under the previous one, case-insensitive like the endpoint) and
 * answer the leaf's id — for a server plugin filing its own records under a
 * path it declares in code (an app's default category). One write under the
 * tree's table lock, as the `/paths` endpoint makes it.
 */
export async function ensureTagPath(
  tree: ServedTagTree,
  segments: readonly string[],
): Promise<string> {
  if (segments.length === 0) {
    throw new Error(
      `ensureTagPath(${tree.tree.id}): an empty path names no tag.`,
    );
  }
  return (await createTagPathIn(tree, db, { segments: [...segments] })).id;
}
