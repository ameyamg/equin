import { useState } from "react";
import { useOpenPane } from "@plugins/primitives/plugins/pane/web";
import {
  Button,
  ControlSizeProvider,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Cluster } from "@plugins/primitives/plugins/css/plugins/cluster/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { linkProps } from "@plugins/primitives/plugins/link-gesture/web";
import { useNavigate } from "@plugins/apps-core/plugins/tabs/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import { track } from "@plugins/apps/plugins/deploy/plugins/analytics/plugins/collect/web";
import { WebsiteBand } from "@plugins/apps/plugins/website/plugins/shell/web";
import { demoPagePath } from "@plugins/apps/plugins/website/plugins/live-demo/core";
import { morphDemoFrame } from "@plugins/apps/plugins/website/plugins/landing/plugins/screenshot/plugins/chrome/web";
import { downloadPane } from "@plugins/apps/plugins/website/plugins/pages/plugins/download/web";

const playIcon = symbol("play-arrow");

const HEADING = "Try it";
const LINE =
  "Explore every app in your browser, or install your own copy and reshape it.";

/** The demo page at its own start: the button names no place inside it. */
const DEMO_URL = demoPagePath(undefined);

/**
 * Where a Try it band sits, which its analytics events are named after:
 * `home` (the homepage's section, `home_try_demo`) or `page_end` (the end of
 * every other reading page, `page_end_try_demo`).
 */
type TryPlacement = "home" | "page_end";

/** The homepage's Try it, between the hero and the layers. */
export function HomeTrySection() {
  return <TrySection placement="home" />;
}

/** The Try it every other reading page ends on (`Website.PageEnd`). */
export function PageEndTrySection() {
  return <TrySection placement="page_end" />;
}

/**
 * "Try it": the site's one invitation — on the homepage between the hero and
 * the layers, and at the end of every other reading page —
 * a title, one line, and two pills. Open the demo (filled) is the real app in
 * this tab: the click grows the demo's box out of the button to the whole
 * tab, the motion the demo's own Maximize makes (`morphDemoFrame`), so the
 * visitor sees where they went. Download (outlined) is the download page.
 *
 * Plain words and two buttons on the section's rule, nothing boxed: the
 * sticky header offers the same two all along, so this must invite rather
 * than push.
 */
function TrySection({ placement }: { placement: TryPlacement }) {
  const openPane = useOpenPane();
  const go = useNavigate();
  // The button's element, for the morph to grow out of: state through a
  // callback ref, so the click handler reads it without touching a ref.
  const [demoButton, setDemoButton] = useState<HTMLElement | null>(null);
  const openDemo = linkProps({
    open: () => {
      track(`${placement}_try_demo`);
      morphDemoFrame(() => go(DEMO_URL), demoButton ?? undefined);
    },
    href: () => DEMO_URL,
  });
  return (
    <WebsiteBand section="try" divider rhythm="section">
      <Stack gap="xl" align="center" className="text-center">
        <Stack gap="sm" align="center">
          <Text as="h2" variant="title" className="tracking-tight">
            {HEADING}
          </Text>
          <Text as="p" variant="body" tone="muted">
            {LINE}
          </Text>
        </Stack>
        <ControlSizeProvider size="lg">
          <Cluster gap="sm" justify="center">
            <Button
              ref={setDemoButton}
              variant="secondary"
              shape="pill"
              className="font-semibold"
              {...openDemo}
            >
              {/* The brand blue's one mark in the pill, as the header's Demo. */}
              <Icon
                icon={playIcon}
                active
                className="text-primary-text size-3"
              />
              Open the demo
            </Button>
            <Button
              variant="outline"
              shape="pill"
              className="font-semibold"
              {...openPane.link(downloadPane, {}, { mode: "root" })}
              onClickCapture={() => track(`${placement}_try_download`)}
            >
              Download
            </Button>
          </Cluster>
        </ControlSizeProvider>
      </Stack>
    </WebsiteBand>
  );
}
