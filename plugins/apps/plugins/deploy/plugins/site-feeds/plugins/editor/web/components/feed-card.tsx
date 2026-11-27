import { useMemo, useState, type ComponentType, type ReactNode } from "react";
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
import type { SiteFeedPreviewProps } from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/box/web";
import { ViewSwitcher } from "@plugins/primitives/plugins/view-switcher/web";
import { ResourceErrorInline } from "@plugins/network/plugins/live/plugins/live-state/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import type { ProposalRow } from "@plugins/tasks/plugins/proposals/core";
import {
  ProposalsDataView,
  useOpenProposals,
} from "@plugins/tasks/plugins/proposals/web";
import {
  SITE_FEED_ITEM_PROPOSAL_TYPE,
  siteFeedItems,
  type SiteFeedItemRow,
} from "../../core";
import { createSiteFeedItem } from "../../shared";
import { feedItemFields, feedValueFields } from "../internal/item-fields";
import { ItemEditor } from "./item-editor";
import { FeedProposalReview } from "./proposal-section";
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

type FeedTab = "items" | "proposed";

/**
 * One feed: its items as a DataView (the feed's own fields as columns, where
 * each is published, an agent's proposal for it), the Proposed tab (agents'
 * proposals waiting for the user — a proposed new item its own row), New
 * item, the opened item's editor (with its proposal's review, when one
 * waits) or a proposed new item's review, and what follows a publish
 * (`SiteFeedEditor.FeedSection`).
 */
export function FeedCard({
  feed,
  pluginId,
  preview,
}: {
  feed: SiteFeedDecl;
  pluginId: PluginId;
  /** The site plugin's drawing of one item, for the review; null: none. */
  preview: ComponentType<SiteFeedPreviewProps> | null;
}): ReactNode {
  const source = useMemo(
    () => itemsSource.scoped({ where: { feedId: feed.id } }),
    [feed.id],
  );
  const proposals = useOpenProposals(SITE_FEED_ITEM_PROPOSAL_TYPE, feed.id);
  // Per record, its NEWEST answerable proposal (the window is newest first;
  // two tasks may each have one open for the same item).
  const { proposalByRecord, proposalById } = useMemo(() => {
    const byRecord = new Map<string, ProposalRow>();
    const byId = new Map<string, ProposalRow>();
    if (proposals.status === "ready") {
      for (const p of proposals.data) {
        if (!byRecord.has(p.recordId)) byRecord.set(p.recordId, p);
        byId.set(p.id, p);
      }
    }
    return { proposalByRecord: byRecord, proposalById: byId };
  }, [proposals]);
  const withElsewhere = SiteFeedEditor.ItemStatus.useContributions().length > 0;
  const extraFields = useMemo(
    () =>
      feedItemFields(feed, {
        withElsewhere,
        proposalOf: (id) => proposalByRecord.get(id),
      }),
    [feed, withElsewhere, proposalByRecord],
  );
  const proposalFields = useMemo(
    () => feedValueFields<ProposalRow>(feed),
    [feed],
  );
  const [tab, setTab] = useState<FeedTab>("items");
  const [openId, setOpenId] = useState<string | null>(null);
  // The proposal opened from the Proposed tab (its item's newest otherwise);
  // a proposed NEW item has no item to open, only its proposal.
  const [openProposal, setOpenProposal] = useState<Pick<
    ProposalRow,
    "id" | "recordId"
  > | null>(null);
  const create = useEndpointMutation(createSiteFeedItem);
  const openItem = (id: string | null) => {
    setOpenProposal(null);
    setOpenId(id);
  };
  // The opened proposal — or, once a newer revision replaced it, the newest
  // of the same record: the review follows the agent's revisions.
  const pickedProposal =
    openProposal === null
      ? undefined
      : (proposalById.get(openProposal.id) ??
        proposalByRecord.get(openProposal.recordId));
  const newProposal = pickedProposal?.isNew === true ? pickedProposal : null;
  const itemProposal =
    openId === null
      ? null
      : pickedProposal !== undefined && pickedProposal.recordId === openId
        ? pickedProposal
        : (proposalByRecord.get(openId) ?? null);
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
            if (answer.kind === "created") openItem(answer.id);
          }}
        >
          New item
        </Button>
      }
    >
      <SiteCardBody>
        <ViewSwitcher
          options={[
            { id: "items", title: "Items", icon: symbol("article") },
            {
              id: "proposed",
              title: "Proposed",
              icon: symbol("inbox"),
              count:
                proposals.status === "ready" && proposals.data.length > 0
                  ? proposals.data.length
                  : undefined,
            },
          ]}
          activeId={tab}
          onSelect={(id) => setTab(id === "proposed" ? "proposed" : "items")}
        />
        {proposals.status === "error" && (
          <ResourceErrorInline
            variant="block"
            error={proposals.error}
            refetch={proposals.refetch}
          />
        )}
        {tab === "items" ? (
          <DataView<SiteFeedItemRow>
            source={source}
            overrides={overrides}
            extraFields={extraFields}
            views={["table", "list"]}
            defaultView="table"
            selectedRowId={openId ?? undefined}
            onRowActivate={(r) => openItem(openId === r.id ? null : r.id)}
            emptyState={<>Nothing written yet. New item starts a draft.</>}
          />
        ) : (
          <ProposalsDataView
            type={SITE_FEED_ITEM_PROPOSAL_TYPE}
            scope={feed.id}
            extraFields={proposalFields}
            selectedId={
              newProposal?.id ??
              (openId === null ? undefined : proposalByRecord.get(openId)?.id)
            }
            onOpen={(p) => {
              setOpenId(p.isNew ? null : p.recordId);
              setOpenProposal({ id: p.id, recordId: p.recordId });
            }}
          />
        )}
        {openId !== null && (
          <ItemEditor
            id={openId}
            feed={feed}
            pluginId={pluginId}
            proposal={itemProposal}
            preview={preview}
            onClose={() => openItem(null)}
          />
        )}
        {newProposal !== null && (
          <FeedProposalReview
            proposal={newProposal}
            feed={feed}
            item={null}
            preview={preview}
            // An accepted new item exists now, under its proposed id: open it.
            onDecided={(state) => {
              if (state === "accepted") openItem(newProposal.recordId);
            }}
          />
        )}
        <SiteFeedEditor.FeedSection.Render>
          {(part) => <part.component feed={feed} openItemId={openId} />}
        </SiteFeedEditor.FeedSection.Render>
      </SiteCardBody>
    </SiteCard>
  );
}
