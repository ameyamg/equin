import { implement } from "@plugins/infra/plugins/endpoints/server";
import { createSiteFeedItem, deleteSiteFeedItem } from "../../shared";
import { createItem, deleteItem } from "./items-repo";

export const handleCreateItem = implement(
  createSiteFeedItem,
  async ({ body }) => createItem(body.feedId),
);

export const handleDeleteItem = implement(
  deleteSiteFeedItem,
  async ({ params }) => deleteItem(params.id),
);
