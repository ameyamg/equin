import { useMemo } from "react";
import { useLive } from "@plugins/network/plugins/live/web";
import {
  mapResource,
  type ResourceResult,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import type { FieldsRecord } from "@plugins/fields/core";
import type {
  SiteFeedDecl,
  SiteFeedValues,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import { siteFeedEntries } from "../../core";

/** One published entry, its values typed by the feed's declaration. */
export interface SiteFeedEntry<F extends FieldsRecord> {
  readonly id: string;
  readonly values: SiteFeedValues<F>;
  readonly publishedAt: string;
  readonly updatedAt: string;
}

/**
 * A feed's published entries, newest first (at most its `publicLimit`), live
 * — loading until the box answers, never an empty stand-in. Each entry's
 * values are parsed by the feed's own declaration, so they come typed; the
 * box already validated them against the same code, so a failed parse is a
 * broken assumption and throws.
 */
export function useSiteFeed<F extends FieldsRecord>(
  feed: SiteFeedDecl<F>,
): ResourceResult<readonly SiteFeedEntry<F>[]> {
  const result = useLive(siteFeedEntries, { feedId: feed.id });
  return useMemo(
    () =>
      mapResource(result, (data) =>
        data.entries.map((entry) => ({
          id: entry.id,
          values: feed.valuesSchema.parse(entry.values),
          publishedAt: entry.publishedAt,
          updatedAt: entry.updatedAt,
        })),
      ),
    [result, feed],
  );
}
