import { and, eq, gte, or } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { siteFeedEntryIdKind } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import { siteFeedOf } from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/box/server";
import { Proposals } from "@plugins/tasks/plugins/proposals/server";
import { SITE_FEED_ITEM_PROPOSAL_TYPE, siteFeedSearchText } from "../../core";
import { saveItemValues } from "../../server/internal/items-repo";
import { _siteFeedItems } from "../../server/internal/tables";
import { requeueHeld } from "./jobs";

/**
 * Site feed items as a record type agents may propose changes to
 * (`tasks/proposals`): an agent edits an item on its worktree's Feeds page,
 * `./equin propose` hands it to main, and an accept writes it through the
 * editor's own save — validated against the feed's declaration, its media
 * linked, a published item published again everywhere it is. A proposed new
 * item becomes a draft under the id it had in the worktree.
 */
export const siteFeedItemProposalType = Proposals.Type({
  id: SITE_FEED_ITEM_PROPOSAL_TYPE,
  label: "Site feed item",
  fieldsOf: (feedId) => siteFeedOf(feedId)?.fields ?? null,
  read: async (id) => {
    if (!siteFeedEntryIdKind.is(id)) return null;
    const [row] = await db
      .select()
      .from(_siteFeedItems)
      .where(eq(_siteFeedItems.id, siteFeedEntryIdKind.key(id)));
    if (!row) return null;
    return {
      scope: row.feedId,
      values: row.values,
      version: row.updatedAt.toISOString(),
      updatedAt: row.updatedAt,
    };
  },
  touchedSince: async (since) => {
    const rows = await db
      .select({ id: _siteFeedItems.id })
      .from(_siteFeedItems)
      .where(
        or(
          gte(_siteFeedItems.createdAt, since),
          gte(_siteFeedItems.updatedAt, since),
        ),
      )
      .orderBy(_siteFeedItems.createdAt);
    return rows.map((r) => r.id);
  },
  apply: async (target, set) => {
    if (target.kind === "create") {
      if (!siteFeedEntryIdKind.is(target.id)) {
        return {
          kind: "refused",
          message: `"${target.id}" is not a site feed item id.`,
        };
      }
      const feed = siteFeedOf(target.scope);
      if (feed === null) {
        return {
          kind: "refused",
          message: `No plugin declares the feed "${target.scope}" any more.`,
        };
      }
      // A new draft under the worktree's id, its values the declaration's
      // defaults — then the proposed values saved over them by the editor's
      // own save, which judges them against the feed.
      const defaults = feed.valuesSchema.parse({}) as Record<string, unknown>;
      const inserted = await db
        .insert(_siteFeedItems)
        .values({
          id: siteFeedEntryIdKind.parse(target.id),
          feedId: feed.id,
          values: defaults,
          searchText: siteFeedSearchText(feed.fields, defaults),
        })
        .onConflictDoNothing()
        .returning({ id: _siteFeedItems.id });
      if (inserted.length === 0) {
        return {
          kind: "refused",
          message: `An item ${target.id} exists already: it was accepted before.`,
        };
      }
    }
    const { answer, item } = await saveItemValues(target.id, set);
    if (answer.kind !== "saved" && target.kind === "create") {
      // Nothing on main changes until an accept goes through: the draft
      // inserted for it goes again (still the defaults: nothing saved over it).
      await db
        .delete(_siteFeedItems)
        .where(
          and(
            eq(_siteFeedItems.id, siteFeedEntryIdKind.key(target.id)),
            eq(_siteFeedItems.state, "draft"),
          ),
        );
    }
    if (answer.kind === "unknown-feed") {
      return {
        kind: "refused",
        message: `No plugin declares the feed "${answer.feedId}" any more.`,
      };
    }
    if (answer.kind === "invalid-values") {
      return {
        kind: "refused",
        message: `Not saved: ${answer.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      };
    }
    if (item.state === "published") await requeueHeld(item.id, "publishing");
    return { kind: "applied" };
  },
});
