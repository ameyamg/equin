import { useState, type ReactNode } from "react";
import { FieldsForm } from "@plugins/config_v2/plugins/fields/web";
import { Card } from "@plugins/primitives/plugins/css/plugins/card/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Badge } from "@plugins/primitives/plugins/css/plugins/badge/web";
import { Button } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { RowView, useLive } from "@plugins/network/plugins/live/web";
import { useEndpointMutation } from "@plugins/infra/plugins/endpoints/web";
import type { SiteFeedDecl } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import type { PluginId } from "@plugins/framework/plugins/plugin-id/core";
import {
  SITE_FEED_ITEM_STATE_META,
  siteFeedItems,
  type SiteFeedItemRow,
} from "../../core";
import {
  deleteSiteFeedItem,
  publishSiteFeedItem,
  unpublishSiteFeedItem,
  updateSiteFeedItem,
} from "../../shared";
import { SiteFeedEditor } from "../slots";
import { ItemDestinations } from "./destinations";

/** The opened item, read live by id: the publish job's progress shows as it lands. */
export function ItemEditor({
  id,
  feed,
  pluginId,
  onClose,
}: {
  id: string;
  feed: SiteFeedDecl;
  pluginId: PluginId;
  onClose: () => void;
}): ReactNode {
  const row = useLive(siteFeedItems, { id });
  return (
    <RowView
      row={row}
      subject="this item"
      missing={
        <Text variant="caption" tone="muted">
          This item no longer exists.
        </Text>
      }
    >
      {(item) => (
        <ItemForm
          item={item}
          feed={feed}
          pluginId={pluginId}
          onClose={onClose}
        />
      )}
    </RowView>
  );
}

function ItemForm({
  item,
  feed,
  pluginId,
  onClose,
}: {
  item: SiteFeedItemRow;
  feed: SiteFeedDecl;
  pluginId: PluginId;
  onClose: () => void;
}): ReactNode {
  const update = useEndpointMutation(updateSiteFeedItem);
  const publish = useEndpointMutation(publishSiteFeedItem);
  const unpublish = useEndpointMutation(unpublishSiteFeedItem);
  const remove = useEndpointMutation(deleteSiteFeedItem);
  const [refusal, setRefusal] = useState<string | null>(null);

  // The stored values read through the declaration: a field added since takes
  // its default. One that no longer parses is shown, never edited over.
  const parsed = feed.valuesSchema.safeParse(item.values);
  if (!parsed.success) {
    return (
      <Card>
        <Text tone="destructive">
          This item no longer fits the feed&apos;s fields:{" "}
          {parsed.error.message}
        </Text>
      </Card>
    );
  }
  const values = parsed.data as Record<string, unknown>;
  const published = item.state === "published";

  return (
    <Card>
      <Stack gap="md">
        <Line>
          <Badge variant={SITE_FEED_ITEM_STATE_META[item.state].variant}>
            {SITE_FEED_ITEM_STATE_META[item.state].label}
          </Badge>
          <Fill />
          {publish.kind === "available" && (
            <Button
              variant="default"
              onClick={async () => {
                const answer = await publish.mutateAsync({
                  params: { id: item.id },
                  body: {},
                });
                setRefusal(
                  answer.kind === "queued"
                    ? null
                    : answer.kind === "refused"
                      ? answer.message
                      : `No plugin declares the feed "${answer.feedId}" any more.`,
                );
              }}
            >
              {published ? "Publish again" : "Publish"}
            </Button>
          )}
          {published && unpublish.kind === "available" && (
            <Button
              variant="outline"
              onClick={async () => {
                await unpublish.mutateAsync({ params: { id: item.id } });
              }}
            >
              Unpublish
            </Button>
          )}
          {!published && (
            <Button
              variant="ghost"
              onClick={async () => {
                const answer = await remove.mutateAsync({
                  params: { id: item.id },
                });
                if (answer.kind === "deleted") onClose();
                else
                  setRefusal(
                    answer.kind === "busy"
                      ? "Not deleted: a copy of the site still holds it — wait for its unpublish to finish."
                      : "Not deleted: unpublish it first.",
                  );
              }}
            >
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </Line>
        {publish.kind === "unavailable" && (
          <Text variant="caption" tone="muted">
            {publish.message}
          </Text>
        )}
        <ItemDestinations item={item} feed={feed} pluginId={pluginId} />
        <FieldsForm
          fields={feed.fields}
          values={values}
          onChange={(key, value) => {
            if (update.kind !== "available") return;
            update.mutate(
              {
                params: { id: item.id },
                // Only what this edit changed: the server merges it onto the
                // stored values, so an edit still in flight is never undone.
                body: { set: { [key]: value } },
              },
              {
                onSuccess: (answer) =>
                  setRefusal(
                    answer.kind === "saved"
                      ? null
                      : answer.kind === "unknown-feed"
                        ? `No plugin declares the feed "${answer.feedId}" any more.`
                        : `Not saved: ${answer.issues
                            .map((i) => `${i.path.join(".")}: ${i.message}`)
                            .join("; ")}`,
                  ),
              },
            );
          }}
        />
        <SiteFeedEditor.ItemSection.Render>
          {(part) => <part.component item={item} feed={feed} />}
        </SiteFeedEditor.ItemSection.Render>
        {refusal !== null && (
          <Text as="p" variant="caption" tone="destructive">
            {refusal}
          </Text>
        )}
        {published && (
          <Text variant="caption" tone="muted">
            Edits to a published item are published again, everywhere it is, as
            you make them.
          </Text>
        )}
      </Stack>
    </Card>
  );
}
