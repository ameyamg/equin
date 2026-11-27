# syndication

Posting a site feed's items to other services — a chat channel, a social
account — after they are published on the site: **once per item**, never
once per copy of the site it is on. Local only: nothing in a
site's closure imports it. **Names no target and no feed**: a target is a
plugin of its own ([`discord`](../discord/CLAUDE.md) is the first); a feed says
what makes a post through its declaration's `syndicate`. Design: decision 8 of
[`research/2026-11-25-global-site-feeds.md`](../../../../../../../../research/2026-11-25-global-site-feeds.md),
decisions 4 and 5 of [`research/2026-11-26-global-site-feeds-v2.md`](../../../../../../../../research/2026-11-26-global-site-feeds-v2.md).

## A target (core + server)

```ts
// <target>/core — the declaration both halves contribute
export const fooTarget = defineSyndicationTarget({
  id: "foo", label: "Foo", icon: symbol("send"),
  configFields: { token: secretField({ label: "Token" }), channel: textField({ label: "Channel" }) },
});
// <target>/web
SyndicationTargets.Target({ target: fooTarget })          // syndication/web
// <target>/machine
SyndicationTargets.Target(syndicationTarget(fooTarget, {  // syndication/server
  post:   (post, config, ctx) => …,           // → { ok: true, remoteId, url? } | { ok: false, error, retryable }
  edit?:  (remoteId, post, config, ctx) => …, // may answer a new id (the post was gone)
  remove?:(remoteId, config, ctx) => …,       // already gone is { ok: true }
  validate?: (config) => string | null,       // refused at save while the target is on
}))
```

- `config` is parsed against the declaration (`configSchema`) before each
  call, secrets read back. `ctx = { signal, workDir }`: the job's signal and a
  directory of the run's own (removed after it) for anything the target
  re-encodes.
- `SyndicatedPost = { title, paragraphs, media, url }` — structured, the
  target formats it: the first `syndicate.text` value is `title` (plain text,
  null when empty), the others `paragraphs` (empty dropped), each a
  `FormattedText` ([`fields/formatted-text`](../../../../../../../fields/plugins/formatted-text/CLAUDE.md):
  a formatted-text field's markup parsed — bold, key caps, links — any other
  field's text one plain run, never read as markup), `media` the
  `syndicate.media` field's files copied out of the attachment store
  (`{ path, mime, filename, size, durationMs? }`), `url` the feed's page on
  the item's **primary destination** (editor's `primarySiteFeedDestination`):
  the first deployment this instance publishes to
  (`https://<first hostname><feed.pagePath ?? "/">`), else this instance
  (`http://<namespace>.localhost:<port><feed.localPagePath>`); null when that
  copy has no address for it.
- `post`'s `url?` — where a person sees the post (a message link), when the
  target can say: what Send test post shows.
- `retryable: true` only for what a later attempt may cure (a rate limit, the
  service down); a throw (no answer at all) is retried too. Everything else
  ends the run failed with the target's words.

## Settings (machine)

`site_feed_syndication_settings (feed_id, target_id, enabled, config jsonb,
updated_at)`: one target for one feed — wherever the feed is published. The
non-secret config is the row's; each `secretField` value is
in `infra/secrets`, namespace `site-feeds` (**instance** scope — the row's
own: a worktree testing a target keeps its own copy and never overwrites
main's), keyed `<feedId>/<targetId>/<field>`. The browser reads
`site-feeds.syndication-settings` (a live value per `feedId`,
served by the computer, notified on save): `{ enabled, config (non-secret),
secretsSet }` per saved target. `PUT /api/deploy/site-feeds/syndication/settings`
merges `set` onto the stored config, parses it, and — while the target is on —
asks the target's `validate`; a refusal saves nothing (`invalid`).

## Posts (machine)

`site_feed_syndications (item_id → site_feed_items cascade, target_id, state
pending|posted|failed, remote_id, error, updated_at)`, read live per item
(`site-feeds.syndications`, `all: { by: itemId }`). A post removed from its
target leaves no row.

- `site-feeds.syndicate-item` (keyed by item) runs on every
  `siteFeeds.itemPublished` / `itemUnpublished` (`Trigger`s from `editor`,
  which emits them once per item — when its primary destination has it, and
  when no destination holds it any more):
  a published item → every target switched on for its feed (the feed must
  declare `syndicate`); an unpublished one → every target holding its post
  (rows never posted are deleted). Each is marked `pending` and queued.
- `site-feeds.syndicate` (keyed by `(item, target)`, one lane, 5 attempts)
  reads where the item stands NOW (`flow.ts`, `decideSyndication`): published
  and not there → `post`; there → `edit` (or kept, for a target without
  `edit`); unpublished and there → `remove` (even with the target off — an
  unpublish never leaves a post behind); not there → forgotten. Then
  `posted` with the remote id, the row deleted, `failed` with the words, or —
  retryable — the words kept on the pending row and the run thrown for a
  retry (`onDead` writes the last error).
- `POST …/syndication/retry { itemId, targetId }` queues it again.
- **Send test post** — `POST …/syndication/test { feedId, targetId, itemId }`
  (`test-post.ts`, `testPostOnce`): the item posted to the target NOW through
  its `post`, with the settings as saved (on or off; its `validate` asked
  first), its files staged in a work dir of its own. **Records nothing** — no
  row, no remote id kept: answers `posted { remoteId, url? }` or `failed {
  error }` in the target's words. The post stays on the target: point it at a
  private channel.
- A crash between a target's answer and the row write posts twice on the
  retry (the run cannot know the post landed).

## Web

`SyndicationTargets.Target` (data slot) and three contributions to
[`editor`](../editor/CLAUDE.md)'s `SiteFeedEditor` slots on the Feeds page:
**Also post to** under each feed (one `FieldsForm` per target: a `Post to
<Target>` switch then its fields; a secret through `SecretFieldStatusContext`,
so it shows Configured / Replace and never its value; then **Send test post**
for the item open above — disabled while none is — and the target's answer,
its link when it gives one; a feed without `syndicate` says it can't be
cross-posted), a chip per target in each item's row (Posting… /
Updating… / Removing… / Posted / Failed, the error as its title), and in the
opened item each target's state, its last error and Retry.

## Tests

- `machine/internal/flow.test.ts` — the routing (post / edit / keep / remove /
  forget / cannot-remove) against a fake target: retryable vs final failures,
  a disabled target removes but never posts, staged files disposed on a throw.
- `machine/internal/test-post.test.ts` — Send test post's routing: posted with
  the saved config and the link answered; refused before posting (no target,
  no item, unpostable, not set up, `validate`); the target's own refusal;
  staged files always disposed.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: Posting a site feed's items elsewhere, on the Deploy app's Feeds page: the SyndicationTargets.Target slot a target plugin contributes its declaration to (label, icon, settings fields — nothing here names a target); under each feed, Also post to — every target switched on or off and set up with its own fields (a secret shown only as set or not), or why the feed cannot be cross-posted; in each item's row a chip per target it was sent to; in the opened item, each target's state, its last error and Retry; per target, Send test post — the open item posted with the settings as saved, recording nothing, the target's answer (its post's link) shown. Where a site feed's items are posted besides the site: the SyndicationTargets.Target contribution a target plugin's machine half provides (its declaration and its post / edit / remove calls — nothing here names a target), the site_feed_syndications table (one item on one target: pending, posted with the target's id for it, or failed with why) served live per item, and the per feed and target settings table (on or off, the non-secret config).
- Web:
  - Slots: `SyndicationTargets.Target`
  - Slot contributors: `SyndicationTargets.Target` ← `apps.deploy.site-feeds.discord`
  - Contributes:
    - `DataViewSlots.CollectionItemAction` "site-feeds.syndications:investigate" → `CollectionInvestigate`
    - `SiteFeedEditor.FeedSection` → `AlsoPostTo`
    - `SiteFeedEditor.ItemStatus` → `ItemSyndicationChips`
    - `SiteFeedEditor.ItemSection` → `ItemSyndications`
  - Uses:
    - `apps/deploy/site-feeds/editor.SiteFeedEditor`
    - `config_v2/fields.FieldsForm`
    - `fields/secret/config.SecretFieldStatusContext`
    - `infra/endpoints.useEndpointMutation`
    - `network/live.useLive`
    - `network/live/live-state.matchResource`
    - `primitives/css/badge.Badge`
    - `primitives/css/line.Line`
    - `primitives/css/spacing.Stack`
    - `primitives/css/text.SectionLabel`
    - `primitives/css/text.Text`
    - `primitives/css/ui-kit.Button`
    - `primitives/launch/investigate.Investigate`
    - `ui/icons.Icon`
  - Exports (types): `SyndicationTargetWebContribution`
  - Exports (values): `SyndicationTargets`
- Server:
  - Contributes:
    - `resource.declare` "site-feeds.syndication-settings"
    - `resource.declare` "site-feeds.syndications"
    - `resource.declare` "site-feeds.syndications:rows"
    - `trigger` "site-feeds.syndicate-item"
    - `trigger` "site-feeds.syndicate-item"
  - Uses:
    - `apps/deploy/site-feeds/editor._siteFeedItems`
    - `infra/entities.defaultNow`
    - `infra/entities.defineEntity`
    - `network/live.serveCollection`
  - DB schema: `plugins/apps/plugins/deploy/plugins/site-feeds/plugins/syndication/server/internal/tables.ts`
  - Exports (types):
    - `SyndicationCallCtx`
    - `SyndicationTargetCalls`
    - `SyndicationTargetContribution`
  - Exports (values):
    - `syndicationTarget`
    - `syndicationTargetOf`
    - `syndicationTargets`
    - `SyndicationTargets`
  - Resources:
    - `site-feeds.syndication-settings` (push, notified, capped: SYNDICATION_TARGETS_MAX, whole: one target's config — one value per field it declares, whole: one target's secret fields — a handful it declares)
    - `site-feeds.syndications` (keyed)
    - `site-feeds.syndications:rows` (keyed, point)
- Machine:
  - Uses:
    - `infra/endpoints.implementMachine`
    - `infra/endpoints.machineHandler`
    - `network/live.serveValue`
  - Register:
    - `defineJob('site-feeds.syndicate')`
    - `defineJob('site-feeds.syndicate-item')`
  - Routes:
    - `PUT /api/deploy/site-feeds/syndication/settings`
    - `POST /api/deploy/site-feeds/syndication/retry`
    - `POST /api/deploy/site-feeds/syndication/test`
- Core:
  - Uses: 25 symbols — full list in [REFERENCE.md](./REFERENCE.md)
    - `fields/formatted-text` ×5
    - `fields` ×5
    - `network/live` ×3
    - `fields/media` ×2
    - `fields/text/config` ×2
    - `packages/list-bound` ×2
    - `apps/deploy/site-feeds.siteFeedEntryIdKind`
    - `fields/date/config.dateField`
    - `fields/secret.secretFieldType`
    - `ids.idKindField`
    - `infra/entities.entityRef`
    - `network/live/query-resource.compositeKey`
  - Exports (types):
    - `SiteFeedSyndicationRow`
    - `SyndicatedMedia`
    - `SyndicatedPost`
    - `SyndicatedText`
    - `SyndicationFailure`
    - `SyndicationPostResult`
    - `SyndicationRemoveResult`
    - `SyndicationState`
    - `SyndicationTargetDecl`
    - `SyndicationTargetSettings`
  - Exports (values):
    - `defaultTargetSettings`
    - `defineSyndicationTarget`
    - `secretConfigKeys`
    - `siteFeedSyndicationFields`
    - `siteFeedSyndications`
    - `siteFeedSyndicationsEntityRef`
    - `syndicatedMediaRefs`
    - `syndicatedText`
    - `SYNDICATION_STATE_META`
    - `SYNDICATION_STATES`
    - `SYNDICATION_TARGET_ID_PATTERN`
    - `SYNDICATION_TARGETS_MAX`
    - `SyndicationTargetDeclarationError`
    - `syndicationTargetSettings`
    - `SyndicationTargetSettingsSchema`
- Cross-plugin:
  - Imported by: `apps/deploy/site-feeds/discord`
- Shared:
  - Exports (values):
    - `retrySyndication`
    - `saveSyndicationSettings`
    - `sendTestPost`

<!-- AUTOGENERATED:END -->
