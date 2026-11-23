// The virtual clock's init-script entry (bundled as an IIFE by ../record.ts).

import { installClock } from "./clock";
import type { E2eScript } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/core";

export const e2e = {
  kind: "helper",
  why: "Bundled as an IIFE by ../record.ts as the film page's virtual-clock init script.",
} satisfies E2eScript;

installClock();
