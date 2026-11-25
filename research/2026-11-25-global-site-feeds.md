# Site feeds — publish a site's own content (tips of the day) from equin, cross-post to Discord

Task: task-1795618017-ge65r4.

## Context

The user posts a "tip of the day" (a title, some text, screenshots or videos)
in the equin Discord and wants the same tips on equin.ai. Discord has no
per-message embed, so the direction is inverted: **equin is the source**, the
website shows the tip live, and Discord receives a copy.

The user's constraints, from the conversation:

- **A UI, never a CLI**, to write and publish.
- **No git and no release in the loop.** Media must not live in git or on a
  GitHub release, and publishing a tip must not need a push or a deploy.
- **Generic.** The Deploy app must not know equin.ai or what a tip is. A feed is
  generic, and **the site declares the shape of its items** (equin's tips are
  one feed; another site, or equin later, declares others).
- **Discord gets the real video**, embedded, never a link instead.

## Shape

```
fields/media                      a new field type: uploaded media (attachment refs)
config_v2/fields  FieldsForm      the generic form from a FieldsRecord (promoted from events/sources)
primitives/upload-dropzone        drop/paste/click upload, extracted from page/attachment-block
media/ffmpeg  transcodeToBudget   re-encode a video to fit a byte budget

apps/deploy/site-feeds            (umbrella)
  core/                           defineSiteFeed, SiteFeedDecl, SyndicatedPost, the wire contracts
  plugins/box                     ships IN the site: published entries, public read, media route, host-only import
  plugins/editor                  local only: the Feeds tabs on a site's page, the source-of-truth items, publish
  plugins/syndication             local only: the SiteFeeds.Target slot, per-feed target config, the syndicate job
  plugins/discord                 local only: the Discord webhook target

apps/website/pages/tips                 the ONLY tip-specific code: declares the feed, renders the Tips page
```

Nothing under `site-feeds` names a feed, a field or a target; `website/pages/tips`
is the only place that knows what a tip is; `site-feeds/discord` is the only
place that knows Discord.

## Key decisions

### 1. A feed is a declaration the site owns

```ts
// apps/website/pages/tips/core — the only place that knows what a tip is
export const tipsFeed = defineSiteFeed({
  id: "tips",
  label: "Tips of the day",
  fields: {
    title: textField({ label: "Title" }),
    body: multilineTextField({ label: "Text" }),
    media: mediaField({ label: "Screenshots and videos", accept: ["image/*", "video/*"], max: 10 }),
  },
  syndicate: { text: ["title", "body"], media: "media" }, // keys of `fields`, typed
  publicLimit: 60, // newest N entries the site serves to visitors
});
```

- `fields` is a plain `FieldsRecord` (`plugins/fields/core`); values are
  validated with `fieldsToZodObject(fields)` on every write, locally AND on the
  box. Item type = `InferFieldsObject<typeof fields>`.
- `syndicate` is data, typed against the field keys: which fields make a
  post's text (joined, the first one bold) and which `media` field its files.
  No `syndicate` → the feed has no targets, and the editor says so.
- **No wire form of fields.** FieldDefs hold live zod schemas and can't be sent.
  They don't need to be: the site plugin registers the feed in BOTH runtimes
  of the same code (see 2), and the local app runs every plugin, `website`
  included (it is the `/about` app).

### 2. How the Deploy app learns a site's feeds without naming it

- `website/tips/web` contributes `SiteFeeds.Feed(tipsFeed)` (a web slot owned by
  `site-feeds/editor`'s `core`/`web`), and `website/tips/server` contributes the
  same declaration to the box's server registry (`SiteFeeds.Feed` server
  contribution owned by `site-feeds/box`).
- The editor reads the slot, and for each feed asks
  `useDeploymentShips(deploymentId, <declaring plugin id>)` (`deploy/host-query`)
  — the exact mechanism the Messages tab uses. A site whose composition doesn't
  include the declaring plugin gets no tab. No composition is named.
  The declaring plugin id: the slot contribution's own plugin id if the slot
  records it, otherwise `defineSiteFeed` takes `plugin: asPluginId(...)` pinned
  by a test, the `INTAKE_PLUGIN_ID` precedent.
- **Skew** (the local repo declares a field the deployed site doesn't know yet):
  the box validates against ITS declaration and refuses (`422` with zod's
  issues); the editor shows "the site runs an older version of this feed —
  deploy it" with the refusal. Never a silent drop.

### 3. Source of truth is local; the box holds the published copy

The items, drafts and original media live **in the local equin DB**; the box
holds only what's published. Consequences, all wanted:

- The editor is an ordinary local CRUD surface (`liveCollection` + DataView +
  endpoints) — no remote reads to render it, drafts for free.
- The local DB already has the backups; losing the box loses nothing.
- Discord is posted from the computer, which holds the original files and the
  webhook secret (it never reaches the box).
- The website reads only the box (one public live read).

### 4. Media: a field type over attachments, content stays out of git

- **`fields/media`**: value `MediaRef[]` where
  `MediaRef = { attachmentId, mime, filename, size, width?, height?, durationMs? }`.
  Sub-plugins following the type-plugin pattern (`fields/plugins/text`):
  `core` (type + identity + `mediaField({ label, accept, max })` factory),
  `config` (`Fields.Renderer`: a `block` shape — thumbnails, reorder, remove,
  plus the dropzone; `Fields.Sample`), `table` (thumbnail cell). Storage: jsonb
  via the `json` arm (no own column).
- **Upload dropzone**: extract `AttachmentUpload`
  (`page/plugins/attachment-block/web/components/attachment-upload.tsx`) into
  `primitives/upload-dropzone`, decoupled from `useBlockActivate`; the page
  block then uses it.
- **Orphan sweep**: the renderer places an attachment hold
  (`PUT /api/attachments/holds`, TTL 24 h) on what it uploads; saving the item
  sets the owner link (`site_feed_items_attachments`, `Attachments.defineLink`,
  derived from every media field's refs). Nothing relies on the hold past save.
- **Size**: attachments' `MAX_SIZE` is 20 MB (`handle-upload.ts`). Videos need
  more: a media field declares `maxBytes` (default 500 MB) and the upload path
  is made streaming (blob written from the request stream, not buffered) with
  the cap taken from the request's declared purpose. Not a "raise the limit
  because it got hit": video is new content; the bound stays explicit.
- **Byte ranges**: video must seek. The attachment serve route adopts
  `rangedBlobResponse` (`infra/endpoints/core`, already used by asset-mirror).

### 5. Box: published entries, public read, media route

`site-feeds/box` (server half pulled into a site's closure by importing its
web barrel — the `site-messages/intake` rule; `website/tips/web` imports
`useSiteFeed` from it):

- **Tables**: `site_feed_entries (feed_id, id, values jsonb, published_at,
  updated_at)` + `site_feed_entries_attachments` link table; media bytes stored
  through the box's `attachments` (`AttachmentBlobs`) **under the local
  attachment's id** — ids are UUIDs, so re-publishing is idempotent (exists →
  skip the transfer).
- **Public read**: `liveValue("site-feeds.entries", { access: { visitor: … } })`
  parameterised by `feedId`, `visitorTuple: feed declared on this site`,
  bounded by the feed's `publicLimit` (paged values can't be visitor-readable —
  `network/live/CLAUDE.md` "Who may read"). `useSiteFeed(feed)` returns the
  typed live state (loading / entries).
- **Public media**: `GET /api/site-feeds/media/:entryId/:attachmentId`
  (visitor), served only if the link row exists, byte ranges,
  `cache-control: public, immutable` (an attachment's bytes never change).
- **Host-only writes** (`hostOnly`, `/api/host-only/site-feeds/...`,
  `analytics/host-only`):
  - `POST …/media/import?q={attachmentId, filename, mime, sha256, stagedName}` —
    moves a file staged by scp into attachments after checking its sha256.
  - `POST …/entries/upsert` (JSON body ≤ 64 KB, validated against the box's
    feed declaration, links attachments that must already exist → 409 if not).
  - `POST …/entries/delete`.
- Staging dir: a `data-dirs/` entry of `site-feeds/box`, swept of files older
  than a day by a `defineRetention`.

### 6. Local → box writes over SSH

`deploy/host-query` gets the write sibling of `hostOnlyQueryOverSsh`:

- `hostOnlyWriteOverSsh(deploymentId, path, body, schema)` —
  `curl -X POST -H 'content-type: application/json' --data-binary @-` with the
  JSON on `sshRun`'s stdin (`infra/ssh`), same target resolution
  (`require-pinned`), same failure union, same demo stand-in bypass
  (`markServerBoxIsThisInstance` → a POST to this instance's own gateway).
- Media bytes: `sshUpload` (`infra/ssh`, scp to a staging sibling + rename)
  into the box's staging dir, then the import route. Stand-in: copy locally.

### 7. Publish

Local tables in `site-feeds/editor`:
`site_feed_items (id, deployment_id, feed_id, values, state: draft|published,
published_at, created_at, updated_at, last_publish_error)` + its attachment link
table.

- Endpoints: create / update (autosave from `FieldsForm`) / delete / publish /
  unpublish.
- `site-feeds.publish` job (`defineJob`, keyed by item, `serial` per
  deployment, retries for transport failures only — a 422 is terminal and shown):
  upload missing media → upsert → mark published → enqueue syndication per
  enabled target. Editing a published item re-runs publish (and syndication's
  edit). Unpublish deletes on the box (and on targets).

### 8. Syndication targets — an open set

`site-feeds/syndication`:

- Server contribution `SiteFeeds.Target({ id, label, configFields,
  post, edit?, remove? })` where `post(post: SyndicatedPost, config, ctx) →
  { ok: true, remoteId } | { ok: false, error }`;
  `SyndicatedPost = { text, media: { path, mime, filename, size, durationMs? }[], url }`
  (`url`: the entry on the site). Web contribution: label + icon + configFields.
- Per (deployment, feed, target) config, edited with `FieldsForm` in the feed tab's
  settings; `secret: true` fields go to `infra/secrets` (namespace
  `site-feeds`, scope `machine`), the browser sees only `{ set }`.
- `site_feed_syndications (item_id, target_id, state, remote_id, error, at)`,
  shown per item in the list (a chip per target).
- `site-feeds.syndicate` job keyed by (item, target).

### 9. Discord target

`site-feeds/discord`, config `{ webhookUrl (secret), uploadLimitMb: 10 }`
(10 unboosted, 50 boost level 2, 100 level 3):

- One message per item: `payload_json` (content: syndicated text, ≤ 2000 chars
  → refused before posting if longer) + `files[i]` multipart, `?wait=true` to
  get the message id (stored as `remoteId`). ≤ 10 files.
- Each file over the budget: a video is re-encoded with
  `transcodeToBudget(input, budgetBytes)` (new export of `media/ffmpeg`:
  probe duration with ffprobe, two-pass H.264 at
  `budget·8·0.95/duration − audio` bitrate, faststart; checks the result fits).
  An image over budget, or a video that can't reach a watchable bitrate
  (< 300 kbps), fails the target **before** anything is posted, with the size
  and the limit in the message. Never a link instead.
- Total multipart size must also fit the limit (Discord's limit is per request).
  If the files together don't, the target refuses with the per-file sizes —
  the user splits the tip.
- `edit` → `PATCH /webhooks/:id/:token/messages/:remoteId` (text and files);
  `remove` → `DELETE`.
- Client is stateless like `integrations/resend` (pure request builder +
  response parser, unit-tested); the job owns retries.

### 10. The website section

`apps/website/pages/tips`:

- `core`: `tipsFeed`.
- `server`: `SiteFeeds.Feed(tipsFeed)` (box registry).
- `web`: `SiteFeeds.Feed(tipsFeed)` (editor registry) and a **Tips page**
  (`/about/tips`, `equin.ai/tips`) entered from the header's **Learn** menu
  (`Website.LearnEntry`, after Story), built like `pages/story`
  (`defineWebsitePage`, its pane, its sitemap entry on the server). The page
  renders `useSiteFeed(tipsFeed)`: loading state, then newest-first cards —
  title, body, media (`<img>` / `MediaPlayer kind="video"`), and says so when
  no tip is published yet.
- The plugin lives with the other inner pages: `website/pages/tips`.
- **The homepage is not modified.**

## Implementation phases (each one builds and tests before the next)

1. **Foundations** — `FieldsForm` (promote `SourceConfigForm` into
   `config_v2/fields/web`, events/sources uses it); `primitives/upload-dropzone`
   (page attachment block uses it); attachments: streaming upload with a
   per-purpose cap, byte-range serve, write-under-given-id server API;
   `media/ffmpeg` `transcodeToBudget`.
2. **`fields/media`** — type, renderer, cell, sample.
3. **`site-feeds` core + box + `website/pages/tips`** — declaration, box tables,
   public read, media route, host-only routes, section.
4. **`site-feeds/editor` + host-query write** — local items, Feeds tab,
   publish job, SSH transfer.
5. **`site-feeds/syndication` + `site-feeds/discord`**.

## Verification

- Unit: `fieldsToZodObject` round-trip of `tipsFeed`; `syndicate` key typing
  (a wrong key is a tsc error); Discord request builder / response parser;
  `transcodeToBudget` on a generated clip (`ffmpeg -f lavfi testsrc`) lands
  under budget; host-only routes refuse a second hop; box upsert refuses an
  item whose attachment isn't imported (409) and a skewed shape (422).
- End-to-end on this worktree's build: a stand-in deployment of the `website`
  composition on this instance (`deploy/fixtures`, `markServerBoxIsThisInstance`):
  open the site's page in Deploy → Tips tab appears; create a tip with an image
  and a 30 s video; Publish → the section at `/about` shows it, video seeks
  (range requests); edit → updated in place; unpublish → gone.
- Discord: a throwaway webhook in a private channel (user-provided URL):
  publish a tip with a > 10 MB video → posted with the re-encoded file inline;
  edit → message updated; unpublish → deleted.
- `register_before_after` for the Tips tab and the website section.

## Out of scope

- Importing the existing Discord tips (paste them in once by hand, or a later task).
- Other targets (Bluesky, X, newsletter) — the slot is the extension point.
- Scheduling a publish for later.
