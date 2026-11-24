import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { claimPlots, movePlot, resetPlots, restorePlot } from "../core";
import { islePlotsServed } from "./internal/resource";
import {
  handleClaimPlots,
  handleMovePlot,
  handleResetPlots,
  handleRestorePlot,
} from "./internal/routes";

export { _islePlots } from "./internal/tables";

export default {
  description:
    "Isle's plots table (isle_plots: one row per plot of a world, keyed (world, plotId), its occupant unique per world, the geometry as jsonb) served as the isle.plots live collection, and the claim / move / restore endpoints (one compare-and-set transaction per batch, answered stale when what the writer read no longer holds), plus reset (Tidy up: every plot of a world dropped in one statement).",
  httpRoutes: {
    [claimPlots.route]: handleClaimPlots,
    [movePlot.route]: handleMovePlot,
    [restorePlot.route]: handleRestorePlot,
    [resetPlots.route]: handleResetPlots,
  },
  contributions: [...islePlotsServed.declare],
} satisfies ServerPluginDefinition;
