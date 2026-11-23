// Lays the closing montage out on the promo-film composition's desktop in
// real time, unrecorded, and saves a still after each window lands — to judge
// a layout (`MONTAGE` in internal/segments.ts) before a desktop take.
//
//   ./equin run plugins/apps/plugins/website/plugins/promo-film/e2e/montage-preview.ts \
//     --composition promo-film [--out <dir>]   # default: a fresh mkdtemp dir
//
// It un-hides Circle (as the desktop take does): run it after the prototype
// segment's take, or seed again before recording that segment.

import { mkdirSync } from "node:fs";
import {
  arg,
  withBrowser,
} from "@plugins/framework/plugins/tooling/plugins/e2e-harness/e2e";
import { previewMontage } from "./internal/segments";
import { freshDir } from "./internal/session-kit";
import type { E2eScript } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/core";

export const e2e = {
  kind: "tool",
  target: { composition: "promo-film" },
  writes: true,
  run: {
    manual: ["stateful"],
    why: "Un-hides Circle on the seeded promo-film composition; stills for judging a layout.",
  },
} satisfies E2eScript;

const out = arg("out") ?? freshDir("montage-preview");
mkdirSync(out, { recursive: true });
await withBrowser((h) => previewMontage(h, out), { gpu: true });
console.log(`stills: ${out}/opened-<i>.png`);
