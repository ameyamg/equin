import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { useEndpointMutation } from "@plugins/infra/plugins/endpoints/web";
import {
  DataView,
  defineDataView,
  fieldOverrides,
  liveDataSource,
} from "@plugins/primitives/plugins/data-view/web";
import { RelativeTime } from "@plugins/primitives/plugins/relative-time/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { useDateFormatter } from "@plugins/fields/plugins/date/plugins/format/web";
import {
  SiteCard,
  SiteCardBody,
} from "@plugins/apps/plugins/deploy/plugins/deployments/web";
import type { SiteFeedDecl } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import type { PluginId } from "@plugins/framework/plugins/plugin-id/core";
import { siteFeedItems, type SiteFeedItemRow } from "../../core";
import { createSiteFeedItem } from "../../shared";
import { feedItemFields } from "../internal/item-fields";
import { ItemEditor } from "./item-editor";
import { SiteFeedEditor } from "../slots";

// Marker scraped by codegen (data-views.generated.ts). Must live in web/**.
const ITEMS_VIEW = defineDataView("deploy.site-feed-items");

const itemsSource = liveDataSource(siteFeedItems, {
  surface: ITEMS_VIEW,
  // Every text value of the item, derived on each write — whatever the feed's fields.
  searchable: ["searchText"],
  unscoped: {
    reason:
      "one feed is a scope stated by its card, never a filter the user may widen; its items carry no custom columns",
  },
});

/** When an item went out: relative, the full timestamp on hover. */
function PublishedAt({ at }: { at: Date }): ReactNode {
  const fmt = useDateFormatter();
  return (
    <Text tone="muted" title={fmt.numeric(at, { time: true })}>
      <RelativeTime date={at} />
    </Text>
  );
}

const overrides = fieldOverrides(siteFeedItems, {
  state: { width: "7rem" },
  publishedAt: {
    width: "8rem",
    cell: (r) =>
      r.publishedAt === null ? null : <PublishedAt at={r.publishedAt} />,
  },
  updatedAt: { width: "7rem", visible: false },
  createdAt: { width: "7rem", visible: false },
  feedId: { visible: false, filterable: false, groupable: false },
  // The search box's text: matched, never shown (the feed's own columns are).
  searchText: { visible: false, filterable: false, groupable: false },
});

/**
 * One feed: its items as a DataView (the feed's own fields as columns, where
 * each is published), New item, the opened item's editor, and what follows a
 * publish (`SiteFeedEditor.FeedSection`).
 */
export function FeedCard({
  feed,
  pluginId,
}: {
  feed: SiteFeedDecl;
  pluginId: PluginId;
}): ReactNode {
  const source = useMemo(
    () => itemsSource.scoped({ where: { feedId: feed.id } }),
    [feed.id],
  );
  const withElsewhere = SiteFeedEditor.ItemStatus.useContributions().length > 0;
  const extraFields = useMemo(
    () => feedItemFields(feed, { withElsewhere }),
    [feed, withElsewhere],
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const create = useEndpointMutation(createSiteFeedItem);
  return (
    <SiteCard
      title={feed.label}
      trailing={
        <Button
          variant="outline"
          onClick={async () => {
            const answer = await create.mutateAsync({
              body: { feedId: feed.id },
            });
            if (answer.kind === "created") setOpenId(answer.id);
          }}
        >
          New item
        </Button>
      }
    >
      <SiteCardBody>
        <DataView<SiteFeedItemRow>
          source={source}
          overrides={overrides}
          extraFields={extraFields}
          views={["table", "list"]}
          defaultView="table"
          selectedRowId={openId ?? undefined}
          onRowActivate={(r) => setOpenId((id) => (id === r.id ? null : r.id))}
          emptyState={<>Nothing written yet. New item starts a draft.</>}
        />
        {openId !== null && (
          <ItemEditor
            id={openId}
            feed={feed}
            pluginId={pluginId}
            onClose={() => setOpenId(null)}
          />
        )}
        <SiteFeedEditor.FeedSection.Render>
          {(part) => <part.component feed={feed} openItemId={openId} />}
        </SiteFeedEditor.FeedSection.Render>
      </SiteCardBody>
    </SiteCard>
  );
}
