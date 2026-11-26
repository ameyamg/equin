import type { ComponentProps } from "react";
import { useOpenPane } from "@plugins/primitives/plugins/pane/web";
import { cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { useAppLinkProps } from "@plugins/apps-core/plugins/tabs/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import { demoPagePath } from "@plugins/apps/plugins/website/plugins/live-demo/core";
import {
  TipsBulb,
  tipsPane,
} from "@plugins/apps/plugins/website/plugins/pages/plugins/tips/web";
import { track } from "@plugins/apps/plugins/deploy/plugins/analytics/plugins/collect/web";
import { DownloadCard } from "./download-card";

const playIcon = symbol("play-arrow");

/**
 * The demo page at no place of its own (`/about/demo`): the demo opens full
 * screen where it starts by itself, so this page names no place inside it.
 */
const DEMO_URL = demoPagePath(undefined);

/**
 * The page's closing pair, after the steps: Learn the tricks (the tips page —
 * for a reader whose equin now runs) and, for a reader not ready to install,
 * the live demo full screen (its agents off: they need equin on the reader's
 * machine). Two slim cards of one shape, each a title, a line and one pill;
 * a guide link can join the tips card once the guide is written.
 */
export function DownloadClosing() {
  const openPane = useOpenPane();
  const appLinkProps = useAppLinkProps();
  return (
    <Stack gap="md" className="website-download-closing">
      <DownloadCard
        tone="tips"
        icon={<TipsBulb />}
        title="Learn the tricks"
        line="Small shortcuts that make equin faster, one tip at a time."
        action={
          <Pill
            label="All tips"
            {...openPane.link(tipsPane, {}, { mode: "root" })}
            onClickCapture={() => track("download_tips")}
          />
        }
      />
      <DownloadCard
        tone="demo"
        icon={<Icon icon={playIcon} active />}
        title="Try it in your browser first"
        line="Every app on made-up data, nothing to install. Agents only run on your machine."
        action={
          <Pill
            label="Open the demo"
            {...appLinkProps(DEMO_URL)}
            onClickCapture={() => track("download_try_demo")}
          />
        }
      />
    </Stack>
  );
}

/**
 * A card's way on: a quiet outlined pill with the site's forward arrow
 * (`download-card.css`). A plain button rather than the ui-kit `Button`: that
 * one's height is the ambient control density, and this pill is the design's
 * own 40px, and its arrow is the design's "→" (the font's glyph, longer than
 * the icon `WebsiteArrow` draws).
 */
function Pill({
  label,
  className,
  ...link
}: { label: string } & Omit<ComponentProps<"button">, "children">) {
  return (
    <button
      type="button"
      {...link}
      className={cn("download-card-pill", className)}
    >
      {label}
      <span aria-hidden className="download-card-arrow">
        →
      </span>
    </button>
  );
}
