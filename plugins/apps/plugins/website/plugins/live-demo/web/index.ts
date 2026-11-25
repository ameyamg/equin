import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Pane } from "@plugins/primitives/plugins/pane/web";
import { Website } from "@plugins/apps/plugins/website/plugins/shell/web";
import { DemoResident } from "./components/demo-resident";
import { demoPane } from "./panes";
import { LiveDemo } from "./slots";

export { DemoTarget, DemoControls } from "./components/demo-target";
export { useDemoActions, useDemoState } from "./internal/demo-store";
export { demoPane } from "./panes";
export { LiveDemo } from "./slots";
export { DemoBarLink } from "./components/demo-site-bar";

export default {
  description:
    "The website's live demo runtime: equin itself, its real server code in a worker on the workspace demo's data (DemoScope around AppEmbed), kept for the whole visit by a Website.Resident in the site's surface — mounted once a page first asks for the demo, never ended by a page switch — and drawn through a portal into the box the current page claims (DemoTarget): the homepage's frame (its place kept in memory: the homepage's URL stays /about) or the demo page /about/demo, the demo alone filling the page (its place the page's embed tail, /about/demo/at/<place>, each move a history entry; Esc is the demo's alone). Maximize (under the frame, with Reset demo) opens the demo page where the visitor is, Maximize and Back running as the morph view transition. The demo page always shows a draggable site bar at its bottom centre — Back to equin.ai (into the frame after a Maximize, else the homepage) and the LiveDemo.BarLink links (Download) — however the visitor got there; a new browser tab opened from inside the demo opens the demo page there.",
  contributions: [
    Website.Resident({
      id: "live-demo",
      label: "Live demo",
      component: DemoResident,
    }),
    Pane.Register({ pane: demoPane }),
  ],
  slots: { page: demoPane, ...LiveDemo },
} satisfies PluginDefinition;
