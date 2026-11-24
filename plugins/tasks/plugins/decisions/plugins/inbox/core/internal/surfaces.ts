import type { IdChipSurface } from "@plugins/active-data/plugins/id-chip/core";

/** Where a `dec-…` chip belongs — read by BOTH halves, so they cannot disagree. */
export const DECISION_CHIP_SURFACES: readonly IdChipSurface[] = ["transcript"];
