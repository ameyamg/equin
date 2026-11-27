# tips

Tips of the day on equin.ai — the ONLY code that knows what a tip is. The
machinery is generic: [`apps/deploy/site-feeds`](../../../../../deploy/plugins/site-feeds/CLAUDE.md).

- `core` — `tipsFeed`: a title (`textField`), the text (`formattedTextField`:
  `**bold**` for a button's name, `<kbd>⌘</kbd>` key caps, links, line breaks —
  [`fields/formatted-text`](../../../../../../../fields/plugins/formatted-text/CLAUDE.md))
  and up to 10 screenshots and videos (`mediaField`, `image/*` + `video/*`,
  500 MB a file); syndicated as title + text with the media as files; the
  newest 60 are public; `pagePath: "/tips"` on a deployed site,
  `localPagePath: tipsPage.path` on this instance's own copy. And `tipsPage`
  (`/about/tips`, `equin.ai/tips`).
- `server` — `SiteFeeds.Feed({ feed: tipsFeed })` to the box's registry, which
  validates every published tip against it, and the page's sitemap entry
  (`WebsitePages.Page`).
- `web` — the same declaration to the editor's slot, the `/about/tips` pane
  (built like `pages/story`: `actions: WebsiteHeader`, a `websitePagePart`
  body) and its `Website.LearnEntry` "Tips", after Story
  (`config/apps/website/shell/learn-entry.jsonc`). The page: the
  `WebsiteHero`, then one card per tip, newest first (`TipCard`) — its date,
  title, text (`FormattedTextView`), then each image (`<img>`, its pixel size reserved when
  known) and video (`MediaPlayer`, `autoPlay="in-view"` + `silent`: looping while on screen, always muted, no volume controls), loaded from the
  box's public media route. Loading and a failed read are shown; no tip
  published → a line saying so. **The homepage is not touched.**
- `TipPreview` (lazy, `web/internal/tip-preview.ts`) — the same card for the
  editor's review of a proposed tip, contributed as `SiteFeeds.Feed`'s
  `preview`, its files read from the instance's attachments.
- `TipCard({ values, publishedAt, mediaAsset, ref?, onMediaOpen? })` (exported) — one tip as the page
  draws it, presentation only: the page wraps it with its analytics
  (`tip_seen` on the card's ref, `tip_media_open` on a screenshot opened), so
  any other surface showing a tip as it will read (a proposed edit's
  before/after) draws the same card without measuring anything.

Tests: `core/internal/tips-feed.test.ts`, `web/__tests__/pane-route.test.ts`.
End to end: `apps/deploy/site-feeds/editor`'s `e2e/publish-roundtrip.ts`
(written on the Deploy app's Feeds page, shown on this instance's
`/about/tips`).

## Tip videos (`e2e/`)

Each tip's video is recorded from a script checked in here,
`e2e/<slug>.ts`, one per tip (`e2e/pick-inside-sub-menu.ts` is the worked
example). `e2e/internal/tip-video.ts` (`tipVideo`) does the rest: one take of
the real app, recorded frame-exact by media/film's recorder (virtual clock,
eased hand, 60 fps, 1280×720 CSS px at 3× so a 2× push-in stays sharp),
rendered at 1920×1080 60 fps with the pointer drawn, a key cap beside it while
a click holds a modifier, the camera's push-ins, and a fade from and to black
(the page loops the video). Every render is a new version in
`~/Downloads/tips/`: `<slug>-v<N>.mp4` and `<slug>-v<N>-web.mp4` — **the
`-web.mp4` is the file a tip carries** (H.264, ≤2.5 Mbit/s, faststart; muted
on the page anyway).

**Never the user's records.** A tip is recorded on this checkout's
`promo-film` composition: the whole app on its own database, holding the
promo film's made-up story (pages, agent runs, places — no personal name),
pinned to the seed's weekday afternoon.

Steps:

1. Build and seed the demo instance (once per checkout; seed again to reset it
   — a take that changes data leaves it changed):
   ```bash
   ./equin build --composition promo-film
   ./equin promo-film seed
   ```
2. Look at the screen you will film first (the `browser_*` MCP tools on
   `http://promo-film.<checkout>.localhost:<port>/…` at 1280×720, dark), and
   find stable locators (see below), never coordinates.
3. Write `e2e/<slug>.ts`: an `E2eScript` declaration
   (`target: { composition: "promo-film" }`, `kind: "tool"`, `writes: false` —
   `true` if the take saves anything, e.g. launches the Wish — `run: {
   manual: ["heavy"], … }`) and one `await tipVideo({ slug, path, prepare?, cursor?,
   script })`. `path` is the route opened (booted in real time, unrecorded);
   `prepare(page)` waits for what the first gesture needs; `script(r)` is the
   take. `r` is media/film's `Recorder` (`move`, `click` — with
   `{ modifiers: ["ControlOrMeta"] }` for a ⌘/Ctrl-click, drawn as a ⌘ key
   cap — `type`, `press`, `drag`, `scrollTo`, `hold`; see
   `media/film/CLAUDE.md`, The recorder) plus the camera:
   - `r.focus(targets, { margin?, maxZoom?, duration? })` pushes in, from now,
     on the union of the targets' boxes (a Locator is read where it will be
     once running animations end, so a menu still opening frames right; a
     `Rect` is taken as is), default 32 px margin, at most 2×. From a framing
     already in, it pans onto the new one.
   - `r.unfocus()` pulls back to the whole screen.
   - A camera move takes 0.9 s (out: 0.7 s; `duration` overrides it, in
     film time) and the script runs on while it plays. Two camera moves may
     not overlap (it throws): `r.hold` in between. A focus target not on the
     page yet (a popover the last click opens) is waited for, frame by frame.
   - Locate by roles, labels and `aria-*`: `data-slot` can change under a
     tooltip (the model pill is `[aria-haspopup="menu"]` with text "Opus").
   The kit adds 0.6 s still before the script and 0.9 s after it (and waits
   for the last camera move), under the fades.
4. Pacing: a fluent user's. `r.click(target)` is the whole gesture (the
   hand travels and presses on arrival): never `move` + `hold` + `click`.
   Go straight to what the hand acts on — never `move` onto something it
   does not click on the way (a row before its Edit button: the button is
   reachable directly, hovering it hovers the row). A `hold` comes only
   after a result appears, just long enough to read it. Zoom on what the
   tip is about while it happens, and pull back once the result is worth
   seeing whole. Aim for 8–15 s.
5. Record and review a preview (640×360) and stills, then the full render:
   ```bash
   T=plugins/apps/plugins/website/plugins/pages/plugins/tips/e2e/<slug>.ts
   ./equin run $T --composition promo-film --rec-dir "$EQUIN_SCRATCH/tip-<slug>" --preview
   ./equin run $T --composition promo-film --rec-dir "$EQUIN_SCRATCH/tip-<slug>" --render-only --stills 1,3,5
   ./equin run $T --composition promo-film --rec-dir "$EQUIN_SCRATCH/tip-<slug>" --render-only
   ```
   Recording costs ~0.25 s of real time per frame (a 10 s take: ~3 min);
   `--render-only` re-renders the take in `--rec-dir` without recording
   (camera timings live in the take's `<slug>.camera.json`, so changing a
   `focus` means recording again). A take is never recorded over another: a
   new `--rec-dir` per take. A preview takes no version number. Look at
   the stills (Read the PNGs) before the full render.
6. Report the `-web.mp4` path; the tip itself is edited on Deploy → Feeds.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: The tips page of the equin website: the tips feed declared to the editor (SiteFeeds.Feed), the /about/tips pane showing the published tips newest first — title, text, then each screenshot and video — its entry in the header's Learn menu, and the tips' mark (TipsBulb: a lit lightbulb in the site's one warm light, declared once here), which the page's heading and the Download page's Learn the tricks card wear. Declares the tips feed to the box (SiteFeeds.Feed), which validates every published tip against it and serves the newest 60 to visitors, and the tips page's sitemap entry (WebsitePages.Page).
- Web:
  - Contributes:
    - `SiteFeeds.Feed` "tips"
    - `Pane.Register` "website-tips"
    - `Website.LearnEntry` "Tips" → `TipsNavItem`
  - Uses: 31 symbols — full list in [REFERENCE.md](./REFERENCE.md)
    - `apps/website/shell` ×7
    - `apps/deploy/site-feeds/box` ×4
    - `primitives/pane` ×3
    - `apps/deploy/analytics/collect` ×2
    - `primitives/overlay/image-viewer` ×2
    - `fields/date/format.useDateFormatter`
    - `fields/formatted-text.FormattedTextView`
    - `infra/endpoints.useAssetSrc`
    - `media/player.MediaPlayer`
    - `network/live/live-state.ResourceErrorInline`
    - `primitives/css/card.Card`
    - `primitives/css/center.Center`
    - `primitives/css/spacing.Stack`
    - `primitives/css/text.Text`
    - `primitives/css/ui-kit.cn`
    - `primitives/lazy-component.lazyComponent`
    - `primitives/loading.Loading`
    - `ui/icons.Icon`
  - Exports (values):
    - `TipCard`
    - `TipsBulb`
    - `tipsPane`
- Server:
  - Contributes:
    - `site-feeds.feed` "tips"
    - `apps.website.crawlable.page` "/about/tips"
  - Uses:
    - `apps/deploy/site-feeds/box.SiteFeeds`
    - `apps/website/crawlable.WebsitePages`
- Core:
  - Uses:
    - `apps/deploy/site-feeds.defineSiteFeed`
    - `apps/website/crawlable.defineWebsitePage`
    - `fields/formatted-text/config.formattedTextField`
    - `fields/media.mediaField`
    - `fields/text/config.textField`
  - Exports (types): `TipsFeed`
  - Exports (values):
    - `tipsFeed`
    - `tipsPage`
- Cross-plugin:
  - Uses tokens:
    - `ui/tokens/color-palette --border`
    - `ui/tokens/color-palette --ring`
    - `ui/tokens/shape --radius`
  - Imported by: `apps/website/pages/download`

<!-- AUTOGENERATED:END -->
