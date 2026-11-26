import type { ReactElement } from "react";
import {
  defineRoute,
  Pane,
  PaneChrome,
} from "@plugins/primitives/plugins/pane/web";
import { deployApp } from "@plugins/apps/plugins/deploy/plugins/shell/core";
import { FeedsPage } from "./components/feeds-page";

/**
 * `/deploy/feeds` — declared beside the one pane that answers it: only this
 * plugin's sidebar entry opens it. A root of its own, like the Activity page.
 */
const feedsRoute = defineRoute({ id: "deploy-feeds", segment: "feeds" });

/** Every feed this instance declares: its items, published to every copy of its site. */
export const feedsPane = Pane.define({
  title: "Feeds",
  route: feedsRoute,
  app: deployApp,
  component: FeedsBody,
});

function FeedsBody(): ReactElement {
  return (
    <PaneChrome pane={feedsPane}>
      <FeedsPage />
    </PaneChrome>
  );
}
