import type { FieldOptionMeta } from "@plugins/fields/core";
import {
  SYNDICATION_STATE_META,
  type SiteFeedSyndicationRow,
} from "../../core";

/**
 * A row's state in words: `pending` reads as what is being done — posting
 * while the item is published, removing once it is not.
 */
export function syndicationChip(
  row: SiteFeedSyndicationRow,
  itemPublished: boolean,
): FieldOptionMeta {
  if (row.state === "pending") {
    return {
      ...SYNDICATION_STATE_META.pending,
      label: itemPublished
        ? row.remoteId === null
          ? "Posting…"
          : "Updating…"
        : "Removing…",
    };
  }
  return SYNDICATION_STATE_META[row.state];
}
