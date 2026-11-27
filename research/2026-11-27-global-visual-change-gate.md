# Visual change gate: an automatic before/after of the screens a UI change reaches

Status: design only, nothing built. Asked by the user (task-1795736664-c7hfpw). The review screen is prototyped: proto-1795737056-rfijph. Numbers marked *measured* come from a trial on this checkout on 2026-11-27 (method under "Trial").

## Context

A change to a shared UI primitive moves screens in apps its author never opened. Today nobody knows which screens moved until a person notices.

The 2026-11-09 spacing work (`research/2026-11-09-global-surface-owned-inset.md`) shows the cost:

- Each slice hand-built its capture script: `inset-review.ts` (819 lines), `document-pane-review.ts` (386), `pane-header-review.ts` (297), all in `plugins/primitives/plugins/css/plugins/rail/e2e/`, with live ids hard-coded.
- Captures were polluted by live data, toasts and onboarding tips. Review round 4 existed only because of that.
- Every one of the 17 recorded incidents was a primitive meeting a host that was not in the hand-written capture list: tables inside section-card bodies, Studio's compare table header growing 28 → 44px, a 4px title jog between panes.
- The user reviewed everything by eye, 3-4 rounds per slice.

What the user wants: for any UI change, before/after pairs of the screens it can reach, made automatically. Unchanged screens need no review. Changed ones are shown, and the user accepts a diff when it is neutral or better. A shared change can be accepted for one app while another keeps its look. Debug needs no check. This is the safety net for the layout-primitive redesign (task-1795736652-ptqzei), migrated app by app.

The sibling design `research/2026-11-27-global-prototype-fidelity-eval-harness.md` measures something else (do agents implement prototypes better) and names this gate as out of its scope. What is reused from it is listed at the end.

## The design in one paragraph

A **scene** is one picture of the app that depends only on committed code and committed seed data. The scene list is build-time data: every exhibit, plus screens declared per app on seeded demo data. Every scene is drawn inside a seeded in-browser host, never on the instance's server. Each scene has a **digest** (a hash of everything that can change its picture), computed without a build, the way `push` already picks affected tests. A change **reaches** the scenes whose digest differs from the merge base. Reached scenes are captured and compared pixel-for-pixel with the capture stored for the merge-base digest. Identical ones are dropped. The rest form a **review set**, shown as one gallery grouped by app, where the user accepts each app or keeps it on its previous look. `./equin push` refuses while a reached scene differs without an accepted verdict. Main re-checks after each landing.

An independent review found four holes in the first draft (reach through slots, the exhibit's host missing from the digest, rebase-first push, captures on instance config). They are fixed below; where the fix rests on something not yet measured, the text says so and phase 1 measures it.

## What exists, and what is missing

| Need | Exists today | Missing |
|---|---|---|
| Browser, readiness, capture | `e2e-harness`: `withBrowser`, `waitForScreenReady` (painted, network idle, no `aria-busy`), `snap` with `hideToasts` | One capture mode that pins everything (below) |
| Pixel diff | `diffImages` in `e2e-harness/e2e/image-diff.ts` (ratio, per-cell grid, diff PNG) | A stored verdict; nothing drops unchanged pairs |
| Components as scenes | 80 exhibits in 33 plugins (`plugin-meta/exhibits`), a generated registry, a stage route `/debug/exhibit-stage/<id>;width=;theme=` | A "shoot them all" runner (`exhibit-shot.ts` sleeps a fixed 4 s per exhibit) |
| Screens on seeded data | One demo scenario (`website/demos/workspace`) carrying 10 apps on a seeded in-browser host (`framework/browser-server`), reachable on every deploy at `/about/demo/at/<place>`; fixture writers for pages, prototypes, sonata, places, deploy | A scene list (the nearest is `APP_DEMO_PLACES`, 8 places); seeds for the other apps; a pinned clock in the host |
| Pair viewer | `conversations/before-after`: `register_before_after`, `ba-…` ids, Swipe / Side by side / Flip viewer, images as attachments | A batch of pairs with a verdict per app; a changed-only filter; a diff overlay |
| Affected-set selection | `push`'s test gate: `testDigests` over `buildModuleGraph(...).keyOf` at HEAD and at the merge base, verdicts reused by `(file, digest)` | The same for scenes |
| Per-app look | One theme per app scope (`ui/theme-engine`, `config/ui/theme-engine/@app/<id>/theme.jsonc`), per-app variants (`ui/variant-region`) | Nothing: this is how "the other app keeps its look" is written |

`register_before_after` in its capture form cannot serve as the gate. Its "before" is main's live deploy with the user's real data, its "after" is the worktree's forked database, and it shoots one route as it loads.

## Scenes

### What a scene is

```ts
// plugins/<app>/…/scenes/index.ts — a collected dir, like exhibits/
export default defineScene({
  id: "mail/inbox",
  app: mailApp,                 // the app it is reviewed and accepted under
  place: "/mail",               // a place inside the seeded demo host
  viewports: ["desktop"],       // named sizes; default desktop 1440×900
  steps: [],                    // optional: hover / click / key, as data
});
```

A scene is fully named by `(id, viewport, colour scheme)`. Its picture may depend on four things only: the code, the seed, the committed theme and config, and the capture environment. Anything else is a defect of the scene.

**Every scene is drawn in the seeded host, exhibits included.** Today the exhibit stage (`/debug/exhibit-stage`) runs on the instance: it reads the user's config layer, saved themes and Developer mode, and the worktree's forked database. None of that is committed, so main's picture and a worktree's picture of the same code could differ. The scene page is therefore a route of a capture composition whose server is a browser host on memory storage: config is the committed layer, data is the seed, and each page load starts from the snapshot, so a step that writes cannot change the next scene. Whether all 43 app exhibits run there is not verified (the host serves a closed key set and its coverage guard fails the build on a miss); phase 1 finds out. An exhibit that cannot run there is not a scene until it can.

### Where the list comes from

Three sources, all build-time data, joined into one generated registry (`loadCollectedDir`, as exhibits are):

1. **Every exhibit, automatically.** Each exhibit × its declared widths is a scene with no new authoring. 80 today. An exhibit that declares a `home` app (about 26 do) belongs to that app and wears its theme. The others form one group, **Shared components**, drawn in the default theme and reviewed as its own group.
2. **Declared screens** (`scenes/index.ts`): a place in the seeded demo host. Six of the ten demo apps already have a staged place.
3. **Declared states**: a screen plus `steps` (open this popover, hover this row). Incidents 2, 3, 4, 6 and 8 of the spacing work were popovers and hover states that a plain route capture never shows. The step vocabulary is the one `inset-review.ts` invented (hover, click by accessible name, key), promoted to data.

A route on the instance's own data is **never** a scene. The trial shows why: 13 of 14 such captures differed between two runs of the same build, from mail arriving, a Downloads folder changing, a different random song.

### Coverage is the real cost

Exhibits are free but show components alone, and the spacing incidents were all a primitive inside a real host. So screens matter most, and they need seed data. The rule that makes this tractable:

> **An app is migrated to the new layout primitives only after its scenes exist and are baselined.** Declaring an app's scenes (and its seed, if the demo story does not carry it yet) is the first commit of that app's migration.

Coverage then grows in the order the redesign needs it. A first useful set is about 40 screens and states across the six seeded apps, written once. Apps with no seed today (Mail, Settings, Deploy, Events, Studio, Home, Chord) each need a story file through their fixture writer, or a new writer.

Scenes whose declared app is Debug (`audience: "developer"` on `defineApp`) are not in the set. This is about the scene's own app, not about where the stage happens to be mounted. Debug owns 49 of the 146 registered panes (counted from `web-list-entries.generated.json`, list `primitives.pane.register`). The gate reports them as a count, never as pictures.

The gate also lists every app the change reaches that has **no scene yet**, so "nothing changed" is never read where nothing was looked at.

## Deterministic capture

### Trial

Method: 100 scenes (80 exhibits at 960px, 6 seeded demo places, 14 app routes on live data), each captured twice on one build, in three modes, in one headless Chromium through the harness. Then `diffImages` at threshold 0.05 between the two captures of each scene. A second agent opened every differing pair and named the cause.

Pairs that differed, *measured*:

| Mode | Exhibits (80) | Demo places (6) | Live routes (14) |
|---|---|---|---|
| Naive: `waitForScreenReady`, then shoot | 12 | 6 | 13 |
| Hardened: + reduced motion, `animations: "disabled"`, toasts and tips hidden, 400 ms of DOM quiet | 9 | 5 | 5 |
| Hardened + `page.clock.setFixedTime` | 19 | 4 | 9 |

So the tools as they are today give a wrong "changed" on roughly one exhibit in nine. But every differing pair on an exhibit or a demo place had a nameable cause, and none of them was rendering noise:

| Cause | Pairs, of the 51 that differed in the hardened and clock modes together | Fix |
|---|---|---|
| The health-report pill of the global action bar floats over every scene and shows live machine state (a memory mark came and went; a pinned clock turned it orange) | 23 alone, 4 more in part | Capture mode mounts no global action bar |
| Text derived from the wall clock: fixtures anchored to "now", relative ages ("38m" → "47m") | 8 | Pin the clock. All 8 vanish in clock mode |
| The demo host had not booted: the capture is its splash, or blank | 7 | A ready signal from the host. Page network idle cannot see a worker boot |
| Content that is random by construction: Isle's walkers, Chord's song pick | 4 | Seed the randomness under capture mode, or mark the scene unstable |
| Live data inside the scene | 3 | Only on live routes, which are not scenes |
| Sub-visual antialiasing, 2 to 76 px | 4 | Unknown cause. Two are a third-party map, on a live route |
| Late icon paint; auto-hiding player controls | 2 | Wait for the icon sprite; park the pointer |

Three more findings from the same run:

- The clock pin did not reach the demo host's worker: seeded times still read the real hour. The host shifts its snapshot to "now" at boot.
- The captures themselves filed real "Slow operation detected" reports and showed their toasts.
- One exhibit (`chart-kit/time-chart`) never reaches readiness and costs 60 s per capture.
- Both captures of a pair were taken in one browser session, minutes apart. The trial did not compare two builds of the same code, which is the comparison the gate makes. Phase 1 does.

The flake rate with these causes fixed is **predicted, not measured**: by the table, 2 or 3 exhibits of 80 would still differ (Isle, the video player, one 76 px text difference). Phase 1 re-measures it and has a pass bar.

### Capture mode

One entry, `h.sceneSession()` in the harness, the only way a scene is captured (`SessionOptions.capture` already means something else). It sets:

| Source of difference | Rule |
|---|---|
| Data | Seed snapshot of the demo host; exhibit fixtures. Never the instance's rows |
| Clock | One fixed instant for `Date` in the page **and** in the host worker; the host shifts its snapshot to that instant, not to now. New host option, since `page.clock` stops at the page |
| Chrome over the scene | The scene page is its own root and mounts none of the page-scope chrome: no global action bar, no toast stack, no hint stage, no experimental-build marker. One owner (the scene root), not a flag read by four plugins. They are absent, not hidden: tips are today "answered", which is a write |
| Motion | `reducedMotion: "reduce"`, `animations: "disabled"`, caret hidden |
| Readiness | `waitForScreenReady`, then fonts ready, icon sprite present, 400 ms without DOM mutation, and for a demo place the host's own ready mark |
| Randomness | `Math.random` seeded in the page under capture mode |
| Isolation | A fresh browser context per scene: fresh host storage from the snapshot, no state from the scene before |
| Renderer | Pinned `chrome-headless-shell` (the harness's), DPR 1, GPU off, explicit colour scheme. Its revision is part of every digest |
| Telemetry | Capture runs file no slow-load or error reports |

Two captures are **the same picture** when `diffImages` at threshold 0.05 finds zero differing pixels and the sizes match. The threshold is a per-pixel colour tolerance; there is no area tolerance, since a 2px move of one row is 0.04% of a screen and is exactly what must be shown. This one test is used everywhere: to drop unchanged pairs, to look up a verdict, and in main's check. File hashes are not used: in the trial 16 hardened exhibit pairs had different bytes and only 9 a differing pixel.

A capture has three outcomes: a picture, **failed** (readiness timed out, the host's splash, an error boundary, a page error), or unstable. A failed capture is never stored and never counts as identical; it fails the run.

### Unstable scenes

A scene that cannot be made stable must not gate, and must not be silently trusted either.

- When a scene's capture is first stored for a digest, it is taken twice, the second time in a new browser context. If the two differ, the scene is **unstable**.
- A scene unstable on main is listed in a report naming the scene's plugin, and left out of the gate until its owner fixes it. It is never fixed by a tolerance.
- A scene stable at the merge base and unstable at HEAD is a change like any other: it is in the review set, marked "became unstable", and refuses the push. Otherwise a change that adds a race or an endless animation would remove its own scene from review.
- Two captures can agree by luck. Main's repeated captures of an unchanged digest are the longer check: a stored digest that later captures differently is reported as unstable.

### Cost

*Measured* on a loaded host (other agents building), sequential, one page:

- An exhibit: median 3.3 s naive, 5.0 s hardened. A demo place: 5.3 s and 6.3 s. With an idle host and a fresh page a route takes about 2 s.
- One renderer reused for 200-600 captures grew to 3-4.5 GB. A fresh context per scene (above) bounds that. Its cost in time is not measured: in the trial the seeded host booted once per session, and a boot per scene will add to the 6.3 s.
- 80 exhibits, hardened, once: 7.0 min and 8.3 min in the two rounds, each including one 64 s stall.

Expected cost of a run, **estimated** at 5 s per capture and a second capture for a new digest's stability check:

| Run | Scenes | Time, sequential | With 3 pages in parallel |
|---|---|---|---|
| A change that reaches few scenes (how common this is, is not measured: see reach below) | 5-20 | 1-3 min | under 1 min |
| A full run today (80 exhibits + 6 places) | 86 | 7 min, 14 min with the stability pass | 3-5 min |
| A full run at the target set (80 exhibits + ~120 screens and states, light only) | 200 | 17 min, 34 min with the stability pass | 6-12 min |

Parallel pages are not measured. A run takes one host `e2e` slot (there are two) and needs a memory reservation, which e2e runs lack today: the trial's renderers were flagged by the performance supervisor during a memory-pressure episode.

## Which scenes a change reaches

### The digest

`sceneDigest = recordKey(npm resolutions, captureKey, cssKey, themeKey, seedKey, codeKey)`

| Part | What it is | Source |
|---|---|---|
| `codeKey` | Merkle key of everything that draws the picture: the scene page and its root, the scene's entry (the exhibit's module, or the app's shell), and the app's contributors (below) | `buildModuleGraph(...).keyOf`, the call `testDigests` makes |
| `cssKey` | Every stylesheet that is global once loaded: `ui-kit/web/theme/app.css`, its imports, and every plugin `.css` file | Blob ids |
| `themeKey` | `config/**/@app/<app>/**`, the selected theme's module key, the token-group plugins' keys | Blob ids and `keyOf` |
| `seedKey` | The host snapshot's content address: seed code, the server code the host runs, migrations, config, data files | Already computed by the build (`host-snapshots.ts`) |
| `captureKey` | Chromium revision, composition id, viewport, scheme, and the Merkle key of the runner and scene-root modules | `keyOf`, constants |

No hand-bumped version: a change to how scenes are captured changes `captureKey` through the module keys, and reaches every scene.

**Contributors.** A pane imports the slot's owner, never the plugins that contribute into it, so import reach alone misses a contributed toolbar item. The catalog supplies the edge (`web-list-entries.generated.json` × `web-lists.generated.ts`). Joined naively it is useless: `primitives.pane.register` alone has 104 contributing plugins, and every scene has `primitives/pane` in its closure. So the join is scoped:

- A pane contribution counts only for scenes of that pane's app.
- A contribution to a page-root list counts for no scene: the scene root mounts none of them.
- Any other contribution counts for a scene when its list's owner is in the scene's closure; repeated until nothing is added.

A change reaches a scene when its digest at HEAD differs from its digest at `commitSnapshot(mergeBase)`. This is `affectedTests` with scenes for files. It needs no build, provided the tree's generated catalog files are current (the `list-catalog-in-sync` check holds them so).

**Reach must over-approximate; how selective it is, is unknown.** A missed scene is a silent miss, because the store would serve its old picture. So every rule above errs toward reaching more. How many scenes a typical change then reaches was not measured, and with most modules loaded at boot it may be "nearly all" for many changes. Phase 1 measures it: scene digests over the last 100 commits on main, reported as the distribution of scenes reached per commit. If reach turns out to be nearly everything, the gate still works. Reach only saves capture time; pixels decide what is reviewed. The cost is then a full run per change.

Web-artifact hashes are not used for this. An artifact's address covers its own files only, by design, so a changed primitive re-addresses one artifact and none of its consumers. The link groups do not localize either: 5,783 of main's 7,590 linked modules are in the `boot` group (`modules.json` of the link record).

### What a global change costs

An edit to `app.css`, to any plugin stylesheet or to a token default changes `cssKey` or `themeKey` for every scene: a full run. That is correct, since such an edit can move anything, and it is what the table above prices. Most of those captures come back identical and are dropped. A full run for a one-token edit is the price of not guessing.

The digest is conservative in the other direction too: a reached scene usually captures identical. Reach decides what to **capture**; pixels decide what to **review**.

### Blind spots, stated

- `import.meta.glob` and computed imports (the test gate has the same ones).
- Whether the module graph keys `.css` and asset imports is not verified; `cssKey` lists stylesheets by path so it does not depend on it. Tailwind's output also depends on every class name under `plugins/`; a class is in a module, so its module key covers it.
- A token consumed through a CSS variable has no import edge. Covered by `themeKey` including every token-group plugin, at the cost of reaching all scenes.
- User-layer config and saved themes do not exist in the seeded host, so a bug that only shows with a user's own theme is not seen.
- A root-level effect of a boot plugin that reaches into a scene without an import or a contribution.

## Before, after, and the store

Captures live in a content-keyed cache, `~/.equin/cache/scene-captures/<scene>/<digest>.png` (a `defineDataDir`, kind `cache`), shared by every checkout like test verdicts.

- **After** = the capture at the HEAD digest, taken from this checkout's build. The runner refuses unless the served build was made from the tree it digests (the build's recorded commit and a clean tree), so a picture is never stored under a digest it was not built from.
- **Before** = the capture at the merge-base digest, taken by main (below).

**When the before is missing.** Main builds only the commits it lands on, coalesced, so a merge base in between has no capture. Taking it would need a full build of the merge base, served, plus a capture run: tens of minutes, not the test gate's 1.5. So `./equin scenes` does not do that. It names the newest commit of main that has a full capture and asks for a rebase onto it, which agents do routinely. Captures are kept 14 days, and main's job always holds its latest full set.

There is no separate "approved baseline" directory and nothing in git. The baseline is what main renders. Approval is what lets a change become main. Golden images in the repo were refused once already (`research/2026-06-19-global-layout-primitive-geometry-harness.md`: they flake across OS and font stacks); captures here are compared only between runs of the same pinned renderer on the same host.

That main's build and a worktree's build of the same code give the same picture is the assumption everything rests on, and the trial did not test it. Phase 1 does: a worktree with no change, built and captured, against main's set.

Review sets are different: they are what the user saw and decided, so their before, after and diff images are attachments (as `before_after_pairs` are), kept after the cache is reaped.

## Review and approval

### The review set

`./equin scenes` produces a review set `vr-…` for the checkout's current tree: the reached scenes whose after differs from their before, each with both images, the diff image and the differing ratio. The agent cites the `vr-…` chip in its message, as it cites `ba-…` today. The set is attached to the conversation and listed in its Artifacts.

Prototype of the gallery: proto-1795737056-rfijph. One screen, changed scenes only, grouped by app. The header counts what was reached, what was identical, what is left, and how many Debug scenes were not checked. Identical scenes are one line at the bottom.

### Verdicts

Per app (or per scene, see the open decisions): **Accept**, **Keep previous look**, or **Regression**.

A verdict is a row on a pair of stored images (scene, before, after). It applies to any later pair whose before and after are each the same picture (the test above) as the ones it was given on. So it survives a rebuild that leaves both pictures the same, and lapses the moment either changes.

- **Accept**: the after becomes what main will render.
- **Regression**: the change is wrong here. The agent fixes it; the next run shows the scene again or drops it as identical.
- **Keep previous look**: the change stays, but not for this app.

Verdicts reach the agent as a message in its conversation, so it acts on Regression and Keep without the user typing anything.

### "Accept for one app, the other keeps its look"

The gate holds no code, so "keep" cannot be a flag in the gate. It is an instruction to make the difference per-app **in the code**, in one of three existing ways, and the gate then proves it:

| The change is | The other app keeps its look by | Where it is written |
|---|---|---|
| A value (a gap, a height, a radius) | The value is a token; that app's theme keeps the old value | The app's `defineTheme` fragment |
| A structure (a different arrangement) | A variant region with the old arrangement as a variant; that app's config pins it | `config/<region>/@app/<id>/….jsonc` |
| A migration to new layout primitives | That app is not migrated yet: it still imports the old ones | Nothing to write |
| None of these: a change inside a primitive that is neither a token nor a region | The primitive gains a parameter (a token, or a prop) whose old value that app passes, with a task to remove it. If that is not reasonable, the agent says Keep is not feasible and the user chooses between Accept and Regression | The primitive, and the app |

`ui/variant-region` today serves four chrome regions (rail framing, sidebar framing, tree disclosure, breadcrumb separator). It is the right tool for an arrangement that is already a region, not for an arbitrary change inside `Row`. The layout redesign's own answer is the third row.

Keep does not apply to the Shared components group (a component alone has no app), and cannot be proven for an app with no scenes.

After the agent adds the pin and rebuilds, that app's scenes capture identical to their before and leave the review set by themselves. **The proof that an app kept its look is that it shows zero changed scenes**, not a recorded exception.

Each pin is a fork of the look. It is committed and reviewable. A pin meant to be temporary carries a task.

### What push does

`./equin push` rebases onto main before any gate runs, so the tree it would land was never built or captured. Requiring captures of that tree would force a rebuild, a recapture and a re-approval each time main moved, while main moves again. So the push gate checks **what the user saw**, and main checks **what landed**:

- `./equin scenes` records, with the review set, the commit it captured.
- Push, before its rebase, finds the review set for the commit being pushed. It refuses when there is none and the change reaches a stable, non-Debug scene ("run `./equin scenes`"), and when a changed scene in the set lacks an **Accept**.
- A change that reaches no scene costs the digest step only.
- What the rebase adds (main moved the same scene) is caught after landing, below.

Guard note: the gate is a rung-3 guard. `No flaw:` whether a moved pixel is an improvement is a human judgement no API can express.

### What main does

After main's build, a job captures the scenes whose digest has no stored capture, twice (the stability check). It runs one at a time and only for main's latest build: a commit that landed while it ran is skipped, not queued. At 14-34 min sequential for a full run, holding one of the host's two `e2e` slots, it cannot follow every landing, and need not.

For each scene whose picture changed since main's previous capture, the job looks for an Accept whose after is the same picture. If there is none (two pushes moved the same scene, a `--from-main` push, an upstream merge, a seed refresh), it files one report with a review set. This is the same review, after landing instead of before. It is the net under every path the push gate does not see, the rebase included.

## When it runs

| Where | What | Why |
|---|---|---|
| `./equin build` | Prints the reached count: "UI: 14 scenes reached in 3 apps. `./equin scenes` to review." Captures nothing | The digest step is cheap. A capture run is 1-30 min; a worktree build is 34 s at the median, and most builds are intermediate |
| `./equin scenes` (on demand) | Captures the reached set from this checkout's build, diffs, writes the review set. Foreground, exit 70 with an `await` op when long | The agent runs it when the change is ready to show, then asks for approval with the `vr-…` chip |
| `./equin push` | The gate: a lookup of the review set for the pushed commit. It captures nothing | A capture needs a served build, which push does not have after its rebase |
| Main, after its build | Captures new digests; reports unreviewed changes | Keeps every "before" present |

## The first baseline

Nothing is approved to start. When the gate lands, main's job captures every scene at main's commit, twice each. That set is "the look on that date": the user reviews none of it. Scenes that differ between their two captures start as unstable and are listed in one report to fix.

From then on every diff is relative. A scene added later has no before: it appears in the review set as **New**, shown once and accepted like a change.

Rollout order:

1. **The scene page in the seeded host, capture mode and the runner, exhibits only, no gate.** `./equin scenes` over the exhibits. It replaces the hand-built review scripts at once. Four things are measured before going further:
   - Which exhibits run in the seeded host.
   - A/A: every scene captured twice shows no more than 2 unstable of 80, each with a named cause and an owner. If it fails, the capture mode is wrong, not the bar.
   - Two builds: a worktree with no change against main's set, zero changed scenes.
   - Reach: the distribution of scenes reached per commit over main's last 100 commits, and the time of the digest step.
2. **Review set, gallery, verdicts.** Still no refusal in push.
3. **Screens**: the `scenes/` collected dir and steps. Scenes for the first app the redesign migrates, then one app per migration.
4. **Main's baseline job, then the push gate**, turned on once main has held a full stable baseline for a week.

## Where it lives

- `plugins/plugin-meta/plugins/scenes/`: `defineScene`, the collected dir and its registry, the digest, the capture runner (`e2e/`), the store's data dir, the `scenes` CLI command. Beside `exhibits`, which it reads.
- `plugins/review/plugins/visual-changes/`: the `vr-…` id kind, the review-set and verdict tables, the gallery pane. It reuses `PairViewer` from `conversations/before-after` and `Attachments.defineLink`.
- `plugins/framework/plugins/tooling/plugins/e2e-harness/`: `h.sceneSession()`. `exhibit-shot.ts` becomes a call of the runner for the ids it is given; `screenshot.ts` stays the free-form tool it is.
- `plugins/framework/plugins/cli/plugins/push/plugins/scene-gate/`: beside `test-gate`, same shape.
- `plugins/framework/plugins/browser-server/` (`host-storage`): the fixed-instant option for the snapshot shift and the worker clock.
- A capture composition (the scene page, its root, the seeded host), under `plugins/plugin-meta/plugins/scenes/`.

## Reused from the fidelity-eval design

- Render from fixtures and seeds only; no server data in a picture.
- Its scorer runs from a pinned checkout, never from the tree under review, so a change cannot alter how it is judged. This gate cannot do that: the scene root and the runner are part of the tree. The mitigation is that their module keys are in every digest, so a change to them reaches every scene and is itself reviewed.
- Do not trust a recorded result unless its key matches exactly: the digest is that key.
- Measure the noise before trusting the instrument (its pilot 1 is A against A). Here: phase 1's pass bar, and the two-capture stability check on every new digest.
- A control with a known sign: the harness self-check below.
- Images as attachments, runs in the Runs list, the before/after viewer.

Not reused: its score. It compares an implementation to a mock, two renderings that are never pixel-equal. This gate compares the same scene before and after one change, where pixel equality is the expected result and the whole point.

## Verification, once built

- **A/A**: `./equin scenes --all` twice on one build reports zero changed scenes outside the unstable list.
- **Known change**: a branch that adds 2px to `Row`'s gap reaches every scene that draws a `Row`, and the review set shows exactly those as changed. Scenes reached without a `Row` capture the same picture and are dropped.
- **Global change**: a one-token edit reaches all scenes and the run completes inside the table's bound.
- **Debug**: a change to a plugin that only contributes a Debug pane reaches zero scenes; a review set never holds a Debug scene.
- **Keep**: a second app pinned to the old token value shows zero changed scenes while the first shows its change.
- **Gate**: push refuses with an unreviewed changed scene, passes after Accept, and refuses again after a further edit moves the same scene.
- **Unstable**: a branch that adds an endless animation to a scene is refused, with the scene shown as "became unstable".
- **Rebase**: two branches that each move the same scene and are each accepted land; main's job reports the scene once, with the combined picture.
- **Replay**: the 17 incidents listed in `research/2026-11-09-global-surface-owned-inset.md` (its lines 297-464) are the acceptance list for scene coverage. Each must have a declared scene that would have shown it; that table is the first deliverable of phase 3.

## Open decisions

Visual ones are options of proto-1795737056-rfijph.

1. **How a pair is read** (`compare`): side by side, swipe, or the after with changed pixels in red. Recommended: overlay as the default in the gallery, since a 2px move is invisible side by side, with the full viewer one click away.
2. **Where the verdict sits** (`verdict`): one per app, or one per scene. Recommended: per app, with per-scene Regression still possible, since the question asked is "is this change good for Mail".
3. **Gallery density** (`layout`): one pair per row, or a grid of thumbnails. Recommended: grid with overlay; list with side by side.
4. **Does push refuse, or only warn?** Recommended: refuse, from phase 4. A warning repeats today's failure.
5. **Agents with no user watching** (automations, sidequests): refuse and raise a flag with the `vr-…` set, or land and rely on main's post-landing report? Recommended: by reach, not by path. Refuse when the changed scenes span more than one app, land-and-report when they stay inside one.
6. **Dark mode and phone widths**: every scene in both schemes doubles the cost. Recommended: light at desktop for all; dark and phone only where a scene declares them.
7. **Who writes the seeds** for the seven apps without one: the agent migrating that app, as its first commit (recommended), or one up-front task for all seven.
8. **Exhibits under every app theme, or under their home theme only?** A primitive's exhibit under 17 app themes is 17 scenes. Recommended: home theme only; per-app looks are covered by that app's screens.
9. **A missing before**: ask for a rebase onto main's newest captured commit (recommended), or pay a full build of the merge base to stay on the current base.
