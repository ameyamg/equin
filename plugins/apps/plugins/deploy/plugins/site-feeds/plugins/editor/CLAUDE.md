# editor

The site-feed items on THIS computer — the source of truth — and the Feeds
tab of a site's page that edits and publishes them. Local only: nothing in a
site's closure imports it (the site ships [`box`](../box/CLAUDE.md)); it names
no feed and no field. Design: decisions 3, 6, 7 of
[`research/2026-11-25-global-site-feeds.md`](../../../../../../../../research/2026-11-25-global-site-feeds.md).

## Items

- `site_feed_items (id sfe-…, deployment_id → deploy_deployments cascade,
  feed_id, values jsonb, search_text (every text value, derived from `values`
  on each write by `siteFeedSearchText`: what the list's search matches), state draft|published, published_at, publish_state
  idle|publishing|unpublishing|failed, publish_error, created_at, updated_at)`
  — `core/internal/items.ts` (`siteFeedItemFields`), built by `defineEntity`.
  The id is the entry's id on the box. `updated_at` moves only with `values`.
- `site_feed_items_attachments` (`Attachments.defineLink`): set to exactly the
  values' `mediaAttachmentIds` on every save, so a draft's files outlive the
  media field's 24 h upload hold.
- `site-feeds.items` (`siteFeedItems`): a window (50, max 200), every read
  scoped `where: { deploymentId, feedId }`; `:rows` reads one item.
- Values are validated on every write with the box's own judge
  (`judgeSiteFeedValues` from `box/server`, the feed found with `siteFeedOf`:
  the local app runs every plugin, the site's included) — zod issues and an
  undeclared key are `invalid-values`, never stored.

## Routes (`shared/`)

| route | half | answer |
|---|---|---|
| `POST /api/deploy/site-feeds/items` `{ deploymentId, feedId }` | server | `created { id }` · `unknown-feed` (values = the declaration's defaults) |
| `PATCH …/items/:id` `{ set }` | machine | `saved` · `invalid-values { issues }` · `unknown-feed`; a published (or publishing) item is published again |
| `DELETE …/items/:id` | server | `deleted` · `published` (unpublish first) · `busy` |
| `POST …/items/:id/publish` · `…/unpublish` | machine | `queued` · `busy` (the other job is in flight) |

`set` holds only the fields one edit changed; the server merges it onto the
stored values, one save per item at a time (a keyed mutex), so two edits in
flight at once (a title typed while a video uploads) both land — a form that
sent its whole values would undo the edit it had not read back yet.

`claimPublishState` moves `publish_state` to `publishing` / `unpublishing`
only from `idle`, `failed` or itself, so a publish never overtakes an
unpublish (or the reverse).

## Jobs (`machine/`)

`site-feeds.publish` and `site-feeds.unpublish`, keyed by item, one lane
(`serial: { with: "site-feeds.box" }`), 4 attempts.

- **Publish** (`publish-flow.ts`, `publishItem` over an injected
  `PublishTransport`): `media/missing` (≤ 100 ids a question) → for each
  missing file: copy it out of the attachment store into
  `site-feeds-outgoing` (cache data dir) hashing it, `uploadToBoxDataDir` into
  the box's `siteFeedsStagingDir`, `media/import` (size + sha256 checked) →
  `entries/upsert` with `publishedAt` (kept from the first publish). Then
  `state = published`, `publish_state = idle` — only if the item is still the
  one read (`updated_at` unchanged), else the edit's own queued run publishes
  the newer values.
- **Refusals end the run `failed`** with a sentence in `publish_error`: the
  site runs an older feed (`invalid-values` → "deploy it", with zod's issues),
  does not declare the feed, lacks the routes (`route-missing`), the server
  has no key / was never verified, SSH auth or host key, an import refusal.
  **Transport failures throw** `PublishTransportError` (the box unreachable,
  curl failed) and are retried; `onDead` writes the last one.
- **Unpublish**: `entries/delete`; `deleted`, `absent` and `unknown-feed` all
  mean gone → `state = draft`, `published_at = null`.
- **The hook point of what follows** (phase 5, syndication): the trigger
  events `siteFeeds.itemPublished` (`{ itemId, deploymentId, feedId,
  firstPublish }`) and `siteFeeds.itemUnpublished` (`{ itemId, deploymentId,
  feedId }`), filterable by `feedId` / `deploymentId`, exported from `server/`
  and emitted once the box has (no longer has) the entry. A subscriber binds
  its job with `Trigger({ on: siteFeedItemPublished, do, with })`.

## Web

`SiteTabs.View` **Feeds**, gated by `useDeploymentShipsEach(deploymentId,
<every SiteFeeds.Feed declaring plugin>)` — shown while it loads or fails, and
when the deployment ships at least one declaring plugin. One card per shipped
feed: the items DataView (`deploy.site-feed-items`, views All / Published /
Drafts) whose value columns are derived from the feed's fields
(`item-fields.tsx`: media fields as the media cell, text fields as their first
line, the first one the title; the search box matches `searchText`), New item, and the opened item below the list
(`ItemEditor`: `FieldsForm` autosave, Publish / Publish again / Unpublish /
Delete, the publish error). A failed item has an Investigate action.

What follows a publish shows itself through `SiteFeedEditor` (web) render
slots, so the editor names none of it: `FeedSection` (under a feed's list),
`ItemStatus` (an "Elsewhere" column, added only while something contributes)
and `ItemSection` (in the opened item). `syndication` is their contributor.
The server barrel also exports `_siteFeedItems`, `feedOfItem` and
`SiteFeedItemRecord` for it.

## Tests

- `core/internal/items.test.ts` — `siteFeedSearchText`.
- `e2e/publish-roundtrip.ts` — the whole life through the UI on this
  checkout's build: a `website` site whose server is a stand-in box (this
  instance: `deploy_host_stand_ins` seeded through the harness's deploy DB),
  New item → title, text, a PNG and an ffmpeg-made MP4 → Publish → the Tips
  page shows it and its video seeks (206) → edit the title → updated →
  Unpublish → gone, media 404. Cleans up through the app's endpoints.
- `machine/internal/publish-flow.test.ts` — the flow against a fake box: only
  missing files move, import then upsert, refusals in words (older feed,
  import mismatch, missing routes, SSH auth), transport failures thrown,
  staged copies always removed; unpublish's arms.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: Feeds tab of a site's page, shown only when the deployment's composition ships a plugin declaring a site feed (SiteFeeds.Feed): one card per shipped feed — its items on this computer as a live DataView (columns derived from the feed's own fields: its text as the title, its media as thumbnails; state, publishing, published), New item, and the opened item's editor (the feed's FieldsForm, autosaved; Publish / Publish again / Unpublish / Delete; the last publish error in words). What follows a publish shows itself through the SiteFeedEditor slots: a section under a feed's list, chips in an item's row, a section in the opened item. Site feed items on this computer — the source of truth for what a site's feeds publish: the site_feed_items table (a draft or published item of one deployment's feed, its values validated against the feed's declaration on every write, its publish state and last error) and its attachment links (set from the values' media on every save, so drafts keep their files); the live site-feeds.items window, scoped per site and feed; the create and delete routes (a draft only); and the siteFeeds.itemPublished / siteFeeds.itemUnpublished events the publish jobs emit once the box has (or no longer has) the entry — what follows a publish (syndication) subscribes to them.
- Web:
  - Slots:
    - `SiteFeedEditor.FeedSection`
    - `SiteFeedEditor.ItemStatus`
    - `SiteFeedEditor.ItemSection`
  - Slot contributors:
    - `SiteFeedEditor.FeedSection` ← `apps.deploy.site-feeds.syndication`
    - `SiteFeedEditor.ItemStatus` ← `apps.deploy.site-feeds.syndication`
    - `SiteFeedEditor.ItemSection` ← `apps.deploy.site-feeds.syndication`
  - Contributes:
    - `DataViewSlots.CollectionItemAction` "site-feeds.items:investigate" → `CollectionInvestigate`
    - `SiteTabs.View` "Feeds" → `FeedsSection`
  - Uses: 27 symbols — full list in [REFERENCE.md](./REFERENCE.md)
    - `primitives/data-view` ×4
    - `apps/deploy/deployments` ×3
    - `apps/deploy/site-feeds/box` ×2
    - `network/live` ×2
    - `apps/deploy/host-query.useDeploymentShipsEach`
    - `config_v2/fields.FieldsForm`
    - `fields/media/table.mediaFieldDef`
    - `infra/endpoints.useEndpointMutation`
    - `network/live/live-state.ResourceErrorInline`
    - `primitives/css/badge.Badge`
    - `primitives/css/card.Card`
    - `primitives/css/fill.Fill`
    - `primitives/css/line.Line`
    - `primitives/css/spacing.Stack`
    - `primitives/css/text.Text`
    - `primitives/css/ui-kit.Button`
    - `primitives/launch/investigate.Investigate`
    - `primitives/loading.Loading`
    - `primitives/relative-time.RelativeTime`
    - `primitives/slot-render.defineRenderSlot`
  - Exports (types):
    - `SiteFeedCardProps`
    - `SiteFeedItemProps`
  - Exports (values): `SiteFeedEditor`
- Server:
  - Contributes:
    - `resource.declare` "site-feeds.item-attachment-links"
    - `resource.declare` "site-feeds.item-attachment-links:rows"
    - `resource.declare` "site-feeds.items"
    - `resource.declare` "site-feeds.items:groups"
    - `resource.declare` "site-feeds.items:rows"
    - `attachments.link` "site_feed_items"
  - Uses:
    - `apps/deploy/deployments._deployDeployments`
    - `apps/deploy/site-feeds/box.judgeSiteFeedValues`
    - `apps/deploy/site-feeds/box.siteFeedOf`
    - `database.db`
    - `infra/attachments.Attachments`
    - `infra/endpoints.HttpError`
    - `infra/endpoints.implement`
    - `infra/entities.defaultNow`
    - `infra/entities.defineEntity`
    - `infra/events.defineTriggerEvent`
    - `network/live.serveCollection`
  - DB schema:
    - `plugins/apps/plugins/deploy/plugins/site-feeds/plugins/editor/server/internal/schema-attachments.ts`
    - `plugins/apps/plugins/deploy/plugins/site-feeds/plugins/editor/server/internal/tables-events.ts`
    - `plugins/apps/plugins/deploy/plugins/site-feeds/plugins/editor/server/internal/tables.ts`
  - Exports (types):
    - `SiteFeedItemEventPayload`
    - `SiteFeedItemPublishedPayload`
    - `SiteFeedItemRecord`
  - Exports (values):
    - `_siteFeedItemPublishedTriggers`
    - `_siteFeedItems`
    - `_siteFeedItemUnpublishedTriggers`
    - `feedOfItem`
    - `siteFeedItemPublished`
    - `siteFeedItemUnpublished`
  - Register:
    - `defineTriggerEvent('siteFeeds.itemPublished')`
    - `defineTriggerEvent('siteFeeds.itemUnpublished')`
  - Resources:
    - `site-feeds.item-attachment-links` (keyed)
    - `site-feeds.item-attachment-links:rows` (keyed, point)
    - `site-feeds.items` (keyed, window)
    - `site-feeds.items:groups` (push)
    - `site-feeds.items:rows` (keyed, point)
  - Routes:
    - `POST /api/deploy/site-feeds/items`
    - `DELETE /api/deploy/site-feeds/items/:id`
- Machine:
  - Uses:
    - `apps/deploy/host-query.uploadToBoxDataDir`
    - `infra/endpoints.implementMachine`
    - `infra/endpoints.machineHandler`
  - Register:
    - `defineJob('site-feeds.publish')`
    - `defineJob('site-feeds.unpublish')`
  - Routes:
    - `PATCH /api/deploy/site-feeds/items/:id`
    - `POST /api/deploy/site-feeds/items/:id/publish`
    - `POST /api/deploy/site-feeds/items/:id/unpublish`
- Core:
  - Uses:
    - `apps/deploy/site-feeds.siteFeedEntryIdKind`
    - `fields.FieldOptionMeta`
    - `fields.FieldsRecord`
    - `fields.nullable`
    - `fields/date/config.dateField`
    - `fields/json/config.jsonField`
    - `fields/text/config.enumTextField`
    - `fields/text/config.textField`
    - `ids.idKindField`
    - `infra/attachments.ATTACHMENT_LINKS_MAX`
    - `infra/attachments.attachmentLinkFields`
    - `infra/entities.entityRef`
    - `network/live.liveCollection`
    - `network/live.LiveRowsCollection`
    - `network/live/query-resource.compositeKey`
    - `packages/list-bound.wholeRecord`
  - Exports (types):
    - `SiteFeedItemRow`
    - `SiteFeedItemState`
    - `SiteFeedPublishState`
  - Exports (values):
    - `SITE_FEED_ITEM_STATE_META`
    - `SITE_FEED_ITEM_STATES`
    - `SITE_FEED_PUBLISH_STATE_META`
    - `SITE_FEED_PUBLISH_STATES`
    - `siteFeedItemAttachmentLinks`
    - `siteFeedItemAttachmentLinksEntityRef`
    - `siteFeedItemFields`
    - `siteFeedItems`
    - `siteFeedItemsEntityRef`
    - `siteFeedSearchText`
- Cross-plugin:
  - Imported by: `apps/deploy/site-feeds/syndication`
- Exemptions:
  - Exempts itself from: `ids:pk-declared` — `server/internal/tables-events.ts` (debt)
- Shared:
  - Exports (types): `UpdateSiteFeedItemAnswer`
  - Exports (values):
    - `createSiteFeedItem`
    - `deleteSiteFeedItem`
    - `publishSiteFeedItem`
    - `unpublishSiteFeedItem`
    - `updateSiteFeedItem`

<!-- AUTOGENERATED:END -->
