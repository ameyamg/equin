import { useEffect } from "react";
import type { AppRef } from "@plugins/primitives/plugins/pane/core";
import {
  currentRoutePath,
  usePathname,
} from "@plugins/primitives/plugins/pane/web";
import type { OutboundDestinationOf } from "../../core";
import { getTracker, watchOutboundLinksUnder } from "../internal/instance";
import { isWithinApp } from "../internal/scope";

/**
 * Records one pageview per path change of `app`, with the visible time spent on
 * each. Mounted ONCE by the app that wants to be measured — never a `Core.Root`
 * contribution, or a local composition carrying every plugin would track itself.
 *
 * Only paths under `app.basePath` count: in a composition with several apps the
 * component stays mounted in a background tab while the address shows another
 * app, and that app's pages are not this site's visits.
 *
 * Nothing is stored in the browser unless the visitor accepts the site's
 * consent prompt (`consent.ts`: one random key); the dedup lives in module
 * scope (instance.ts), so a remount never double counts.
 *
 * Every click on a link leaving the site, under the app, records
 * `outbound_click` (`outbound.ts`) — no link opts in. `destinationOf` names
 * the site's own destinations (`github_repo`); any other is named by its host.
 */
export function AnalyticsTracker({
  app,
  destinationOf = noDestinationNames,
}: {
  app: AppRef;
  destinationOf?: OutboundDestinationOf;
}) {
  const path = usePathname();
  useEffect(() => {
    if (isWithinApp(path, app.basePath)) getTracker().pathChanged(path);
  }, [path, app.basePath]);
  useEffect(
    () =>
      watchOutboundLinksUnder({
        inScope: () => isWithinApp(currentRoutePath(), app.basePath),
        destinationOf,
      }),
    [app.basePath, destinationOf],
  );
  return null;
}

const noDestinationNames: OutboundDestinationOf = () => undefined;
