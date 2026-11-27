import type { ComponentProps, ReactNode } from "react";
import { Movable } from "@plugins/primitives/plugins/dom/plugins/movable/web";
import { Button } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Icon } from "@plugins/ui/plugins/icons/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { LiveDemo } from "../slots";
import "./demo-site-bar.css";

const backIcon = symbol("arrow-back");

/**
 * The demo page's way out to the site: a small floating pill hanging from
 * the top edge, centred — between the demo's own launcher (top-left) and its
 * floating action bar (top-right) — Back to equin.ai (a quiet text link), then the site
 * links contributed to `LiveDemo.BarLink` (Download, the white call to
 * action). Always shown on the demo page, however the visitor got there, so a
 * touch screen has it too. Grabbed anywhere it is dragged off whatever it
 * covers (`Movable`, inside `bounds`); a press on a link stays a click, and a
 * double-click on its surface sends it home.
 *
 * `onBack` is the caller's: the morph back into the homepage's frame after a
 * Maximize, else the site page the visitor came from, else the homepage.
 */
export function DemoSiteBar({
  onBack,
  bounds,
}: {
  onBack: () => void;
  /** The box the bar stays inside: the demo page's. */
  bounds: HTMLElement | null;
}): ReactNode {
  return (
    <Movable
      at={{ pin: "top", offset: "sm", layer: "overlay" }}
      bounds={bounds}
      className="demo-site-bar"
      data-demo-site-bar=""
    >
      <Button
        variant="ghost"
        shape="pill"
        className="demo-site-bar-link demo-site-bar-back"
        onClick={onBack}
      >
        <Icon icon={backIcon} />
        {/* A phone keeps the bar short: "Website". */}
        <span className="demo-site-bar-long">Back to equin.ai</span>
        <span className="demo-site-bar-short">Website</span>
      </Button>
      <LiveDemo.BarLink.Render />
    </Movable>
  );
}

/**
 * One link of the demo page's site bar (a `LiveDemo.BarLink` contribution):
 * the site's call-to-action pill (its inverted fill), small. A link onward,
 * so no glyph — an icon read as the action itself (a download starting).
 */
export function DemoBarLink({
  label,
  ...rest
}: Omit<
  ComponentProps<typeof Button>,
  "variant" | "shape" | "size" | "children"
> & {
  label: string;
}): ReactNode {
  return (
    <Button
      variant="secondary"
      shape="pill"
      className="demo-site-bar-link demo-site-bar-cta"
      {...rest}
    >
      {label}
    </Button>
  );
}
