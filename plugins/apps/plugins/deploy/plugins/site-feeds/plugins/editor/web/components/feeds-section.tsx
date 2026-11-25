import { useMemo, useState, type ReactNode } from "react";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Button } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { ResourceErrorInline } from "@plugins/network/plugins/live/plugins/live-state/web";
import { useEndpointMutation } from "@plugins/infra/plugins/endpoints/web";
import {
  DataView,
  defineDataView,
  fieldOverrides,
  liveDataSource,
} from "@plugins/primitives/plugins/data-view/web";
import { RelativeTime } from "@plugins/primitives/plugins/relative-time/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { useDeploymentShipsEach } from "@plugins/apps/plugins/deploy/plugins/host-query/web";
import {
  SiteCard,
  SiteCardBody,
} from "@plugins/apps/plugins/deploy/plugins/deployments/web";
import {
  useSiteFeedDeclarations,
  type SiteFeedDeclaration,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/box/web";
import type { SiteFeedDecl } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
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
      "one site's feed is a scope stated by the tab, never a filter the user may widen; its items carry no custom columns",
  },
});

const overrides = fieldOverrides(siteFeedItems, {
  state: { width: "7rem" },
  publishState: { width: "8rem" },
  publishedAt: {
    width: "8rem",
    cell: (r) =>
      r.publishedAt === null ? null : (
        <Text tone="muted" title={r.publishedAt.toLocaleString()}>
          <RelativeTime date={r.publishedAt} />
        </Text>
      ),
  },
  updatedAt: { width: "7rem", visible: false },
  createdAt: { width: "7rem", visible: false },
  deploymentId: { visible: false, filterable: false, groupable: false },
  feedId: { visible: false, filterable: false, groupable: false },
  // The search box's text: matched, never shown (the feed's own columns are).
  searchText: { visible: false, filterable: false, groupable: false },
});

/**
 * **Feeds** — the content this site publishes itself, one card per feed its
 * release ships (declared by the site's own plugins, `SiteFeeds.Feed`): the
 * items kept on this computer, drafts and published, each edited with the
 * feed's own fields and published to the site's box.
 */
export function FeedsSection({
  deploymentId,
}: {
  deploymentId: string;
}): ReactNode {
  const declarations = useSiteFeedDeclarations();
  const ships = useDeploymentShipsEach(
    deploymentId,
    declarations.map((d) => d.pluginId),
  );
  switch (ships.kind) {
    case "pending":
      return <Loading variant="rows" count={3} />;
    case "failed":
      return (
        <ResourceErrorInline
          variant="block"
          subject="which feeds this site publishes"
          error={ships.error}
          refetch={ships.refetch}
        />
      );
    case "ready":
      return (
        <Stack gap="md">
          {declarations
            .filter((d) => ships.shipped.has(d.pluginId))
            .map((d: SiteFeedDeclaration) => (
              <FeedCard
                key={d.feed.id}
                deploymentId={deploymentId}
                feed={d.feed}
              />
            ))}
        </Stack>
      );
  }
}

function FeedCard({
  deploymentId,
  feed,
}: {
  deploymentId: string;
  feed: SiteFeedDecl;
}): ReactNode {
  const source = useMemo(
    () => itemsSource.scoped({ where: { deploymentId, feedId: feed.id } }),
    [deploymentId, feed.id],
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
              body: { deploymentId, feedId: feed.id },
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
          <ItemEditor id={openId} feed={feed} onClose={() => setOpenId(null)} />
        )}
        <SiteFeedEditor.FeedSection.Render>
          {(part) => <part.component deploymentId={deploymentId} feed={feed} />}
        </SiteFeedEditor.FeedSection.Render>
      </SiteCardBody>
    </SiteCard>
  );
}
