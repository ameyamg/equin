import type { ReactNode } from "react";
import { useLive } from "@plugins/network/plugins/live/web";
import {
  matchResource,
  useCombinedResources,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import { useEndpointMutation } from "@plugins/infra/plugins/endpoints/web";
import { Badge } from "@plugins/primitives/plugins/css/plugins/badge/web";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import {
  SectionLabel,
  Text,
} from "@plugins/primitives/plugins/css/plugins/text/web";
import { Button } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { useDeploymentShips } from "@plugins/apps/plugins/deploy/plugins/host-query/web";
import {
  deployments,
  type Deployment,
} from "@plugins/apps/plugins/deploy/plugins/deployments/core";
import type { SiteFeedDecl } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import type { PluginId } from "@plugins/framework/plugins/plugin-id/core";
import {
  deploymentDestination,
  parseDestination,
  SITE_FEED_LOCAL_DESTINATION,
  SITE_FEED_PUBLICATION_STATE_META,
  siteFeedPublications,
  sitePublishScope,
  type SiteFeedDestination,
  type SiteFeedItemRow,
  type SiteFeedPublicationRow,
  type SitePublishScope,
} from "../../core";
import { publishSiteFeedItem, unpublishSiteFeedItem } from "../../shared";

const LOCAL_LABEL = "This instance";

/** A deployment's name in a chip: its first hostname, else its composition. */
function deploymentLabel(d: Deployment): string {
  return d.hostnames.find((h) => !h.startsWith("*.")) ?? d.compositionId;
}

/** The deployed site's page for the feed, or null with no hostname. */
function deployedUrl(d: Deployment, feed: SiteFeedDecl): string | null {
  const host = d.hostnames.find((h) => !h.startsWith("*."));
  return host === undefined ? null : `https://${host}${feed.pagePath ?? "/"}`;
}

/** A destination's label, read from its deployment row. */
function DestinationLabel({ destination }: { destination: string }): ReactNode {
  const target = parseDestination(destination);
  if (target.kind === "local") return <>{LOCAL_LABEL}</>;
  return <DeploymentLabel deploymentId={target.deploymentId} />;
}

function DeploymentLabel({
  deploymentId,
}: {
  deploymentId: string;
}): ReactNode {
  const row = useLive(deployments, { id: deploymentId });
  switch (row.status) {
    case "loading":
      return <>…</>;
    case "error":
      return <>{deploymentId}</>;
    case "ready":
      return row.found ? <>{deploymentLabel(row.row)}</> : <>a removed site</>;
  }
}

/** The item's copies as small chips in its list row: one per destination holding it. */
export function ItemPublicationChips({
  item,
}: {
  item: SiteFeedItemRow;
}): ReactNode {
  const rows = useLive(siteFeedPublications, { where: { itemId: item.id } });
  return matchResource(rows, {
    loading: () => null,
    error: () => null,
    ready: (list: readonly SiteFeedPublicationRow[]) => (
      <Line gap="xs">
        {list.map((r) => (
          <span key={r.destination} title={r.error ?? undefined}>
            <Badge variant={SITE_FEED_PUBLICATION_STATE_META[r.state].variant}>
              <DestinationLabel destination={r.destination} />
              {r.state === "published"
                ? null
                : ` · ${SITE_FEED_PUBLICATION_STATE_META[r.state].label}`}
            </Badge>
          </span>
        ))}
      </Line>
    ),
  });
}

/**
 * The opened item's **Published to** row: every copy of the site serving the
 * feed — this instance, then each deployment whose composition ships the
 * feed's declaring plugin (`useDeploymentShips`) — with where the item stands
 * there, its last error, and Publish / Retry for that copy alone. A deployed
 * site is published to from main only: elsewhere its line says so.
 */
export function ItemDestinations({
  item,
  feed,
  pluginId,
}: {
  item: SiteFeedItemRow;
  feed: SiteFeedDecl;
  pluginId: PluginId;
}): ReactNode {
  const result = useCombinedResources({
    rows: useLive(siteFeedPublications, { where: { itemId: item.id } }),
    sites: useLive(deployments),
    scope: useLive(sitePublishScope),
  });
  return (
    <Stack gap="xs">
      <SectionLabel>Published to</SectionLabel>
      {matchResource(result, {
        loading: () => <Loading variant="rows" count={2} />,
        ready: ({ rows, sites, scope }) => {
          const byDest = new Map(rows.map((r) => [r.destination, r]));
          const known = new Set<string>([
            SITE_FEED_LOCAL_DESTINATION,
            ...sites.map((d) => deploymentDestination(d.id)),
          ]);
          const localUrl =
            feed.localPagePath === undefined
              ? null
              : `${window.location.origin}${feed.localPagePath}`;
          return (
            <Stack gap="xs">
              <DestinationLine
                item={item}
                destination={SITE_FEED_LOCAL_DESTINATION}
                label={LOCAL_LABEL}
                url={localUrl}
                row={byDest.get(SITE_FEED_LOCAL_DESTINATION) ?? null}
                refusal={null}
              />
              {sites.map((d) => (
                <DeploymentLine
                  key={d.id}
                  item={item}
                  feed={feed}
                  pluginId={pluginId}
                  deployment={d}
                  row={byDest.get(deploymentDestination(d.id)) ?? null}
                  scope={scope}
                />
              ))}
              {rows
                .filter((r) => !known.has(r.destination))
                .map((r) => (
                  <DestinationLine
                    key={r.destination}
                    item={item}
                    destination={r.destination as SiteFeedDestination}
                    label="A removed site"
                    url={null}
                    row={r}
                    refusal={null}
                  />
                ))}
            </Stack>
          );
        },
      })}
    </Stack>
  );
}

/** One deployment's line — only while it ships the feed, or still holds the item. */
function DeploymentLine({
  item,
  feed,
  pluginId,
  deployment,
  row,
  scope,
}: {
  item: SiteFeedItemRow;
  feed: SiteFeedDecl;
  pluginId: PluginId;
  deployment: Deployment;
  row: SiteFeedPublicationRow | null;
  scope: SitePublishScope;
}): ReactNode {
  const ships = useDeploymentShips(deployment.id, pluginId);
  if (row === null && ships.kind !== "yes") return null;
  return (
    <DestinationLine
      item={item}
      destination={deploymentDestination(deployment.id)}
      label={deploymentLabel(deployment)}
      url={deployedUrl(deployment, feed)}
      row={row}
      refusal={scope.remote.kind === "refused" ? scope.remote.reason : null}
    />
  );
}

function DestinationLine({
  item,
  destination,
  label,
  url,
  row,
  refusal,
}: {
  item: SiteFeedItemRow;
  destination: SiteFeedDestination;
  label: string;
  url: string | null;
  row: SiteFeedPublicationRow | null;
  refusal: string | null;
}): ReactNode {
  const publish = useEndpointMutation(publishSiteFeedItem);
  const unpublish = useEndpointMutation(unpublishSiteFeedItem);
  const wanted = item.state === "published";
  const meta =
    row === null ? null : SITE_FEED_PUBLICATION_STATE_META[row.state];
  const canPublishHere =
    refusal === null &&
    wanted &&
    publish.kind === "available" &&
    (row === null || row.state === "failed");
  const canRetryUnpublish =
    !wanted && row?.state === "failed" && unpublish.kind === "available";
  return (
    <Stack gap="2xs" data-destination={destination}>
      <Line gap="xs">
        <Text variant="label">{label}</Text>
        {meta === null ? (
          <Badge variant="muted">Not on this site</Badge>
        ) : (
          <Badge variant={meta.variant}>{meta.label}</Badge>
        )}
        <Fill />
        {url !== null && row?.state === "published" && (
          <Button
            variant="ghost"
            render={<a href={url} target="_blank" rel="noopener noreferrer" />}
          >
            Open
          </Button>
        )}
        {canPublishHere && (
          <Button
            variant="outline"
            onClick={async () => {
              await publish.mutateAsync({
                params: { id: item.id },
                body: { destination },
              });
            }}
          >
            {row === null ? "Publish here" : "Retry"}
          </Button>
        )}
        {canRetryUnpublish && (
          <Button
            variant="outline"
            onClick={async () => {
              await unpublish.mutateAsync({ params: { id: item.id } });
            }}
          >
            Retry
          </Button>
        )}
      </Line>
      {refusal !== null && row === null && (
        <Text as="p" variant="caption" tone="muted">
          {refusal}
        </Text>
      )}
      {row?.error != null && (
        <Text as="p" variant="caption" tone="destructive">
          {row.error}
        </Text>
      )}
    </Stack>
  );
}
