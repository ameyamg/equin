# Self-contained panes: complete state, URLs shortened only where position implies it

## Context

A Miller column could not be reordered, shown alone, or sit beside a second
instance of its "parent" without breaking or silently showing the wrong data,
because several panes read their subject from the column to their LEFT instead
of their own params:

- the Files preview named its file relative to the folder column
  (`preview/CLAUDE.md`) — "This link doesn't say which folder…" once dragged
  left (fixed since by a full path, but it still declares `parent: folderRoute`,
  which made a push from a second folder rebuild the route);
- ~10 conversation satellites (summary, review, commits, files, push
  profiling, shell output, sub-agent report, workflow node, file peek, the
  plugin-link chip) read `conversationPane.useEnclosing()?.params.convId`:
  dragged right of another conversation they show THAT conversation's data.

Decision (user): every pane carries its whole address; the URL stays short by
omitting a param only where the column's position implies it, written and read
by one symmetric rule in the pane primitive; `useEnclosing` goes; Files'
preview drops its parent. Also (same class, report-1795482864-g2gufb): a saved
tab or history entry written by an older build can name a pane that is gone or
lack a param the pane now requires — restore must validate, not trust.

## Design

### 1. Pane primitive — implied params (`plugins/primitives/plugins/pane`)

- `Pane.define({ …, implied: { <param>: impliedBy(fromRoute, codec) } })`.
  The param is one of the pane's OWN segment params (positional or keyed
  `;conv`). `fromRoute` names the pane whose nearest column to the LEFT implies
  it. Codec (pure, over strings):
  - `shorten(value, fromParams) → string | undefined` — the URL spelling;
    `undefined` = omit (keyed/optional params only).
  - `expand(written | undefined, fromParams | undefined) → string | undefined`.
  - Helpers: `sameAs("convId")` (omit when equal, fill from it) and
    `relativeTo("dir", { join, within })` (Files: relative path when inside).
- STATE IS ALWAYS COMPLETE: slots, `history.state`, persisted tabs keep the
  full value (already verbatim — `commitRoute`, `tabs-store.ts`). Panes read
  only their own params. Typed params: an implied keyed param is REQUIRED in
  `useParams()`/opens unless declared `optional: true` (file-peek).
- Writer: `buildRouteUrl` (`web/pane.ts:808`) — per slot, before
  `fillSegment`, find the nearest earlier slot of `from`; spell via `shorten`,
  then ASSERT `expand(spelled, from) === value` (loud runtime failure — a wrong
  codec can never write a URL that reads back differently). No `from` to the
  left → full spelling.
- Reader: `parseUrl` (`web/pane.ts:671`, `parseChain`) — fill/expand implied
  params from the nearest earlier chain entry of `from` (thread the
  chain-so-far through `parseFrom` so a candidate whose required implied param
  cannot be filled fails and backtracking tries the next). Embed-tail head path
  too.
- Round-trip invariant tested: `parseUrl(buildRouteUrl(r)) ≡ r` across
  reorders, duplicates, alone, outside-the-folder.
- `useEnclosing` REMOVED (type, impl, test, CLAUDE.md). `useOpenedHere` stays
  (it is an opener asking what it opened, not a pane reading its context).
- Multi-column open: `openPane.columns([{ pane, params }, …], opts)` →
  `LinkTarget` (open/href, `replace`, `inPlace`, cross-app handoff via
  `strandedOpenUrl`/`navigateApp` exactly as `to()`); modes: `root` (the route
  IS the list) and `swap` (the caller's column and everything right of it
  become the list). Implemented as a `computeOpen` variant
  (`web/pane.ts` ~2392) so `href` and `open` share it.
- Remove the special swap branch added for Files ("target chained under the
  caller's pane", in `computeModeOpen`) — `columns` replaces it. Keep
  `prefixHosts` nearest-ancestor (`findLast`) fix.
- Restore validation (one function, `validRestoredRoute(slots)`, exported): a
  slot is valid when its pane is registered and every required param of its
  segment (implied ones included) is present. Used by `handleLocationChange`
  for `history.state.route` (invalid → re-parse the URL instead) and by tabs.
- Docs: pane `CLAUDE.md` (implied params section; "a pane reads only its own
  params"; remove useEnclosing; `columns`; restore validation). Regenerate
  identity snapshot.

### 2. Conversation satellites (`plugins/conversations/…`, `plugins/review`, `plugins/active-data/plugins/plugin-link`)

- Each satellite segment gains `;conv` with `implied: { conv: impliedBy(conversationRoute, sameAs("convId")) }`;
  body and title hooks read `pane.useParams().conv`. file-peek: `optional`.
  Panes: conv-summary, conv-review, conv-commits-graph, conv-file-tree,
  conv-push-profiling, shell-output, agent-report, workflow-node, file-peek.
- Every opener passes `conv` (tsc enforces): the four toggles
  (summarize/review/conv-tree/push-profiling buttons, commits chip) take it from
  the conversation they act on; transcript tool views (bash, agent,
  send-message, workflow, running-agents band, claim hooks) from the
  conversation the transcript renders (existing conversation context/props);
  self-swaps from their own params.
- plugin-link chip: decide side-pane vs plugin-view from an existing
  "rendered in a conversation transcript" context, not the route.
- URLs: `/agents/c/conv-A/summary` unchanged; `…/c/conv-B/summary;conv=conv-A`
  when ambiguous; `/agents/summary;conv=conv-A` alone. Update e2e URLs only
  where they break (rail reviews, morph, git-verify).

### 3. Files (`plugins/apps/plugins/file-explorer`) + tabs (`plugins/apps-core/plugins/tabs`)

- `filesPreviewPane`: drop `parent`; `implied: { path: impliedBy(folderRoute, relativeTo("dir")) }`
  and `fs` `sameAs("fs")`. URL: `/files/browse/~%2Fp/preview/README.md`
  again; full path only when not inside the folder to its left.
- `locationTarget` folder+file → `openPane.columns([folder, preview], …)`;
  folder column `go` → `columns(…, { mode: "swap", inPlace: true })`;
  `openTarget` stays a plain push (now identical to any app: truncate right of
  the caller, append; ⌥ inserts).
- Tabs: `rebuildBackgroundTab` / focused restore use `validRestoredRoute`;
  invalid → `seedPending(rawPath)` (re-parse — an old short URL re-reads
  through the implied fill). Slots naming a not-yet-registered pane: re-checked
  once deferred loading settles (`useDeferredLoadComplete`, as at
  `use-tabs.tsx:1553`). `--fixes-report report-1795482864-g2gufb`.

## Execution (Opus agents)

1. Agent A — pane primitive (§1) with tests. Blocks the rest.
2. Then in parallel: Agent B — satellites (§2); Agent C — Files + tabs (§3).
3. Me: review diffs against the merge-base, `./equin build`, browser checks,
   push.

## Verification

- `./equin test plugins/primitives/plugins/pane plugins/layouts plugins/apps/plugins/file-explorer plugins/apps-core/plugins/tabs plugins/conversations plugins/review plugins/active-data`.
- `./equin check` (type-check, identity manifest regenerated, docs in sync).
- Browser on the build: Files (folder+file short URL; preview left of folder;
  preview alone; two pairs, open a file / move the second folder); agent
  manager (conversation + summary short URL; summary of A dragged right of B
  keeps A and writes `;conv=`; summary alone; reload each URL; Back/Forward).
- A tab saved with an old slot (`files-preview`, satellite without `conv`)
  restores from its URL instead of throwing.
