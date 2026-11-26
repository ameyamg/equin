import type { ReactNode } from "react";
import {
  Inset,
  Stack,
} from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { useSiteFeedDeclarations } from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/box/web";
import { FeedCard } from "./feed-card";

/**
 * **Feeds** — the content the sites publish themselves, one card per feed a
 * plugin of this app declares (`SiteFeeds.Feed`): its items, kept on this
 * computer, each edited with the feed's own fields and published to every
 * copy of the site serving the feed — this instance, and (from main) each
 * deployment shipping its declaring plugin.
 */
export function FeedsPage(): ReactNode {
  const declarations = useSiteFeedDeclarations();
  return (
    // The page column the site page reads at: centred, at most 1180px.
    <Stack gap="none" className="mx-auto w-full max-w-[1180px] px-xl pb-2xl">
      <Inset y="lg">
        <Text as="h1" variant="title">
          Feeds
        </Text>
        <Text as="p" variant="caption" tone="muted">
          What the sites publish themselves — written here, published to every
          copy of the site
        </Text>
      </Inset>
      <Stack gap="md">
        {declarations.length === 0 ? (
          <Text as="p" variant="caption" tone="muted">
            No plugin of this app declares a feed.
          </Text>
        ) : (
          declarations.map((d) => (
            <FeedCard key={d.feed.id} feed={d.feed} pluginId={d.pluginId} />
          ))
        )}
      </Stack>
    </Stack>
  );
}
