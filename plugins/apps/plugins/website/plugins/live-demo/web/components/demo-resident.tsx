import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Inline } from "@plugins/primitives/plugins/css/plugins/inline/web";
import { Button } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Icon } from "@plugins/ui/plugins/icons/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import {
  AppEmbed,
  type EmbedPlaceBinding,
} from "@plugins/apps-core/plugins/app-embed/web";
import {
  useClaimTabTitle,
  useNavigate,
} from "@plugins/apps-core/plugins/tabs/web";
import { withActiveRoutePrefix } from "@plugins/primitives/plugins/pane/plugins/route-prefix/web";
import { usePathname } from "@plugins/primitives/plugins/pane/web";
import { websiteApp } from "@plugins/apps/plugins/website/plugins/shell/core";
import {
  DemoMemoryOnlyNotice,
  DemoScope,
} from "@plugins/framework/plugins/browser-server/plugins/demo/plugins/scope/web";
import {
  DemoBootScreen,
  morphDemoFrame,
  ResetDemoButton,
} from "@plugins/apps/plugins/website/plugins/landing/plugins/screenshot/plugins/chrome/web";
import { track } from "@plugins/apps/plugins/deploy/plugins/analytics/plugins/collect/web";
import { workspaceDemo } from "@plugins/apps/plugins/website/plugins/demos/plugins/workspace/core";
import {
  DemoStoreProvider,
  useDemoActions,
  useDemoState,
  type DemoTargetEntry,
} from "../internal/demo-store";
import { landingUrl } from "../internal/demo-url";
import { demoPage, demoPagePath } from "../../core";
import { DemoSiteBar } from "./demo-site-bar";
import "./demo-memory-only.css";

/**
 * The live demo's resident, wrapping the site's pages (`Website.Resident`):
 * the demo's state for the visit (its store's scope, around the pages and the
 * server alike) and the server itself, beside the pages.
 */
export function DemoResident({ children }: { children: ReactNode }): ReactNode {
  return (
    <DemoStoreProvider>
      <SitePageTracker />
      {children}
      <DemoServer />
    </DemoStoreProvider>
  );
}

/**
 * Remembers the site page the visitor is on (`DemoState.cameFrom`) while it
 * is not the demo page, so the demo page's Back to equin.ai returns to the
 * page they came from — the apps gallery, a tip — not always the homepage.
 * Only the site's own paths count: on a composition with several apps the
 * site's surface stays mounted while the address shows another app.
 */
function SitePageTracker(): null {
  const path = usePathname();
  const { sawSitePage } = useDemoActions();
  useEffect(() => {
    if (isUnder(path, websiteApp.basePath) && !isUnder(path, demoPage.path))
      sawSitePage(path);
  }, [path, sawSitePage]);
  return null;
}

/** `path` is `base` or a page below it (`/base/x`, `/base;key=v`). */
function isUnder(path: string, base: string): boolean {
  return (
    path === base || path.startsWith(base + "/") || path.startsWith(base + ";")
  );
}

/**
 * The live demo's server, for the whole visit: mounted by the site's surface
 * (`Website.Resident`), so moving between the homepage's frame and the demo
 * page never ends it. Nothing mounts until a page first asks for the demo
 * (a `DemoTarget`) — another site page starts no worker — and from then on
 * one `<DemoScope>` stays (`resume` while the demo page shows, whose URL
 * says the visitor is in; the homepage frame shows the gate on every load). Its boot screen and the running demo
 * are drawn into whichever box the current page claimed, through a portal;
 * on a page without one, nothing is drawn and the server keeps running.
 */
function DemoServer(): ReactNode {
  const { started, target, viaMaximize, cameFrom } = useDemoState();
  const demo = useDemoActions();
  const navigate = useNavigate();
  const maximize = useCallback(() => {
    track("demo_maximize");
    demo.maximizing();
    morphDemoFrame(() => navigate(demoPagePath(demo.peek().place)));
  }, [demo, navigate]);
  const restore = useCallback(
    () => morphDemoFrame(() => navigate(landingUrl())),
    [navigate],
  );
  // The demo page's Back to equin.ai: into the frame it was maximized from
  // (the morph), else the site page the visitor came from, else (the demo
  // page opened directly) the homepage.
  const back = useCallback(() => {
    track("demo_back_to_site");
    if (viaMaximize) restore();
    else navigate(cameFrom ?? landingUrl());
  }, [viaMaximize, restore, navigate, cameFrom]);
  if (!started) return null;
  return (
    <>
    <DemoScope
      scenario={workspaceDemo}
      onEnter={demo.entered}
      // The demo page's URL names a place in the demo: the visitor is in,
      // whichever page mounted the scope first. The homepage's URL names no
      // place: its frame shows the gate on every load, even while the
      // visitor is in the demo in another tab — the gate is only a doorway
      // (Enter connects to the same shared host, already started behind it
      // when this browser holds the data), so a reload starts from it.
      resume={target?.kind === "page"}
      boot={(state) =>
        target === null
          ? null
          : createPortal(
              <DemoBootScreen state={state} />,
              target.element,
              target.kind,
            )
      }
    >
      {target !== null && (
          <ResidentDemo target={target} onMaximize={maximize} />
      )}
    </DemoScope>
      {/* The demo page's site bar, outside the scope: it is the site's
          chrome — its links the site's contributions (the scope's plugins
          are the demo's), its look the site's theme — drawn over the demo
          from the start, its boot included. */}
      {target?.kind === "page" &&
        createPortal(
          <DemoSiteBar onBack={back} bounds={target.element} />,
          target.element,
          "site-bar",
        )}
    </>
  );
}

/** The running demo, in the current page's box, and the frame's controls. */
function ResidentDemo({
  target,
  onMaximize,
}: {
  target: DemoTargetEntry;
  onMaximize: () => void;
}): ReactNode {
  const { controls } = useDemoState();
  const demo = useDemoActions();
  const { setPlace } = demo;
  const claimTitle = useClaimTabTitle();
  // The framed demo's place: memory, never the homepage's URL.
  const framed = useMemo<EmbedPlaceBinding>(
    () => ({
      location: demo.place,
      onLocationChange: (url) => setPlace(url),
      browserTabUrl: (at) => withActiveRoutePrefix(demoPagePath(at)),
    }),
    [demo.place, setPlace],
  );
  const page = target.kind === "page";
  return (
    <>
      {createPortal(
        <>
          {/* Moving between the frame and the page remounts the embed (a
              new box), which reopens at its binding's place. */}
          <AppEmbed
            place={target.place ?? framed}
            fills={page ? "viewport" : undefined}
            onTitleChange={claimTitle}
          />
          {/* The demo page has no controls row: the line sits over the
              demo's foot. The frame's is in its controls, below. */}
          {page && (
            <DemoMemoryOnlyNotice className="website-demo-memory-only" />
          )}
        </>,
        target.element,
        target.kind,
      )}
      {!page &&
        controls !== null &&
        createPortal(
          <Inline gap="sm">
            <Button variant="outline" onClick={onMaximize}>
              <Icon icon={symbol("fullscreen")} />
              Maximize
            </Button>
            <ResetDemoButton
              onReset={() => {
                track("demo_reset");
                setPlace(undefined);
              }}
            />
            <DemoMemoryOnlyNotice />
          </Inline>,
          controls,
        )}
    </>
  );
}
