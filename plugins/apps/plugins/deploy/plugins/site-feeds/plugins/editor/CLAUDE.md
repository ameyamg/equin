# editor

The site-feed items on THIS computer — the source of truth — and the Deploy
app's **Feeds** page that edits them and publishes them to every copy of the
site. Local only: nothing in a site's closure imports it (the site ships
[`box`](../box/CLAUDE.md)); it names no feed and no field. Design:
[`research/2026-11-26-global-site-feeds-v2.md`](../../../../../../../../research/2026-11-26-global-site-feeds-v2.md)
(v1: [`2026-11-25`](../../../../../../../../research/2026-11-25-global-site-feeds.md)).

## Items — owned by the feed

- `site_feed_items (id sfe-…, feed_id, values jsonb, search_text (every text
  value, derived from `values` on each write by `siteFeedSearchText`: what the
  list's search matches), state draft|published, published_at, created_at,
  updated_at)` — `core/internal/items.ts` (`siteFeedItemFields`), built by
  `defineEntity`. **No deployment**: an item is its feed's, published to
  every copy of the site. `state` is the user's intent; `published_at` the
  first publish (the feed's order), cleared on unpublish. The id is the
  entry's id on every destination. `updated_at` moves only with `values`.
- `site_feed_items_attachments` (`Attachments.defineLink`): set to exactly the
  values' `mediaAttachmentIds` on every save, so a draft's files outlive the
  media field's 24 h upload hold.
- `site-feeds.items` (`siteFeedItems`): a window (50, max 200), every read
  scoped `where: { feedId }`; `:rows` reads one item.
- Values are validated on every write with the box's own judge
  (`judgeSiteFeedValues` from `box/server`, the feed found with `siteFeedOf`:
  the local app runs every plugin, the site's included) — zod issues and an
  undeclared key are `invalid-values`, never stored.

## Destinations and publications

A **destination** (`SiteFeedDestination`, core) is a copy of the site serving
the feed:

- **`local`** — THIS instance. It runs the website app, box half included,
  so its own `site_feed_entries` is a copy of the site: publishing calls the
  box's `upsertSiteFeedEntry` / `deleteSiteFeedEntry` in-process
  (`machine/internal/local-transport.ts`), the media are this instance's
  attachments already — nothing is copied. Always a destination, from any
  checkout: `http://<namespace>.localhost:<port><feed.localPagePath>` shows it.
- **`deployment:<id>`** — every deployment whose composition closure includes
  the feed's declaring plugin (`siteFeedDestinations`, `server/`: the
  declaring plugin is the server contribution's own stamp,
  `siteFeedDeclarationOf`; membership from
  `plugin-meta/composition/server`'s `compositionIncludesEach`, the server twin
  of the web's `useDeploymentShipsEach` — no composition named). Over SSH, as
  v1 (`transport.ts`, `boxTransport`).

**A worktree never publishes to a deployed site.** Its database is a fork of
main's — equin.ai's deployment row included — and its SSH reaches production.
The Deploy button has no such rule (a deploy from a worktree is scoped by
`launched_from`), so the feeds carry their own: `remoteRefusal(isMain())`
(`server/internal/destination-rules.ts`). It is applied three times — the
fan-out never queues a refused destination (`publishTargets`), the job
refuses one again before any SSH (`routeDestination`: a row queued on main,
run after a restore into a worktree), and `site-feeds.publish-scope` (a
`fixed` live value) tells the UI, whose Published to row shows each deployed
site with "Publishing to deployed sites happens from the main checkout only".

`site_feed_publications (item_id → items cascade, destination, state
publishing|published|unpublishing|failed, error, published_at, updated_at)`,
pk `(item_id, destination)`, read live per item (`site-feeds.publications`,
`all: { by: itemId }`). An item unpublished from a destination leaves no row
there. No foreign key to a deployment: a removed one's row stays, shown as "A
removed site".

## Routes (`shared/`)

| route | half | answer |
|---|---|---|
| `POST /api/deploy/site-feeds/items` `{ feedId }` | server | `created { id }` · `unknown-feed` (values = the declaration's defaults) |
| `PATCH …/items/:id` `{ set }` | machine | `saved` · `invalid-values { issues }` · `unknown-feed`; a published item is published again on every destination holding a row |
| `DELETE …/items/:id` | server | `deleted` · `published` (unpublish first) · `busy` (a destination still holds it) |
| `POST …/items/:id/publish` `{ destination? }` | machine | `queued { destinations }` · `refused { message }` · `unknown-feed` — no destination: every one not refused; one: that one alone (a deployment added since, a Retry) |
| `POST …/items/:id/unpublish` | machine | `queued { destinations }` — every destination holding a row |

`set` holds only the fields one edit changed; the server merges it onto the
stored values, one save per item at a time (a keyed mutex), so two edits in
flight at once (a title typed while a video uploads) both land.

## Job (`machine/`)

`site-feeds.publish`, keyed by `(item, destination)`, one lane
(`serial: { with: "site-feeds.box" }`), 4 attempts. Each run reads what the
item asks NOW (`decidePublication`, `fan-out.ts`) — never what queued it — so
a publish and an unpublish in either order end where the item is:

- **published + row** → `publishItem` over the destination's
  `PublishTransport` (`publish-flow.ts`): `media/missing` → for each missing
  file stage (hashed, `site-feeds-outgoing`), upload, `media/import` →
  `entries/upsert`. Then the row `published` — only while the item is still
  the one read (state and `updated_at`), else the newer run publishes it.
- **draft + row** → `unpublishItem` (`deleted` / `absent` / `unknown-feed`
  all mean gone), then the row is deleted (unless the item was published
  again since).
- **Refusals end the run `failed`** with a sentence in the row's `error` (an
  older feed on the site — "deploy it", the server not set up, SSH auth, an
  import mismatch, off main). **Transport failures throw**
  `PublishTransportError` and are retried; `onDead` writes the last one.
- **Events, once per item**: `siteFeeds.itemPublished` (`{ itemId, feedId,
  firstPublish }`) when the item's **primary destination** has it — the first
  deployment this instance publishes to, else `local`
  (`primaryDestination`); `siteFeeds.itemUnpublished` (`{ itemId, feedId }`)
  when no destination holds it any more (or at once, when none did).
  Filterable by `feedId`; syndication subscribes with `Trigger`.

## Web

The **Feeds** page (`/deploy/feeds`, `feedsPane`), a `Deploy.Sidebar` entry
after Activity: one card per feed a plugin of this app declares
(`useSiteFeedDeclarations()`) — its items DataView (`deploy.site-feed-items`)
whose value columns are derived from the feed's fields (`item-fields.tsx`:
media fields as the media cell, text fields as their first line, the first
one the title; a **Published to** column of a chip per destination row), New
item, and the opened item below the list (`ItemEditor`: `FieldsForm`
autosave, Publish / Publish again / Unpublish / Delete, and the **Published
to** row — `destinations.tsx`: this instance, then each deployment shipping
the feed's declaring plugin (`useDeploymentShips`), each with its state or
"Not on this site", its error, Open, Publish here / Retry, or the off-main
refusal). A failed publication has an Investigate action.

What follows a publish shows itself through `SiteFeedEditor` (web) render
slots, so the editor names none of it: `FeedSection` (under a feed's list,
handed `{ feed, openItemId }`), `ItemStatus` (an "Elsewhere" column, added
only while something contributes) and `ItemSection` (in the opened item).
`syndication` is their contributor. The server barrel also exports
`_siteFeedItems`, `feedOfItem`, `SiteFeedItemRecord`,
`siteFeedDestinations` and `primarySiteFeedDestination` for it.

## Tests

- `core/internal/items.test.ts` — `siteFeedSearchText`.
- `server/internal/destination-rules.test.ts` — destination resolution
  (deployments shipping the feed in order, then local; page URLs), the
  primary destination, the worktree refusal.
- `machine/internal/fan-out.test.ts` — fan-out routing (all / one / refused
  off main / not a copy), `decidePublication`, `routeDestination` never
  reaching a deployment off main.
- `machine/internal/local-transport.test.ts` — local publish through the box
  half (in-process upsert, nothing transferred, its refusals, delete).
- `machine/internal/publish-flow.test.ts` — the flow against a fake box: only
  missing files move, import then upsert, refusals in words, transport
  failures thrown, staged copies always removed; unpublish's arms.
- `e2e/publish-roundtrip.ts` — the whole life through the UI only, on this
  checkout's build: Deploy → Feeds → New item → title, text, a PNG and an
  ffmpeg-made MP4 → Publish → this instance's `/about/tips` shows it and its
  video seeks (206), no deployed site queued from a worktree → edit the title
  → updated → Unpublish → gone, media 404. No seeding; cleans up through the
  app's endpoints.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: The Feeds page of the Deploy app (/deploy/feeds, its sidebar entry): one card per feed a plugin of this app declares (SiteFeeds.Feed) — its items on this computer as a live DataView (columns derived from the feed's own fields: its text as the title, its media as thumbnails; state, published, and a chip per copy of the site it is on), New item, and the opened item's editor (the feed's FieldsForm, autosaved; Publish / Publish again / Unpublish / Delete) with its Published to row: this instance and each deployment shipping the feed's declaring plugin, where the item stands there, its last error, Publish here / Retry — a deployed site said to be published to from main only off main. A failed publication has an Investigate action. What follows a publish shows itself through the SiteFeedEditor slots: a section under a feed's list, chips in an item's row, a section in the opened item. Site feed items on this computer — the source of truth for what a site's feeds publish: the site_feed_items table (a draft or published item of one feed — never of one deployment — its values validated against the feed's declaration on every write) and its attachment links (set from the values' media on every save, so drafts keep their files); site_feed_publications (one item on one destination — this instance, or a deployment shipping the feed — publishing, published, unpublishing or failed with why) served live per item; the live site-feeds.items window per feed; site-feeds.publish-scope (whether this instance publishes to deployed sites: main only, never a worktree whose database is a fork holding production's rows); the destinations a feed's items go to (siteFeedDestinations: every deployment whose composition closure includes the feed's declaring plugin, then this instance); the create and delete routes (a draft only); and the siteFeeds.itemPublished / siteFeeds.itemUnpublished events — once per item, when its primary destination has it (or no destination holds it any more) — that syndication subscribes to.
- Web:
  - Slots:
    - `SiteFeedEditor.FeedSection`
    - `SiteFeedEditor.ItemStatus`
    - `SiteFeedEditor.ItemSection`
    - `deploy-feeds.actions`
  - Slot contributors:
    - `SiteFeedEditor.FeedSection` ← `apps.deploy.site-feeds.syndication`
    - `SiteFeedEditor.ItemStatus` ← `apps.deploy.site-feeds.syndication`
    - `SiteFeedEditor.ItemSection` ← `apps.deploy.site-feeds.syndication`
    - `deploy-feeds.actions` ← `primitives.pane`
  - Contributes:
    - `DataViewSlots.CollectionItemAction` "site-feeds.publications:investigate" → `CollectionInvestigate`
    - `Pane.Register` "deploy-feeds"
    - `Deploy.Sidebar` "Feeds"
  - Uses: 34 symbols — full list in [REFERENCE.md](./REFERENCE.md)
    - `primitives/data-view` ×4
    - `primitives/pane` ×3
    - `apps/deploy/deployments` ×2
    - `network/live/live-state` ×2
    - `network/live` ×2
    - `primitives/css/spacing` ×2
    - `primitives/css/text` ×2
    - `apps/deploy/host-query.useDeploymentShips`
    - `apps/deploy/shell.Deploy`
    - `apps/deploy/site-feeds/box.useSiteFeedDeclarations`
    - `config_v2/fields.FieldsForm`
    - `fields/date/format.useDateFormatter`
    - `fields/media/table.mediaFieldDef`
    - `infra/endpoints.useEndpointMutation`
    - `primitives/app-shell.opensPane`
    - `primitives/css/badge.Badge`
    - `primitives/css/card.Card`
    - `primitives/css/fill.Fill`
    - `primitives/css/line.Line`
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
    - `resource.declare` "site-feeds.publications"
    - `resource.declare` "site-feeds.publications:rows"
    - `resource.declare` "site-feeds.publish-scope"
    - `attachments.link` "site_feed_items"
  - Uses:
    - `apps/deploy/deployments._deployDeployments`
    - `apps/deploy/site-feeds/box.judgeSiteFeedValues`
    - `apps/deploy/site-feeds/box.siteFeedDeclarationOf`
    - `apps/deploy/site-feeds/box.siteFeedOf`
    - `database.db`
    - `infra/attachments.Attachments`
    - `infra/endpoints.HttpError`
    - `infra/endpoints.implement`
    - `infra/entities.defaultNow`
    - `infra/entities.defineEntity`
    - `infra/events.defineTriggerEvent`
    - `network/live.serveCollection`
    - `network/live.serveValue`
    - `plugin-meta/composition.compositionIncludesEach`
  - DB schema:
    - `plugins/apps/plugins/deploy/plugins/site-feeds/plugins/editor/server/internal/schema-attachments.ts`
    - `plugins/apps/plugins/deploy/plugins/site-feeds/plugins/editor/server/internal/tables-events.ts`
    - `plugins/apps/plugins/deploy/plugins/site-feeds/plugins/editor/server/internal/tables.ts`
  - Exports (types):
    - `ResolvedDestination`
    - `SiteFeedItemEventPayload`
    - `SiteFeedItemPublishedPayload`
    - `SiteFeedItemRecord`
  - Exports (values):
    - `_siteFeedItemPublishedTriggers`
    - `_siteFeedItems`
    - `_siteFeedItemUnpublishedTriggers`
    - `feedOfItem`
    - `primarySiteFeedDestination`
    - `siteFeedDestinations`
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
    - `site-feeds.publications` (keyed)
    - `site-feeds.publications:rows` (keyed, point)
    - `site-feeds.publish-scope` (push, fixed)
  - Routes:
    - `POST /api/deploy/site-feeds/items`
    - `DELETE /api/deploy/site-feeds/items/:id`
- Machine:
  - Uses:
    - `apps/deploy/host-query.uploadToBoxDataDir`
    - `infra/endpoints.implementMachine`
    - `infra/endpoints.machineHandler`
  - Register: `defineJob('site-feeds.publish')`
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
    - `network/live.liveValue`
    - `network/live/query-resource.compositeKey`
    - `packages/list-bound.wholeRecord`
  - Exports (types):
    - `SiteFeedDestination`
    - `SiteFeedItemRow`
    - `SiteFeedItemState`
    - `SiteFeedPublicationRow`
    - `SiteFeedPublicationState`
    - `SitePublishScope`
  - Exports (values):
    - `deploymentDestination`
    - `parseDestination`
    - `SITE_FEED_DESTINATIONS_MAX`
    - `SITE_FEED_ITEM_STATE_META`
    - `SITE_FEED_ITEM_STATES`
    - `SITE_FEED_LOCAL_DESTINATION`
    - `SITE_FEED_PUBLICATION_STATE_META`
    - `SITE_FEED_PUBLICATION_STATES`
    - `SiteFeedDestinationSchema`
    - `siteFeedItemAttachmentLinks`
    - `siteFeedItemAttachmentLinksEntityRef`
    - `siteFeedItemFields`
    - `siteFeedItems`
    - `siteFeedItemsEntityRef`
    - `siteFeedPublicationFields`
    - `siteFeedPublications`
    - `siteFeedPublicationsEntityRef`
    - `siteFeedSearchText`
    - `sitePublishScope`
    - `SitePublishScopeSchema`
- Cross-plugin:
  - Uses tokens:
    - `ui/tokens/density --space-2xl`
    - `ui/tokens/density --space-xl`
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
