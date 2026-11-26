import {
  createContext,
  useContext,
  useMemo,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  ANALYTICS_MIRROR_SET_ID,
  COLLECT_PLUGIN_ID,
  DEVICE_FAMILIES,
  type Session,
} from "@plugins/apps/plugins/deploy/plugins/analytics/plugins/collect/core";
import {
  useDeploymentShips,
  useShipsGate,
  type HostQuerySubject,
} from "@plugins/apps/plugins/deploy/plugins/host-query/web";
import { siteMirrorStatus } from "@plugins/apps/plugins/deploy/plugins/site-mirror/plugins/pull/core";
import { MirrorFreshness } from "@plugins/apps/plugins/deploy/plugins/site-mirror/plugins/pull/web";
import { useLive } from "@plugins/network/plugins/live/web";
import { clause } from "@plugins/network/plugins/live/plugins/filter/core";
import {
  ResourceErrorInline,
  type ResourceReadiness,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import {
  DataViewSwitcher,
  defineDataView,
  defineDataViewSources,
  fieldOverrides,
  liveDataSource,
  type DataViewLoadedFrameProps,
  type DataViewSourceProps,
} from "@plugins/primitives/plugins/data-view/web";
import {
  optionsWindow,
  type FieldOption,
  type FieldOptionsResult,
  type FieldOptionsWindow,
  type FilterGroup,
  type QuickFilter,
  type QuickFilterOption,
} from "@plugins/primitives/plugins/data-view/core";
import {
  Inset,
  Stack,
} from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import {
  deploymentPages,
  deploymentSessions,
  sessionOf,
  type SessionRow,
} from "../../core";
import { axisMaxS } from "../internal/axis";
import { median } from "../internal/format";
import { journeyOf, sectionsByPath, type Journey } from "../internal/journey";
import { visitLoad } from "../internal/load";
import { LaneWindowContext, type LaneWindow } from "../internal/lane-context";
import { SessionLane } from "./session-lane";
import { SessionTimeline } from "./session-timeline";
import { sessionsToolbar } from "./sessions-toolbar";

// Marker scraped by codegen (data-views.generated.ts). Must live in web/**.
const SESSIONS_VIEW = defineDataView("deploy-sessions");

const SUBJECT: HostQuerySubject = {
  reading: "visits",
  answer: "a page of analytics rows",
};

/**
 * Where the Sessions surface's rows come from: one source, `visits` — a
 * site's live visits (a live source: paged, filtered and searched by
 * collect's SQL on the copy), or (the exhibit) made-up ones held in memory.
 * Either way every lane shares one axis and one section estimate, derived
 * from the loaded window (`loadedFrame`).
 */
export type SessionsHostProps =
  | { kind: "site"; deploymentId: string }
  | { kind: "fixture"; rows: readonly SessionRow[] };

export const SessionsSources = defineDataViewSources<SessionsHostProps>();

/** The tab's gate: the same "ships collect" rule as the Analytics tab's. */
export function useSessionsAvailable({
  deploymentId,
}: {
  deploymentId: string;
}): boolean {
  return useShipsGate(deploymentId, COLLECT_PLUGIN_ID);
}

/**
 * **Sessions** — one row per anonymous visit of the deployed site, read from
 * this computer's copy of the site's analytics tables (site-mirror), paged as
 * the list scrolls and kept live as pulls land. Shown only when the
 * deployment's composition ships collect.
 */
export function SessionsSection({
  deploymentId,
}: {
  deploymentId: string;
}): ReactNode {
  const ships = useDeploymentShips(deploymentId, COLLECT_PLUGIN_ID);
  switch (ships.kind) {
    case "pending":
      return <Loading variant="rows" count={3} />;
    case "failed":
      return (
        <ResourceErrorInline
          variant="block"
          subject="whether this deployment records visits"
          error={ships.error}
          refetch={ships.refetch}
        />
      );
    case "yes":
      return <SessionsTab deploymentId={deploymentId} />;
    // The gate removes the tab on `no`.
    case "no":
      return null;
  }
}

function SessionsTab({ deploymentId }: { deploymentId: string }): ReactNode {
  return (
    <Stack gap="none">
      <Inset t="lg" b="smd">
        <MirrorFreshness
          deploymentId={deploymentId}
          setId={ANALYTICS_MIRROR_SET_ID}
          subject={SUBJECT}
        />
      </Inset>
      <WhenCopied deploymentId={deploymentId} />
    </Stack>
  );
}

/**
 * The list, once this computer holds a whole copy of the site's analytics.
 * Before that it is not known yet — a loading state, never an empty list
 * (the freshness line above says what the copy is doing, or why it failed).
 */
function WhenCopied({ deploymentId }: { deploymentId: string }): ReactNode {
  const status = useLive(siteMirrorStatus, { deploymentId });
  switch (status.status) {
    case "loading":
      return <Loading variant="rows" count={6} />;
    case "error":
      return (
        <ResourceErrorInline
          variant="block"
          subject="whether this site's visits are copied yet"
          error={status.error}
          refetch={status.refetch}
        />
      );
    case "ready": {
      const row = status.data.find((r) => r.setId === ANALYTICS_MIRROR_SET_ID);
      return row?.copied === true ? (
        <SessionsList host={{ kind: "site", deploymentId }} />
      ) : (
        <Loading variant="rows" count={6} />
      );
    }
  }
}

/** The Sessions DataView over `host`'s visits. */
export function SessionsList({ host }: { host: SessionsHostProps }): ReactNode {
  return (
    <DataViewSwitcher<SessionsHostProps>
      storageKey={SESSIONS_VIEW}
      sources={SessionsSources}
      hostProps={host}
      viewEdits={{ mode: "draft" }}
      toolbar={sessionsToolbar}
      searchPlaceholder="Filter by page, source, country…"
    />
  );
}

/** The `visits` source: a site's live visits, or the exhibit's made-up ones. */
export function VisitsSource(
  props: DataViewSourceProps<SessionsHostProps>,
): ReactElement {
  return props.hostProps.kind === "site" ? (
    <SiteVisits
      deploymentId={props.hostProps.deploymentId}
      render={props.render}
      filter={props.view.filter}
    />
  ) : (
    <ExhibitVisits
      rows={props.hostProps.rows}
      render={props.render}
      filter={props.view.filter}
    />
  );
}

type RenderBundle = DataViewSourceProps<SessionsHostProps>["render"];

const READY: ResourceReadiness = { status: "ready" };

/** The made-up visits (the exhibit): every row is loaded, so its pages are the rows'. */
function ExhibitVisits({
  rows,
  render,
  filter,
}: {
  rows: readonly SessionRow[];
  render: RenderBundle;
  filter: FilterGroup | null;
}): ReactElement {
  const pageOptions = useMemo<FieldOptionsResult>(() => {
    const visits = new Map<string, number>();
    for (const row of rows)
      for (const path of row.pages)
        visits.set(path, (visits.get(path) ?? 0) + 1);
    return {
      status: "ready",
      options: [...visits]
        .map(([path, n]) => ({ path, visits: n }))
        .sort((a, b) => b.visits - a.visits || (a.path < b.path ? -1 : 1))
        .map(pageOptionOf),
    };
  }, [rows]);
  const overrides = useMemo(
    () => overridesOf({ optionsResult: pageOptions }),
    [pageOptions],
  );
  return (
    <LaneScope deploymentId={null} filter={filter}>
      {render<SessionRow>({
        rows,
        rowKey: rowKeyOf,
        collection: deploymentSessions,
        overrides,
        readiness: READY,
        // Each made-up row carries its search text, as a site's does.
        searchAccessor: searchTextOfRow,
        ...SHARED_BUNDLE,
      })}
    </LaneScope>
  );
}

/** A visited path as a Pages filter option, its visit count as the hint. */
function pageOptionOf(p: { path: string; visits: number }): FieldOption {
  return {
    value: p.path,
    label: p.path,
    hint: `${p.visits} ${p.visits === 1 ? "visit" : "visits"}`,
  };
}

/**
 * The Pages filter's options for one site: a window of its visited paths
 * (`deploy-analytics.pages`, run on the copy) — the most visited, or those
 * whose path contains the picker's search. A site's paths grow with its
 * traffic, so the picker never holds them all.
 */
function sitePagesWindow(deploymentId: string): FieldOptionsWindow {
  return optionsWindow(deploymentPages, {
    where: clause("deploymentId", "eq", deploymentId),
    search: "path",
    option: (p) => pageOptionOf(p),
  });
}

/** How the Pages filter reads its options: whole (the exhibit's loaded rows) or as a window (a site's). */
type PageOptions =
  { optionsResult: FieldOptionsResult } | { optionsWindow: FieldOptionsWindow };
const rowKeyOf = (row: SessionRow): string => row.key;
const searchTextOfRow = (row: SessionRow): string => row.search;

/**
 * A site's visits, live: key-range pages of its copy, filtered, sorted and
 * searched by collect's SQL there (`search`, its one search text), with the
 * total the view matches.
 */
const visitsSource = liveDataSource(deploymentSessions, {
  surface: SESSIONS_VIEW,
  searchable: ["search"],
  unscoped: {
    reason:
      "a site's visits, read from its copy of the site's own tables: the copy holds no custom column",
  },
});

function SiteVisits({
  deploymentId,
  render,
  filter,
}: {
  deploymentId: string;
  render: RenderBundle;
  filter: FilterGroup | null;
}): ReactElement {
  const source = useMemo(
    () => visitsSource.scoped({ where: { deploymentId } }),
    [deploymentId],
  );
  // The Pages filter offers the site's visited paths, not just the loaded
  // window's: the list pages through time, the filter runs on the copy.
  const overrides = useMemo(
    () => overridesOf({ optionsWindow: sitePagesWindow(deploymentId) }),
    [deploymentId],
  );
  return (
    <LaneScope deploymentId={deploymentId} filter={filter}>
      {render<SessionRow>({ source, overrides, ...SHARED_BUNDLE })}
    </LaneScope>
  );
}

/**
 * Every field but the site, which every read is scoped by; the Pages filter
 * offers the site's visited paths (`pageOptions`).
 */
function overridesOf(pageOptions: PageOptions) {
  return fieldOverrides(deploymentSessions, {
    deploymentId: { visible: false, filterable: false },
    // Searched, never shown, filtered or grouped by hand.
    search: { visible: false, filterable: false, groupable: false },
    pages: pageOptions,
  });
}

/** Each row's collect visit, kept per row object (rows keep identity across reads). */
const SESSIONS = new WeakMap<SessionRow, Session>();
function sessionOfRow(row: SessionRow): Session {
  let s = SESSIONS.get(row);
  if (s === undefined) {
    s = sessionOf(row);
    SESSIONS.set(row, s);
  }
  return s;
}

/** The Pages quick filter's operator: a visit that hit any of the picked paths. */
const PAGES_OPERATOR = "contains-any-of";

/**
 * The paths the view's filter asks for — the Pages quick filter's (or a
 * hand-written top-level `pages contains` rule's) operand — which each row
 * then draws at full strength while its other pages step back; `null` when
 * the filter names no page.
 */
function focusPagesOf(filter: FilterGroup | null): ReadonlySet<string> | null {
  if (filter === null || filter.conjunction !== "and") return null;
  const paths = filter.children.flatMap((c) => {
    if (c.kind !== "rule" || c.fieldId !== "pages") return [];
    if (c.operatorId !== PAGES_OPERATOR && c.operatorId !== "contains")
      return [];
    const v: unknown = c.value;
    return typeof v === "string"
      ? [v]
      : Array.isArray(v)
        ? v.filter((x): x is string => typeof x === "string")
        : [];
  });
  return paths.length === 0 ? null : new Set(paths);
}

/**
 * One click to narrow whose visits and on which kind of device — each option a
 * top-level rule of the active view's filter (every saved view starts on
 * Visitors), so a pick is a draft of the view, carried in the URL. No date
 * range: the list pages back through time as it scrolls.
 */
const QUICK_FILTERS: readonly QuickFilter[] = [
  {
    kind: "segmented",
    id: "whose",
    fieldId: "owner",
    label: "Whose visits",
    options: [
      {
        id: "visitors",
        label: "Visitors",
        rule: { operatorId: "is", value: false },
      },
      { id: "you", label: "You", rule: { operatorId: "is", value: true } },
      { id: "all", label: "All", rule: null },
    ],
  },
  {
    kind: "segmented",
    id: "device",
    fieldId: "device",
    label: "Device",
    options: [
      { id: "any", label: "Any device", rule: null },
      ...DEVICE_FAMILIES.map((d): QuickFilterOption => ({
        id: d.toLowerCase(),
        label: d,
        rule: { operatorId: "is", value: d },
      })),
    ],
  },
  {
    // Visits that went through ANY of the picked pages; the pages are then
    // the ones each row brings forward (`focusPagesOf`).
    kind: "operand",
    id: "pages",
    fieldId: "pages",
    operatorId: PAGES_OPERATOR,
    label: "Pages",
    placeholder: "Any page",
  },
];

const VIEW_OPTIONS = {
  list: {
    renderRow: (row: SessionRow) => <SessionLane session={sessionOfRow(row)} />,
    detail: (row: SessionRow) => (
      <SessionTimeline session={sessionOfRow(row)} />
    ),
    detailOnActivate: true,
    frame: "card",
  },
} as const;

/** What both sources hand the surface besides their rows. */
const SHARED_BUNDLE = {
  quickFilters: QUICK_FILTERS,
  viewOptions: VIEW_OPTIONS,
  emptyState: <>No visit matches this view.</>,
  loadedFrame: LaneFrame,
} as const;

/** What the lanes share that is no part of the loaded rows: the site, and the pages the view asks for. */
interface LaneScopeValue {
  deploymentId: string | null;
  focusPages: ReadonlySet<string> | null;
}
const LaneScopeContext = createContext<LaneScopeValue | null>(null);

function LaneScope({
  deploymentId,
  filter,
  children,
}: {
  deploymentId: string | null;
  /** The active view's filter — which pages it asks for. */
  filter: FilterGroup | null;
  children: ReactNode;
}): ReactNode {
  const focusPages = useMemo(() => focusPagesOf(filter), [filter]);
  const value = useMemo(
    () => ({ deploymentId, focusPages }),
    [deploymentId, focusPages],
  );
  return (
    <LaneScopeContext.Provider value={value}>
      {children}
    </LaneScopeContext.Provider>
  );
}

/**
 * Around the surface (its `loadedFrame`): everything the rows share, derived
 * once per loaded window and provided to the rows and the toolbar band.
 */
function LaneFrame({
  loaded,
  children,
}: DataViewLoadedFrameProps<SessionRow>): ReactNode {
  const scope = useContext(LaneScopeContext);
  if (scope === null)
    throw new Error("[sessions] the surface rendered outside its LaneScope");
  const { deploymentId, focusPages } = scope;
  const { rows, status, total } = loaded;
  const laneWindow = useMemo<LaneWindow>(() => {
    const sessions = rows.map(sessionOfRow);
    const journeys = new Map<string, Journey>(
      sessions.map((s) => [s.id, journeyOf(s)]),
    );
    const all = [...journeys.values()];
    return {
      deploymentId,
      focusPages,
      journeys,
      sections: sectionsByPath(all),
      axisMaxS: axisMaxS(Math.max(0, ...all.map((j) => j.barS))),
      // Not known yet is no figure at all, never "0 sessions".
      summary:
        status !== "ready"
          ? null
          : {
              total,
              loaded: sessions.length,
              // The time a visit was used, as its row's headline says.
              medianS: median(all.map((j) => j.activeS ?? j.durationS)),
              // Over the visits whose load got ready on screen; none such → no figure.
              medianLoadMs: median(
                sessions.flatMap((s) => {
                  const ready = visitLoad(s)?.readyMs ?? null;
                  return ready === null ? [] : [ready];
                }),
              ),
              withActions: all.filter((j) => j.actionCount > 0).length,
            },
    };
  }, [deploymentId, focusPages, rows, status, total]);
  return (
    <LaneWindowContext.Provider value={laneWindow}>
      {children}
    </LaneWindowContext.Provider>
  );
}
