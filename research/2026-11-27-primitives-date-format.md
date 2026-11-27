# Date & time format: three settings, one formatter

## Context

The Mail list showed "11:17 PM" to a user who wants 24-hour time. Nothing in the app owns
date/time display. About 55 call sites each call `toLocaleTimeString` /
`toLocaleDateString` / `Date#toLocaleString` / `Intl.DateTimeFormat` themselves, with
`undefined` (the browser's locale, en-US here), a hard-coded `"en-US"` or `"en-GB"`, or
their own `hour12: false`. So the clock and date order change from surface to surface, and
no setting can reach them all.

Outcome: three settings in Settings → Config, and every date/time the app displays goes
through one formatter that reads them. A lint rule keeps new code from formatting a date
any other way.

| Setting | Options | Default | User's config |
|---|---|---|---|
| **Clock** | Browser / 12-hour / 24-hour | Browser | 24-hour |
| **Date order** (dates with a month name: "Nov 27, 2026" vs "27 Nov 2026") | Browser / Month first (MDY) / Day first (DMY) | Browser | Month first |
| **Numeric dates** (all-digit dates: 11/27/2026, 27/11/2026, 2026-11-27) | Year first (ISO, YMD) / Browser / Month first / Day first | Year first | Year first |

## Design

### New plugin `plugins/primitives/plugins/date-format`

**core/** (importable everywhere: web, server, machine, core):
- `dateFormatConfig = defineConfig({ fields: { clock, dateOrder, numericDate } })`, three
  `enumField`s (same shape as theme-engine's `colorMode`, `plugins/ui/plugins/theme-engine/core/config.ts`).
  Labels sit under one "Date & time" group.
- `DateFormatPrefs` is the parsed, narrowed value. The enum read-back is a plain string, so
  `prefsOf(values)` parses it with zod and fails loudly on an unknown value.
- `createDateFormatter(prefs): DateFormatter`, a plain object with:
  - `time(d, { seconds?, timeZone? })`: "23:17" or "11:17 PM".
  - `date(d, { weekday?: "short"|"long", month?: "short"|"long", year?: "auto"|"always"|"never", timeZone? })`:
    a date with a month name, ordered by `dateOrder`. `"auto"` adds the year when it isn't the current one.
  - `dateTime(d, opts)`: date + time joined the way the locale joins them.
  - `numeric(d, { time?: boolean, seconds?, timeZone? })`: all-digit date ("2026-11-27",
    optionally "2026-11-27 23:17").
  - `parts`-free. Callers never see a locale or an hour cycle.
- The mapping happens in one place: `dateOrder` gives the locale (`undefined` / `en-US` /
  `en-GB`), `clock` gives `hourCycle` (`undefined` / `h12` / `h23`). Numeric YMD is built from
  `formatToParts` (zero-padded `yyyy-mm-dd`). Numeric MDY/DMY/Browser use Intl `2-digit`
  numeric in the matching locale.
- The options type has **no** `locale`, `hour12` or `hourCycle` field. A caller can't ask for a
  different clock, which is the rung-1 part of the fix.

**web/**: registers the config (`ConfigV2.WebRegister`) and exports
`useDateFormatter(): DateFormatter`. It is `createDateFormatter(prefsOf(useConfig(dateFormatConfig)))`,
memoised on the prefs. The config rides the boot snapshot (`configValues` is `boot-and-keep`),
so the first paint already has the user's prefs, and a settings change re-renders every user.

**server/**: registers the config (`ConfigV2.Register`) and exports `serverDateFormatter()`,
built from `getConfig(dateFormatConfig)`.

**No module-level store.** A global getter would not re-render on change, and it would be
wrong before Core.Root runs. Pure `core/` functions take the `DateFormatter` as a parameter
instead (e.g. Mail's `listTime(at, now, fmt)`), the same way they take `locale` today.

### Lint rule `date-format/no-raw-date-format` (in `date-format/lint/`)

- Reports `.toLocaleTimeString(`, `.toLocaleDateString(` and `new Intl.DateTimeFormat(` /
  `Intl.DateTimeFormat(`, except the bare `Intl.DateTimeFormat().resolvedOptions()` used to
  read the host zone.
- Reports `.toLocaleString(` when its receiver is a `Date`. This needs types, so the rule
  declares `requiresTypeChecking`. Number `toLocaleString` stays allowed.
- Message: "Format dates through `useDateFormatter()` / `serverDateFormatter()`
  (primitives/date-format). It follows the user's Clock / Date order / Numeric dates
  settings." No flaw: the guard sits on a platform API we can't remove. The real fix is the
  formatter, and the rule only stops new code from bypassing it.
- `date-format/exempt/index.ts`: `{ paths: ["."], kind: "sanctioned" }`.
- Sanctioned exemptions are declared by each non-display owner, each with its reason:
  - `packages/wall-clock` (zone arithmetic)
  - `primitives/metrics/core/intervals.ts` bucket math
  - `debug/timeline/server/internal/format.ts` (agent-facing fixed report)
  - `chord/progress/core/progress.ts` (zone validation)
  - `places/ask/machine/internal/instructions.ts` (LLM prompt text)

### Migration (about 50 display sites)

The pattern, once per site:
- In web components and hooks: `const fmt = useDateFormatter()`, then `fmt.time(d)` /
  `fmt.date(d, …)` / `fmt.dateTime(d)` / `fmt.numeric(d, { time: true })` for what was
  `toLocaleString()`.
- In plain helpers called from components (`debug/queue/web/internal/format.ts`, the deploy
  analytics `format.ts`, `jsonl-viewer/web/utils.ts`, health-row verdicts…): add a
  `fmt: DateFormatter` parameter and pass it from the caller's hook.
- In `core/` with a `locale` parameter today: replace `locale` with `fmt`. This covers
  `mail/shell/core/internal/present.ts`, `fields/date/data-view-group/.../date-groupings.ts`,
  `fields/date/filter/.../date-anchor.ts`, `primitives/date-picker/core/internal/labels.ts`,
  `file-explorer/browser/core/internal/format.ts`, and the display half of
  `metrics/core/intervals.ts` (`short` / `label`).
- Fixed-locale sites drop their locale: `desktop/shelf/use-minute-clock.ts` (en-GB),
  `infra/spawn/.../background-arm` and `infra/file-watcher/.../background-arm` providers
  (server: `serverDateFormatter()`), `supervisor-roles/spend/windows.ts`,
  `sessions-section.tsx`, `session-band.tsx` and `website/tips-body.tsx`.
- UTC labels keep `timeZone: "UTC"` through the option: deploy dashboard buckets and
  `account-spend-glance`.
- `events/event-list/web/internal/format.ts` is hand-written, not Intl, so the lint can't see
  it. It moves onto the formatter anyway.
- **Mail's reply quote** (`mail/compose/core/internal/reply.ts`, "On … wrote:", fixed
  en-US + UTC) goes into the email the user sends. It follows the sender's settings, as Gmail
  does with the sender's language. It keeps `timeZone: "UTC"` and the zone name.

Representative files: `plugins/apps/plugins/mail/plugins/shell/core/internal/present.ts`,
`plugins/page/plugins/inline-date/web/internal/format-date.ts`,
`plugins/primitives/plugins/commit-list/web/internal/commit-row-item.tsx`,
`plugins/apps/plugins/agent-manager/plugins/welcome/web/components/welcome-view.tsx`.

### Tests

- New `date-format/core/*.test.ts` covers every prefs combination: 12/24h, MDY/DMY/Browser
  date order, all four numeric formats, `year: "auto"` across a year boundary, `timeZone`,
  and a midnight hour of 00, not 24.
- Existing tests that assert strings get updated. Under the defaults (Browser, Browser, YMD)
  the jsdom en-US pin keeps "Nov 26" and "11:17 PM", so only numeric outputs change. Tests
  with a `locale` parameter (`present.test.ts`, `date-groupings.test.ts`,
  `intervals.test.ts`, `file-explorer paths.test.ts`) pass a `createDateFormatter(prefs)`
  instead.

## Execution

1. Land the primitive, config, lint rule and the core tests myself.
2. Run the lint to get the exact list of sites. Migrate them in 3 parallel opus subagents,
   split by area (apps / conversations+tasks+review / debug+infra+primitives+the rest), each
   with the pattern above.
3. `./equin check` (type-check with lint), then `./equin test` on the touched paths, then `./equin build`.

## Verification

- `./equin check` passes. The lint reports zero sites outside the exemptions.
- `./equin test` passes on the date-format tests and the updated tests.
- On the worktree build, set Clock = 24-hour and Date order = Month first, then confirm in the browser:
  - Mail list: "23:17".
  - Reader tooltip: "2026-11-27 23:17".
  - /agents greeting: "Thursday, November 27".
  - A commit list: "2026-11-27".
  - Then switch Date order to Day first and see "27 Nov" in Mail's older rows.
- `register_before_after` for the Mail list and /agents.
