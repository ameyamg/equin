import { useMemo, useState } from "react";
import { PanelSection } from "@plugins/companions/plugins/panel/web";
import { foldResource } from "@plugins/network/plugins/live/plugins/live-state/web";
import {
  renderAsContribution,
  useSlotOrder,
} from "@plugins/primitives/plugins/slot-render/web";
import { Row } from "@plugins/primitives/plugins/css/plugins/row/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Spinner } from "@plugins/primitives/plugins/css/plugins/spinner/web";
import { rigidClass } from "@plugins/primitives/plugins/css/plugins/rigid/web";
import { yieldClass } from "@plugins/primitives/plugins/css/plugins/yield/web";
import {
  cn,
  SingleLineProvider,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { linkGestureProps } from "@plugins/primitives/plugins/link-gesture/web";
import {
  Avatar,
  AvatarPresentationProvider,
} from "@plugins/primitives/plugins/avatar/web";
import { usePageShortcuts } from "@plugins/primitives/plugins/shortcuts/web";
import { useLatestRef } from "@plugins/primitives/plugins/latest-ref/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import {
  groupPageActions,
  type PageAction,
  type PageActionHost,
} from "../../core";
import { BrowserExtension } from "../slots";
import { useExtensionHost } from "../host";
import { canParseUrl } from "@plugins/packages/plugins/floor-compat/core";

const doneIcon = symbol("check");
const failedIcon = symbol("error");

/** How far one action's run has got. */
type RunState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done" }
  | { kind: "failed"; message: string };

/** Shortcut digits: ⌘1 … ⌘9, in the order the rows are drawn. */
const MAX_SHORTCUTS = 9;

/**
 * The page-actions section (`BrowserExtension.Section` "page-actions"): every
 * `BrowserExtension.PageAction` matching the tab the popup is about, one
 * labelled section per site (the site's label, as every companion section
 * title), in the slot's order. Absent when no action matches, the tab is not
 * known, or the host cannot act on it.
 */
export function PageActionsSection() {
  const host = useExtensionHost();
  const order = useSlotOrder(BrowserExtension.PageAction);
  const actions = foldResource(order, {
    // Actions are offers, not data: while the order is unknown there are none yet.
    loading: (): readonly PageAction[] | null => null,
    error: (_error, stale) => stale ?? null,
    ready: (list) => list,
  });
  const present = host.kind === "present" ? host : null;
  const href =
    present?.tab !== null &&
    present?.tab !== undefined &&
    canParseUrl(present.tab.url)
      ? present.tab.url
      : null;
  const url = useMemo(() => (href === null ? null : new URL(href)), [href]);
  const groups = useMemo(
    () =>
      actions === null || url === null ? [] : groupPageActions(actions, url),
    [actions, url],
  );
  const pageHost = useMemo((): PageActionHost | null => {
    if (present === null) return null;
    const { navigate, openTab } = present;
    if (navigate === null || openTab === null) return null;
    return { navigate, openTab };
  }, [present]);
  const [runs, setRuns] = useState<Readonly<Record<string, RunState>>>({});

  const flat = useMemo(() => groups.flatMap((g) => g.actions), [groups]);
  const run = (action: PageAction, elsewhere: boolean) => {
    if (url === null || pageHost === null) return;
    const now = runs[action.id];
    if (now?.kind === "running") return;
    setRuns((r) => ({ ...r, [action.id]: { kind: "running" } }));
    runAction(action, url, pageHost, elsewhere).then(
      () => setRuns((r) => ({ ...r, [action.id]: { kind: "done" } })),
      (err: unknown) =>
        setRuns((r) => ({
          ...r,
          [action.id]: {
            kind: "failed",
            message: err instanceof Error ? err.message : String(err),
          },
        })),
    );
  };
  const runRef = useLatestRef(run);
  usePageShortcuts(
    useMemo(
      () =>
        flat.slice(0, MAX_SHORTCUTS).map((action, i) => ({
          id: `browser-extension.page-action.${i + 1}`,
          keys: `mod+${i + 1}`,
          label: action.title,
          group: "Browser extension",
          enableInInputs: true,
          handler: () => runRef.current(action, false),
        })),
      // `runRef` always holds the latest run.
      [flat, runRef],
    ),
  );

  if (url === null || pageHost === null || groups.length === 0) return null;
  return (
    <>
      {groups.map((group) => (
        <PanelSection key={group.label} label={group.label}>
          {group.actions.map((action) => {
            const index = flat.indexOf(action) + 1;
            return renderAsContribution(
              BrowserExtension.PageAction,
              action,
              <PageActionRow
                key={action.id}
                action={action}
                url={url}
                shortcut={index <= MAX_SHORTCUTS ? index : null}
                state={runs[action.id] ?? { kind: "idle" }}
                onRun={(elsewhere) => run(action, elsewhere)}
              />,
            );
          })}
        </PanelSection>
      ))}
    </>
  );
}

function PageActionRow({
  action,
  url,
  shortcut,
  state,
  onRun,
}: {
  action: PageAction;
  url: URL;
  shortcut: number | null;
  state: RunState;
  onRun: (elsewhere: boolean) => void;
}) {
  const subtitle = actionSubtitle(action, url);
  return (
    <Row
      icon={
        <span className={cn("block size-7", rigidClass())}>
          <AvatarPresentationProvider value="gradient-tile">
            <Avatar
              symbol={action.icon.symbol}
              color={action.icon.color}
              shape="squircle"
            />
          </AvatarPresentationProvider>
        </span>
      }
      {...(action.kind === "link"
        ? linkGestureProps(({ elsewhere }) => onRun(elsewhere))
        : { onClick: () => onRun(false) })}
      actions={<RunMark state={state} shortcut={shortcut} />}
      actionsAlwaysVisible
      title={state.kind === "failed" ? state.message : subtitle}
    >
      {/* One line each: a destination is long (a deep app path), and the
          host and the start of the path are what tell two rows apart. */}
      <SingleLineProvider value={true}>
        <Stack gap="none" className={yieldClass("x")}>
          <Text as="div">{action.title}</Text>
          <Text as="div" variant="caption" tone="muted">
            {subtitle}
          </Text>
        </Stack>
      </SingleLineProvider>
    </Row>
  );
}

/**
 * Runs `action` on `url`: a link loads its destination in the tab the popup is
 * about, or in a new tab when the gesture asked for one `elsewhere`.
 */
async function runAction(
  action: PageAction,
  url: URL,
  host: PageActionHost,
  elsewhere: boolean,
): Promise<void> {
  if (action.kind === "run") return action.run(url, host);
  const href = action.href(url);
  // Elsewhere is a new tab behind this one, as the same gesture on a link.
  await (elsewhere
    ? host.openTab(href, { background: true })
    : host.navigate(href));
}

/** The row's subtitle: a link's destination, without the scheme (noise in a
 *  300px popup). */
function actionSubtitle(action: PageAction, url: URL): string {
  return action.kind === "link"
    ? action.href(url).replace(/^https?:\/\//, "")
    : action.subtitle(url);
}

/** The row's trailing mark: its ⌘N, a spinner while it runs, then a check. */
function RunMark({
  state,
  shortcut,
}: {
  state: RunState;
  shortcut: number | null;
}) {
  switch (state.kind) {
    case "running":
      return <Spinner shape="ring" className="size-3.5" />;
    case "done":
      return <Icon icon={doneIcon} className="size-4 text-success" />;
    case "failed":
      return <Icon icon={failedIcon} className="size-4 text-destructive" />;
    case "idle":
      return shortcut === null ? null : (
        <Text variant="caption" tone="muted">
          ⌘{shortcut}
        </Text>
      );
  }
}
