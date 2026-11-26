# Sessions on a live source, with server-side search

## Context

The Deploy app's Sessions tab handed in-memory `rows` + `paging`
(`useLivePagesPaging`) because its toolbar (summary, axis) and lanes need the
loaded rows, and a live DataView `source` gave the consumer no way to read
them. So its search ran in memory over the loaded pages only: a rare value
matched only the loaded visits, and since the next page loads only while the
read's tail is on screen and not hidden by search, the list could stop and
show a partial result as if it were everything.

## Design

1. **data-view: `loadedFrame`** (`DataViewBaseProps`, both origins). A
   component wrapped around the whole surface (band + body), handed
   `loaded: DataViewLoadedWindow<TRow>` = `{ status, rows, total }`, drawing
   its `children` unchanged. Generic: no Sessions concept. No existing seam
   did this (the controls context is the toolbar's only; view children get
   `DataViewRenderProps`).
2. **collect: a `search` filter column** (`visitSearchText`): one SQL text per
   visit — country code + English name (Intl, as a jsonb literal), source
   (referrer host+path / utm source / "Direct"), channel, device, OS,
   browser, pages. Selected on every listed visit (`ListedVisit.search`), so
   the row carries what the SQL matches — one definition.
3. **sessions**: `deploymentSessions` gains a hidden labelled `search` text
   field; the site's visits are `liveDataSource(…, { searchable: ["search"] })`
   scoped by `deploymentId`; `LaneFrame` (the `loadedFrame`) derives the
   `LaneWindowContext`; `LaneScope` carries the site + focused pages. The
   exhibit stays in memory (made-up rows carry `madeUpSearchText`), same
   frame.

## Trade-offs

- Country names are English whatever the reader's locale (the server's Intl).
- Under a search a live source reads no count: the summary says "N+" until
  the read completes.
- A rare search walks the copy further per page — the same cost as a rare
  filter (collect's window stops at the `limit`-th match).

## Verification

- collect DB test: `search contains` keeps exactly the visits whose carried
  text holds the needle; count agrees.
- On the build, equin.ai's copy: "Equatorial" finds the one visit from a week
  back (not in the loaded pages); "github.com" pages through to 268 = the DB
  count.
